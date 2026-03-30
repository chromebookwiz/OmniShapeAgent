import base64
from pathlib import Path
from typing import Optional

# Lazy‑load the Stable Diffusion pipeline only when needed
_pipeline = None

def _load_pipeline():
    global _pipeline
    if _pipeline is None:
        from diffusers import StableDiffusionPipeline
        import torch, os
        # Use the public v1‑5 checkpoint (will be downloaded on first run)
        _pipeline = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float16,
            revision="fp16"
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _pipeline = _pipeline.to(device)
    return _pipeline

def generate_image(
    prompt: str,
    output_path: str = "generated.png",
    height: int = 512,
    width: int = 512,
    seed: Optional[int] = None,
) -> str:
    """Generate an image from *prompt* using Stable Diffusion.
    Returns the absolute path of the saved PNG.
    """
    pipe = _load_pipeline()
    generator = None
    if seed is not None:
        import torch
        generator = torch.Generator(device=pipe.device).manual_seed(seed)
    image = pipe(
        prompt=prompt,
        height=height,
        width=width,
        num_inference_steps=30,
        generator=generator,
    ).images[0]
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    return str(out.resolve())
