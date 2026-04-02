"""
Neural Orchestrator — FastAPI Service
=======================================
Single lightweight process that:
  1. Accepts user message observations via POST /observe
  2. Returns orchestrator directives via POST /directive
  3. Exposes training stats via GET /status
  4. Can be force-trained via POST /train
  5. Allows manual injection via POST /inject (for testing)

Run with:
    uvicorn service:app --host 127.0.0.1 --port 7861 --reload
Or via the launcher script:
    python service.py
"""

import os
import sys
import time
import logging
import asyncio
import threading
from contextlib import asynccontextmanager
from typing import Optional

# ── Set up logging BEFORE imports that might log ──────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
log = logging.getLogger("orchestrator.service")

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
except ImportError:
    log.error("fastapi or pydantic not installed. Run: pip install fastapi uvicorn[standard] pydantic")
    sys.exit(1)

try:
    import torch
except ImportError:
    log.error("PyTorch not installed. Run: pip install torch torchvision")
    sys.exit(1)

# Local imports
sys.path.insert(0, os.path.dirname(__file__))
from trainer import OrchestratorTrainer, Observation

# ── State ──────────────────────────────────────────────────────────────────────
trainer: Optional[OrchestratorTrainer] = None
_recent_obs: dict[str, list[Observation]] = {}   # session_id → last N obs
MAX_RECENT = 16

# Override directive (from UI or manual injection, takes precedence)
_override_directive: Optional[str] = None
_override_expires: float = 0.0


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global trainer
    log.info("Starting Neural Orchestrator…")
    # Load model in a thread so we don't block the event loop
    loop = asyncio.get_event_loop()
    trainer = await loop.run_in_executor(None, OrchestratorTrainer)
    log.info("Neural Orchestrator ready.")
    yield
    log.info("Neural Orchestrator shutting down.")


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="ShapeAgent Neural Orchestrator",
    description="User-behavior-learning grand orchestrator for OmniShapeAgent",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ────────────────────────────────────────────────────────────────────
class ObserveRequest(BaseModel):
    text:       str
    session_id: str
    turn_index: int = 0
    has_image:  bool = False
    hour:       Optional[float] = None   # hour of day (0-23); auto-detected if None

class DirectiveRequest(BaseModel):
    session_id: str
    urgency_threshold: float = 0.3   # only return directive if urgency > threshold

class InjectRequest(BaseModel):
    directive: str
    ttl_seconds: float = 60.0   # how long the override lasts


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    if trainer is None:
        return {"status": "loading"}
    s = trainer.stats()
    s["status"] = "ok"
    s["override_active"] = _override_directive is not None and time.time() < _override_expires
    return s


@app.post("/observe")
async def observe(req: ObserveRequest):
    """Record a user message. Training happens automatically every TRAIN_EVERY calls."""
    if trainer is None:
        raise HTTPException(503, "Orchestrator still loading")

    hour = req.hour if req.hour is not None else (time.localtime().tm_hour + time.localtime().tm_min / 60)
    obs = Observation(
        text=req.text,
        hour=hour,
        turn_idx=req.turn_index,
        session_id=req.session_id,
        has_image=req.has_image,
    )

    # Run training in a background thread (non-blocking)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, trainer.observe, obs)

    # Track recent obs per session for directive queries
    bucket = _recent_obs.setdefault(req.session_id, [])
    bucket.append(obs)
    if len(bucket) > MAX_RECENT:
        bucket.pop(0)

    return {"ok": True, "buffer_size": len(trainer.buffer)}


@app.post("/directive")
async def directive(req: DirectiveRequest):
    """
    Get the orchestrator's current directive for this session.
    Returns empty string if urgency is below threshold or model isn't confident.
    """
    if trainer is None:
        raise HTTPException(503, "Orchestrator still loading")

    # Check for manual override first
    global _override_directive, _override_expires
    if _override_directive and time.time() < _override_expires:
        return {
            "directive":   _override_directive,
            "urgency":     1.0,
            "confidence":  1.0,
            "intent_idx":  -1,
            "source":      "override",
        }

    recent = _recent_obs.get(req.session_id, [])
    if not recent:
        return {"directive": "", "urgency": 0.0, "confidence": 0.0, "intent_idx": 0, "source": "none"}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, trainer.get_directive, recent)

    if result["urgency"] < req.urgency_threshold:
        return {"directive": "", **result, "source": "below_threshold"}

    return {**result, "source": "model"}


@app.post("/inject")
async def inject(req: InjectRequest):
    """Manually inject a directive override (for testing or user-driven priming)."""
    global _override_directive, _override_expires
    _override_directive = req.directive
    _override_expires = time.time() + req.ttl_seconds
    return {"ok": True, "directive": req.directive, "expires_in": req.ttl_seconds}


@app.delete("/inject")
async def clear_inject():
    """Clear any active directive override."""
    global _override_directive, _override_expires
    _override_directive = None
    _override_expires = 0.0
    return {"ok": True}


@app.post("/train")
async def force_train():
    """Force an immediate training step (for debugging)."""
    if trainer is None:
        raise HTTPException(503, "Orchestrator still loading")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, trainer._train_step)
    return {"ok": True, "train_steps": trainer._train_steps}


# ── Entrypoint ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("ORCHESTRATOR_PORT", 7861))
    log.info(f"Starting orchestrator on 127.0.0.1:{port}")
    uvicorn.run("service:app", host="127.0.0.1", port=port, reload=False, log_level="info")
