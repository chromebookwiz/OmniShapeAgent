// src/lib/physics-state-store.ts
// Shared in-memory store so PhysicsSimulator (browser → /api/physics-state POST)
// and agent.ts (physics_get_state tool) can communicate.

interface PhysicsStateEntry {
  timestamp: number;
  data: object;
}

let _state: PhysicsStateEntry | null = null;

export function setPhysicsState(data: object): void {
  _state = { timestamp: Date.now(), data };
}

export function getPhysicsState(): PhysicsStateEntry | null {
  return _state;
}

export async function waitForPhysicsStateAfter(timestamp: number, timeoutMs = 1500, pollMs = 75): Promise<PhysicsStateEntry | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (_state && _state.timestamp >= timestamp) {
      return _state;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return _state && _state.timestamp >= timestamp ? _state : null;
}
