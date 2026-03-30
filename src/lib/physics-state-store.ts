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
