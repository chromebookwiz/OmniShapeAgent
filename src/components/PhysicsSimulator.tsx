"use client";

import React, { useEffect, useRef, useCallback } from "react";

// ── Command protocol ─────────────────────────────────────────────────────────

export interface PhysicsCmd {
  id: string;
  type:
    | "spawn"
    | "delete"
    | "apply_force"
    | "apply_impulse"
    | "apply_torque"
    | "set_velocity"
    | "set_angular_velocity"
    | "set_position"
    | "set_property"
    | "set_gravity"
    | "add_spring"
    | "remove_spring"
    | "add_hinge"
    | "set_motor"
    | "remove_hinge"
    | "add_sensor"
    | "camera_goto"
    | "set_sky"
    | "explode"
    | "get_state"
    | "reset"
    | "run_script"
    | "run_training_loop"
    | "spawn_creature";
  objId?: string;
  // spawn
  shape?: "sphere" | "box" | "cylinder" | "cone" | "torus" | "icosahedron" | "tetrahedron" | "capsule";
  position?: [number, number, number];
  color?: string;
  mass?: number;
  radius?: number;
  size?: [number, number, number];
  restitution?: number; // 0–1 bounciness
  friction?: number;    // 0–1
  metalness?: number;
  roughness?: number;
  emissive?: string;
  wireframe?: boolean;
  fixed?: boolean;      // immovable anchor
  // physics
  force?: [number, number, number];
  torque?: [number, number, number];
  velocity?: [number, number, number];
  angularVelocity?: [number, number, number];
  // set_property
  property?: string;
  value?: unknown;
  // set_gravity
  gravity?: [number, number, number];
  // add_spring
  springId?: string;
  objId2?: string;
  restLength?: number;
  stiffness?: number;
  damping?: number;
  // add_hinge
  hingeId?: string;
  axis?: [number, number, number];         // rotation axis in world space
  anchorA?: [number, number, number];      // local offset on body A
  anchorB?: [number, number, number];      // local offset on body B
  minAngle?: number;                        // angular limit (radians)
  maxAngle?: number;
  // set_motor
  motorSpeed?: number;                      // target angular velocity (rad/s)
  motorForce?: number;                      // max torque
  // add_sensor
  sensorId?: string;
  sensorType?: "distance" | "speed" | "angle" | "contact";
  // camera_goto
  target?: [number, number, number] | string; // position or objId
  // set_sky
  skyColor?: string;
  // explode
  origin?: [number, number, number];
  strength?: number;
  falloff?: number;
  // script
  script?: string;
  // run_training_loop
  rewardFn?: string;         // JS: (creature, objects, step) => number — higher is better
  networkLayers?: number[];  // e.g. [8, 16, 4] — input, hidden, output
  generations?: number;
  populationSize?: number;
  simSteps?: number;
  mutationRate?: number;
  // spawn_creature — spawns a multi-body articulated creature
  creatureId?: string;
  bodyPlan?: Array<{
    id: string; shape: string; position: [number,number,number]; size?: [number,number,number];
    radius?: number; color?: string; mass?: number;
    hinges?: Array<{ parentId: string; axis: [number,number,number]; anchorA: [number,number,number]; anchorB: [number,number,number] }>;
  }>;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface PhysicsObject {
  id: string;
  mesh: import("three").Mesh;
  velocity: import("three").Vector3;
  angularVelocity: import("three").Vector3;
  mass: number;
  radius: number;       // effective collision radius
  restitution: number;
  friction: number;
  sleeping: boolean;
  sleepTimer: number;
}

interface SpringConstraint {
  id: string;
  a: string; b: string;
  restLength: number;
  stiffness: number;
  damping: number;
}

interface HingeConstraint {
  id: string;
  a: string; b: string;
  axis: import("three").Vector3;
  anchorA: import("three").Vector3;  // local space offset on A
  anchorB: import("three").Vector3;  // local space offset on B
  angle: number;         // accumulated angle
  minAngle: number;
  maxAngle: number;
  motorSpeed: number;    // 0 = no motor
  motorForce: number;
}

// ── Minimal Neural Network (no deps) ─────────────────────────────────────────
// Feedforward net: layers of weights + biases, tanh activations
class NeuralNet {
  layers: Float32Array[];   // packed weights for each layer
  sizes: number[];
  constructor(sizes: number[]) {
    this.sizes = sizes;
    this.layers = [];
    for (let i = 0; i < sizes.length - 1; i++) {
      const n = sizes[i] * sizes[i + 1] + sizes[i + 1]; // weights + biases
      const arr = new Float32Array(n);
      for (let j = 0; j < arr.length; j++) arr[j] = (Math.random() - 0.5) * 0.8;
      this.layers.push(arr);
    }
  }
  forward(input: number[]): number[] {
    let x = input.slice();
    for (let l = 0; l < this.layers.length; l++) {
      const inSz = this.sizes[l], outSz = this.sizes[l + 1];
      const w = this.layers[l];
      const y = new Array(outSz).fill(0);
      for (let o = 0; o < outSz; o++) {
        let sum = w[inSz * outSz + o]; // bias
        for (let i = 0; i < inSz; i++) sum += w[o * inSz + i] * x[i];
        y[o] = Math.tanh(sum);
      }
      x = y;
    }
    return x;
  }
  clone(): NeuralNet {
    const n = new NeuralNet(this.sizes);
    n.layers = this.layers.map(l => new Float32Array(l));
    return n;
  }
  mutate(rate: number): NeuralNet {
    const n = this.clone();
    for (const l of n.layers) {
      for (let i = 0; i < l.length; i++) {
        if (Math.random() < rate) l[i] += (Math.random() - 0.5) * 0.4;
      }
    }
    return n;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PhysicsSimulator({
  width,
  height,
  commands,
}: {
  width: number;
  height: number;
  commands: PhysicsCmd[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processedRef = useRef<Set<string>>(new Set());

  const stateRef = useRef<{
    THREE: typeof import("three") | null;
    renderer: import("three").WebGLRenderer | null;
    scene: import("three").Scene | null;
    camera: import("three").PerspectiveCamera | null;
    objects: Map<string, PhysicsObject>;
    springs: Map<string, SpringConstraint>;
    hinges: Map<string, HingeConstraint>;
    gravity: import("three").Vector3;
    animId: number | null;
    lastTime: number;
    fpsFrames: number;
    fpsTime: number;
    fps: number;
    orbitActive: boolean;
    orbitLastX: number;
    orbitLastY: number;
    orbitTheta: number;
    orbitPhi: number;
    orbitRadius: number;
    orbitTarget: import("three").Vector3;
    trainingLog: string[];
  }>({
    THREE: null, renderer: null, scene: null, camera: null,
    objects: new Map(), springs: new Map(), hinges: new Map(),
    gravity: null as any, // set after THREE loads
    animId: null, lastTime: 0,
    fpsFrames: 0, fpsTime: 0, fps: 0,
    orbitActive: false, orbitLastX: 0, orbitLastY: 0,
    orbitTheta: 0.6, orbitPhi: 0.42, orbitRadius: 18,
    orbitTarget: null as any,
    trainingLog: [],
  });

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const commandsRef = useRef<PhysicsCmd[]>(commands);
  useEffect(() => { commandsRef.current = commands; }, [commands]);

  const updateCamera = useCallback(() => {
    const s = stateRef.current;
    if (!s.camera) return;
    const { orbitTheta, orbitPhi, orbitRadius } = s;
    const x = orbitRadius * Math.cos(orbitPhi) * Math.sin(orbitTheta);
    const y = orbitRadius * Math.sin(orbitPhi);
    const z = orbitRadius * Math.cos(orbitPhi) * Math.cos(orbitTheta);
    const t = s.orbitTarget;
    s.camera.position.set(x + t.x, y + t.y, z + t.z);
    s.camera.lookAt(t);
  }, []);

  // ── Command processing ────────────────────────────────────────────────────

  const processCommands = useCallback(() => {
    const s = stateRef.current;
    if (!s.THREE || !s.scene) return;
    const THREE = s.THREE;

    for (const cmd of commandsRef.current) {
      if (processedRef.current.has(cmd.id)) continue;
      processedRef.current.add(cmd.id);

      switch (cmd.type) {

        // ── spawn ──────────────────────────────────────────────────────────
        case "spawn": {
          const shape    = cmd.shape ?? "sphere";
          const color    = cmd.color ?? "#e8e8e8";
          const mass     = cmd.mass ?? 1;
          const pos      = cmd.position ?? [0, 4, 0];
          const restitution = cmd.restitution ?? 0.45;
          const friction    = cmd.friction ?? 0.6;
          const metalness   = cmd.metalness ?? 0.1;
          const roughness   = cmd.roughness ?? 0.5;

          let geometry: import("three").BufferGeometry;
          let radius = 0.5;

          switch (shape) {
            case "sphere": {
              const r = cmd.radius ?? 0.5;
              radius = r;
              geometry = new THREE.SphereGeometry(r, 24, 16);
              break;
            }
            case "box": {
              const sz = cmd.size ?? [1, 1, 1];
              radius = Math.max(...sz) * 0.5;
              geometry = new THREE.BoxGeometry(sz[0], sz[1], sz[2]);
              break;
            }
            case "cylinder": {
              const r = cmd.radius ?? 0.4;
              const h = cmd.size?.[1] ?? 1.2;
              radius = Math.max(r, h * 0.5);
              geometry = new THREE.CylinderGeometry(r, r, h, 24);
              break;
            }
            case "cone": {
              const r = cmd.radius ?? 0.5;
              const h = cmd.size?.[1] ?? 1.2;
              radius = Math.max(r, h * 0.5);
              geometry = new THREE.ConeGeometry(r, h, 20);
              break;
            }
            case "torus": {
              const r = cmd.radius ?? 0.5;
              radius = r * 1.4;
              geometry = new THREE.TorusGeometry(r, r * 0.35, 12, 28);
              break;
            }
            case "icosahedron": {
              const r = cmd.radius ?? 0.55;
              radius = r;
              geometry = new THREE.IcosahedronGeometry(r, 1);
              break;
            }
            case "tetrahedron": {
              const r = cmd.radius ?? 0.6;
              radius = r;
              geometry = new THREE.TetrahedronGeometry(r, 0);
              break;
            }
            case "capsule": {
              const r = cmd.radius ?? 0.35;
              const h = cmd.size?.[1] ?? 1.0;
              radius = r + h * 0.5;
              geometry = new THREE.CapsuleGeometry(r, h, 8, 16);
              break;
            }
            default: {
              const sz = cmd.size ?? [1, 1, 1];
              radius = Math.max(...sz) * 0.5;
              geometry = new THREE.BoxGeometry(sz[0], sz[1], sz[2]);
            }
          }

          const isFixed = cmd.fixed ?? false;
          const mat = new THREE.MeshStandardMaterial({
            color: isFixed ? (cmd.color ?? "#888888") : color,
            metalness: isFixed ? 0.8 : metalness,
            roughness: isFixed ? 0.3 : roughness,
            emissive: cmd.emissive ?? "#000000",
            wireframe: cmd.wireframe ?? false,
          });
          const mesh = new THREE.Mesh(geometry, mat);
          mesh.position.set(pos[0], pos[1], pos[2]);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Remove old object with same id
          const existing = s.objects.get(cmd.objId!);
          if (existing) {
            s.scene.remove(existing.mesh);
            existing.mesh.geometry.dispose();
            (existing.mesh.material as import("three").Material).dispose();
          }

          s.scene.add(mesh);
          if (cmd.objId) {
            s.objects.set(cmd.objId, {
              id: cmd.objId, mesh,
              velocity: new THREE.Vector3(),
              angularVelocity: new THREE.Vector3(),
              mass: isFixed ? 1e9 : mass,  // effectively infinite mass
              radius, restitution, friction,
              sleeping: isFixed,  // fixed bodies don't simulate
              sleepTimer: isFixed ? 999 : 0,
            });
          }
          break;
        }

        // ── delete ─────────────────────────────────────────────────────────
        case "delete": {
          if (!cmd.objId) break;
          const obj = s.objects.get(cmd.objId);
          if (obj) {
            s.scene.remove(obj.mesh);
            obj.mesh.geometry.dispose();
            (obj.mesh.material as import("three").Material).dispose();
            s.objects.delete(cmd.objId);
          }
          break;
        }

        // ── forces ────────────────────────────────────────────────────────
        case "apply_force": {
          if (!cmd.objId || !cmd.force) break;
          const obj = s.objects.get(cmd.objId);
          if (obj) {
            obj.velocity.x += cmd.force[0] / obj.mass;
            obj.velocity.y += cmd.force[1] / obj.mass;
            obj.velocity.z += cmd.force[2] / obj.mass;
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }
        case "apply_impulse": {
          if (!cmd.objId || !cmd.force) break;
          const obj = s.objects.get(cmd.objId);
          if (obj) {
            obj.velocity.x += cmd.force[0] / obj.mass;
            obj.velocity.y += cmd.force[1] / obj.mass;
            obj.velocity.z += cmd.force[2] / obj.mass;
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }
        case "set_velocity": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.velocity) {
            obj.velocity.set(...cmd.velocity);
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }
        case "set_angular_velocity": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.angularVelocity) {
            obj.angularVelocity.set(...cmd.angularVelocity);
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }
        case "set_position": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.position) {
            obj.mesh.position.set(...cmd.position);
            obj.velocity.set(0, 0, 0);
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }

        // ── set_property ──────────────────────────────────────────────────
        case "set_property": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (!obj || !cmd.property) break;
          const mat = obj.mesh.material as import("three").MeshStandardMaterial;
          switch (cmd.property) {
            case "color":      mat.color.set(cmd.value as string); break;
            case "emissive":   mat.emissive.set(cmd.value as string); break;
            case "metalness":  mat.metalness  = Number(cmd.value); break;
            case "roughness":  mat.roughness  = Number(cmd.value); break;
            case "opacity":    mat.opacity = Number(cmd.value); mat.transparent = mat.opacity < 1; break;
            case "wireframe":  mat.wireframe = Boolean(cmd.value); break;
            case "mass":       obj.mass = Number(cmd.value); break;
            case "restitution": obj.restitution = Math.max(0, Math.min(1, Number(cmd.value))); break;
            case "friction":   obj.friction = Math.max(0, Math.min(1, Number(cmd.value))); break;
          }
          mat.needsUpdate = true;
          break;
        }

        // ── gravity ───────────────────────────────────────────────────────
        case "set_gravity": {
          if (cmd.gravity) s.gravity.set(...cmd.gravity);
          break;
        }

        // ── springs ───────────────────────────────────────────────────────
        case "add_spring": {
          if (!cmd.springId || !cmd.objId || !cmd.objId2) break;
          s.springs.set(cmd.springId, {
            id: cmd.springId,
            a: cmd.objId, b: cmd.objId2,
            restLength: cmd.restLength ?? 2,
            stiffness: cmd.stiffness ?? 20,
            damping: cmd.damping ?? 2,
          });
          break;
        }
        case "remove_spring": {
          if (cmd.springId) s.springs.delete(cmd.springId);
          break;
        }

        // ── camera ────────────────────────────────────────────────────────
        case "camera_goto": {
          if (!s.camera) break;
          if (typeof cmd.target === "string") {
            const obj = s.objects.get(cmd.target);
            if (obj) {
              s.orbitTarget.copy(obj.mesh.position);
              updateCamera();
            }
          } else if (Array.isArray(cmd.target)) {
            s.orbitTarget.set(cmd.target[0], cmd.target[1], cmd.target[2]);
            updateCamera();
          }
          break;
        }

        // ── sky ───────────────────────────────────────────────────────────
        case "set_sky": {
          if (s.scene && cmd.skyColor) {
            s.scene.background = new THREE.Color(cmd.skyColor);
            const fog = s.scene.fog as import("three").FogExp2 | null;
            if (fog) fog.color.set(cmd.skyColor);
          }
          break;
        }

        // ── explode ───────────────────────────────────────────────────────
        case "explode": {
          const origin = new THREE.Vector3(...(cmd.origin ?? [0, 0, 0]));
          const strength = cmd.strength ?? 50;
          const falloff = cmd.falloff ?? 4;
          for (const obj of s.objects.values()) {
            const dir = obj.mesh.position.clone().sub(origin);
            const dist = Math.max(0.5, dir.length());
            const mag = strength / Math.pow(dist, falloff * 0.5);
            dir.normalize().multiplyScalar(mag / obj.mass);
            obj.velocity.add(dir);
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }

        // ── get_state ─────────────────────────────────────────────────────
        case "get_state": {
          const objState: Record<string, object> = {};
          for (const [id, obj] of s.objects) {
            objState[id] = {
              position: obj.mesh.position.toArray(),
              velocity: obj.velocity.toArray(),
              angularVelocity: obj.angularVelocity.toArray(),
              sleeping: obj.sleeping, mass: obj.mass,
            };
          }
          const hingeState: Record<string, object> = {};
          for (const [id, h] of s.hinges) {
            hingeState[id] = { a: h.a, b: h.b, motorSpeed: h.motorSpeed, motorForce: h.motorForce };
          }
          const statePayload = { objects: objState, hinges: hingeState, trainingLog: s.trainingLog, timestamp: Date.now() };
          console.info("[PhysicsSimulator state]", statePayload);
          // Post to server so agent can read via physics_get_state tool
          fetch('/api/physics-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(statePayload),
          }).catch(() => {});
          break;
        }

        // ── reset ─────────────────────────────────────────────────────────
        case "reset": {
          for (const obj of s.objects.values()) {
            s.scene.remove(obj.mesh);
            obj.mesh.geometry.dispose();
            (obj.mesh.material as import("three").Material).dispose();
          }
          s.objects.clear();
          s.springs.clear();
          s.hinges.clear();
          s.trainingLog = [];
          s.gravity.set(0, -9.81, 0);
          s.orbitTarget.set(0, 0, 0);
          s.orbitTheta = 0.6; s.orbitPhi = 0.42; s.orbitRadius = 18;
          if (s.scene) s.scene.background = new THREE.Color(0x0a0b10);
          updateCamera();
          break;
        }

        // ── apply_torque ──────────────────────────────────────────────────
        case "apply_torque": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.torque) {
            obj.angularVelocity.x += cmd.torque[0] / obj.mass;
            obj.angularVelocity.y += cmd.torque[1] / obj.mass;
            obj.angularVelocity.z += cmd.torque[2] / obj.mass;
            obj.sleeping = false; obj.sleepTimer = 0;
          }
          break;
        }

        // ── add_hinge ─────────────────────────────────────────────────────
        case "add_hinge": {
          if (!cmd.hingeId || !cmd.objId || !cmd.objId2) break;
          s.hinges.set(cmd.hingeId, {
            id: cmd.hingeId,
            a: cmd.objId, b: cmd.objId2,
            axis: new THREE.Vector3(...(cmd.axis ?? [0, 1, 0])).normalize(),
            anchorA: new THREE.Vector3(...(cmd.anchorA ?? [0, 0, 0])),
            anchorB: new THREE.Vector3(...(cmd.anchorB ?? [0, 0, 0])),
            angle: 0,
            minAngle: cmd.minAngle ?? -Math.PI,
            maxAngle: cmd.maxAngle ?? Math.PI,
            motorSpeed: 0,
            motorForce: 0,
          });
          break;
        }

        // ── set_motor ─────────────────────────────────────────────────────
        case "set_motor": {
          if (!cmd.hingeId) break;
          const hinge = s.hinges.get(cmd.hingeId);
          if (hinge) {
            hinge.motorSpeed = cmd.motorSpeed ?? 0;
            hinge.motorForce = cmd.motorForce ?? 10;
          }
          break;
        }

        // ── remove_hinge ─────────────────────────────────────────────────
        case "remove_hinge": {
          if (cmd.hingeId) s.hinges.delete(cmd.hingeId);
          break;
        }

        // ── add_sensor ────────────────────────────────────────────────────
        case "add_sensor": {
          // Sensors are evaluated via get_state; this registers sensor metadata
          // The agent can use run_script to read sensor values
          console.info("[PhysicsSimulator] sensor registered:", cmd.sensorId, cmd.sensorType, cmd.objId, cmd.objId2);
          break;
        }

        // ── spawn_creature ────────────────────────────────────────────────
        case "spawn_creature": {
          if (!cmd.bodyPlan || !cmd.creatureId) break;
          for (const part of cmd.bodyPlan) {
            const partId = `${cmd.creatureId}_${part.id}`;
            const color = part.color ?? "#c0d0ff";
            const mass = part.mass ?? 1;
            const pos = part.position ?? [0, 2, 0];
            let geometry: import("three").BufferGeometry;
            let radius = 0.4;
            if (part.shape === "sphere") {
              radius = part.radius ?? 0.4;
              geometry = new THREE.SphereGeometry(radius, 16, 12);
            } else if (part.shape === "capsule") {
              const r = part.radius ?? 0.25;
              const h = part.size?.[1] ?? 0.8;
              radius = r + h * 0.5;
              geometry = new THREE.CapsuleGeometry(r, h, 6, 12);
            } else {
              const sz = part.size ?? [0.6, 0.6, 0.6];
              radius = Math.max(...sz) * 0.5;
              geometry = new THREE.BoxGeometry(sz[0], sz[1], sz[2]);
            }
            const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55 });
            const mesh = new THREE.Mesh(geometry, mat);
            mesh.position.set(pos[0], pos[1], pos[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            s.scene.add(mesh);
            s.objects.set(partId, {
              id: partId, mesh,
              velocity: new THREE.Vector3(),
              angularVelocity: new THREE.Vector3(),
              mass, radius, restitution: 0.2, friction: 0.7,
              sleeping: false, sleepTimer: 0,
            });
            // Add hinges to parents
            if (part.hinges) {
              for (const h of part.hinges) {
                const hingeId = `${cmd.creatureId}_hinge_${part.id}_${h.parentId}`;
                const parentPartId = `${cmd.creatureId}_${h.parentId}`;
                s.hinges.set(hingeId, {
                  id: hingeId, a: parentPartId, b: partId,
                  axis: new THREE.Vector3(...h.axis).normalize(),
                  anchorA: new THREE.Vector3(...h.anchorA),
                  anchorB: new THREE.Vector3(...h.anchorB),
                  angle: 0, minAngle: -Math.PI * 0.6, maxAngle: Math.PI * 0.6,
                  motorSpeed: 0, motorForce: 0,
                });
              }
            }
          }
          break;
        }

        // ── run_training_loop ─────────────────────────────────────────────
        case "run_training_loop": {
          const generations = cmd.generations ?? 30;
          const popSize = cmd.populationSize ?? 20;
          const simSteps = cmd.simSteps ?? 300;
          const mutRate = cmd.mutationRate ?? 0.15;
          const layers = cmd.networkLayers ?? [6, 12, 4];
          const rewardSrc = cmd.rewardFn ?? "(creature) => creature.pos ? creature.pos[0] : 0";

          s.trainingLog = [`Training: ${generations} gens × ${popSize} creatures × ${simSteps} steps`];
          console.info("[PhysicsSimulator] Training start:", s.trainingLog[0]);

          // Build reward function
          let rewardFn: (creature: object, step: number) => number;
          try {
            rewardFn = new Function("creature", "step", `return (${rewardSrc})(creature, step)`) as any;
          } catch (e) {
            console.warn("[PhysicsSimulator] Invalid reward function:", e);
            s.trainingLog.push("ERROR: invalid reward function");
            break;
          }

          // Evolutionary training (runs synchronously — may block briefly per generation)
          let population: NeuralNet[] = Array.from({ length: popSize }, () => new NeuralNet(layers));
          let bestNet: NeuralNet = population[0];
          let bestReward = -Infinity;

          for (let gen = 0; gen < generations; gen++) {
            const rewards: number[] = population.map((net) => {
              // Simple creature simulation (decoupled from render)
              let px = 0, py = 2, pz = 0;
              let vx = 0, vy = 0, vz = 0;
              let totalReward = 0;

              for (let step = 0; step < simSteps; step++) {
                // State vector: position (3), velocity (3) → 6 inputs
                const state = [px / 10, py / 5, pz / 10, vx / 5, vy / 5, vz / 5];
                const actions = net.forward(state);
                // Actions → forces (clamp to [-1, 1])
                const fx = Math.tanh(actions[0] ?? 0) * 3;
                const fy = Math.tanh(actions[1] ?? 0) * 3;
                const fz = Math.tanh(actions[2] ?? 0) * 3;

                // Verlet integration
                vx += fx * 0.016 - vx * 0.02;
                vy += (fy - 9.81) * 0.016 - vy * 0.02;
                vz += fz * 0.016 - vz * 0.02;
                px += vx * 0.016;
                py = Math.max(0.3, py + vy * 0.016);
                pz += vz * 0.016;
                if (py <= 0.3) { vy = Math.abs(vy) * 0.4; }

                const creature = { pos: [px, py, pz], vel: [vx, vy, vz], step };
                try { totalReward += rewardFn(creature, step); } catch { /* bad reward fn */ }
              }
              return totalReward;
            });

            // Sort by reward
            const ranked = population.map((net, i) => ({ net, reward: rewards[i] }))
              .sort((a, b) => b.reward - a.reward);

            if (ranked[0].reward > bestReward) {
              bestReward = ranked[0].reward;
              bestNet = ranked[0].net.clone();
            }

            if (gen % 5 === 0 || gen === generations - 1) {
              const msg = `Gen ${gen + 1}/${generations}: best reward=${bestReward.toFixed(2)}, avg=${(rewards.reduce((a, b) => a + b, 0) / rewards.length).toFixed(2)}`;
              s.trainingLog.push(msg);
              console.info("[PhysicsSimulator]", msg);
            }

            // Next generation: keep top 50%, mutate rest
            const eliteCount = Math.max(1, Math.floor(popSize * 0.5));
            population = [
              ...ranked.slice(0, eliteCount).map(r => r.net),
              ...Array.from({ length: popSize - eliteCount }, (_, i) => ranked[i % eliteCount].net.mutate(mutRate)),
            ];
          }

          // Spawn best creature in scene as a demo sphere
          const demoId = `trained_${Date.now()}`;
          const demoGeo = new THREE.SphereGeometry(0.45, 24, 16);
          const demoMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, metalness: 0.4, roughness: 0.3, emissive: '#003322' });
          const demoMesh = new THREE.Mesh(demoGeo, demoMat);
          demoMesh.position.set(0, 2, 0);
          demoMesh.castShadow = true;
          s.scene.add(demoMesh);
          s.objects.set(demoId, {
            id: demoId, mesh: demoMesh,
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            mass: 1, radius: 0.45, restitution: 0.4, friction: 0.6,
            sleeping: false, sleepTimer: 0,
          });

          // Drive demo sphere with trained net for a few seconds via run_script override
          let demoStep = 0;
          const demoNet = bestNet;
          const demoInterval = setInterval(() => {
            const obj = s.objects.get(demoId);
            if (!obj || demoStep > 600) { clearInterval(demoInterval); return; }
            const state = [
              obj.mesh.position.x / 10, obj.mesh.position.y / 5, obj.mesh.position.z / 10,
              obj.velocity.x / 5, obj.velocity.y / 5, obj.velocity.z / 5,
            ];
            const actions = demoNet.forward(state);
            obj.velocity.x += Math.tanh(actions[0] ?? 0) * 3 * 0.016;
            obj.velocity.y += Math.tanh(actions[1] ?? 0) * 3 * 0.016;
            obj.velocity.z += Math.tanh(actions[2] ?? 0) * 3 * 0.016;
            obj.sleeping = false;
            demoStep++;
          }, 16);

          s.trainingLog.push(`Done! Best reward: ${bestReward.toFixed(2)}. Spawned trained agent (green sphere) id='${demoId}'.`);
          console.info("[PhysicsSimulator] Training complete. Best reward:", bestReward.toFixed(2));
          // Post training results to server so agent can read them
          fetch('/api/physics-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainingLog: s.trainingLog, bestReward, trainedId: demoId, timestamp: Date.now() }),
          }).catch(() => {});
          break;
        }

        // ── run_script ────────────────────────────────────────────────────
        case "run_script": {
          if (!cmd.script) break;
          try {
            new Function("objects", "springs", "hinges", "THREE", "scene", "gravity", "NeuralNet", cmd.script)(
              s.objects, s.springs, s.hinges, THREE, s.scene, s.gravity, NeuralNet
            );
          } catch (e) {
            console.warn("[PhysicsSimulator] script error:", e);
          }
          break;
        }
      }
    }
  }, [updateCamera]);

  // ── Main setup effect ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    // Capture ref value now so the cleanup function uses the same object
    const capturedState = stateRef.current;

    (async () => {
      const THREE = (await import("three")) as typeof import("three");
      if (destroyed) return;

      const s = stateRef.current;
      s.THREE = THREE;
      s.gravity = new THREE.Vector3(0, -9.81, 0);
      s.orbitTarget = new THREE.Vector3(0, 1, 0);

      // ── Renderer ────────────────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      s.renderer = renderer;

      // ── Scene ────────────────────────────────────────────────────────────
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0b10);
      scene.fog = new THREE.FogExp2(0x0a0b10, 0.018);
      s.scene = scene;

      // ── Lights ───────────────────────────────────────────────────────────
      // Hemisphere: cool sky / warm ground bounce
      const hemi = new THREE.HemisphereLight(0x8ab4f8, 0x4a3020, 0.6);
      scene.add(hemi);

      // Key light (sun)
      const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
      sun.position.set(12, 22, 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 80;
      sun.shadow.camera.left = -20;
      sun.shadow.camera.right = 20;
      sun.shadow.camera.top = 20;
      sun.shadow.camera.bottom = -20;
      sun.shadow.bias = -0.0003;
      scene.add(sun);

      // Fill light
      const fill = new THREE.DirectionalLight(0xa0c8ff, 0.5);
      fill.position.set(-8, 6, -12);
      scene.add(fill);

      // Accent point lights for drama
      const p1 = new THREE.PointLight(0x3060ff, 1.2, 18, 2);
      p1.position.set(-8, 2, -6);
      scene.add(p1);
      const p2 = new THREE.PointLight(0xff4020, 0.8, 14, 2);
      p2.position.set(9, 1, 7);
      scene.add(p2);

      // ── Ground ───────────────────────────────────────────────────────────
      // Reflective dark plane
      const groundGeo = new THREE.PlaneGeometry(40, 40, 1, 1);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x111318,
        metalness: 0.4,
        roughness: 0.6,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Grid lines (emissive so they glow faintly)
      const grid = new THREE.GridHelper(40, 40, 0x1a2040, 0x141820);
      scene.add(grid);

      // ── Camera ───────────────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
      s.camera = camera;
      updateCamera();

      // ── Physics constants ─────────────────────────────────────────────────
      const SLEEP_THRESHOLD = 0.04;   // m/s combined velocity
      const SLEEP_DELAY     = 1.2;    // seconds of quietness before sleeping
      const LINEAR_DAMPING  = 0.985;
      const ANGULAR_DAMPING = 0.88;
      const SUB_STEPS       = 4;      // physics sub-steps per frame
      const GROUND_Y        = 0;

      // ── Animation loop ────────────────────────────────────────────────────
      const tmpVec = new THREE.Vector3();

      const animate = (now: number) => {
        if (destroyed) return;
        s.animId = requestAnimationFrame(animate);

        const dt = Math.min((s.lastTime ? (now - s.lastTime) / 1000 : 0.016), 0.05);
        s.lastTime = now;

        s.fpsFrames++;
        s.fpsTime += dt;
        if (s.fpsTime >= 0.5) {
          s.fps = s.fpsFrames / s.fpsTime;
          s.fpsFrames = 0; s.fpsTime = 0;
        }

        processCommands();

        const subDt = dt / SUB_STEPS;

        for (let step = 0; step < SUB_STEPS; step++) {

          // Spring forces
          for (const sp of s.springs.values()) {
            const a = s.objects.get(sp.a);
            const b = s.objects.get(sp.b);
            if (!a || !b) continue;
            tmpVec.copy(b.mesh.position).sub(a.mesh.position);
            const dist = tmpVec.length();
            if (dist < 1e-4) continue;
            const extension = dist - sp.restLength;
            const relVel = tmpVec.clone().normalize().dot(
              b.velocity.clone().sub(a.velocity)
            );
            const fMag = sp.stiffness * extension + sp.damping * relVel;
            const f = tmpVec.clone().normalize().multiplyScalar(fMag);
            a.velocity.addScaledVector(f,  subDt / a.mass);
            b.velocity.addScaledVector(f, -subDt / b.mass);
            a.sleeping = false; b.sleeping = false;
          }

          // Hinge constraints (positional + angular motor)
          for (const hinge of s.hinges.values()) {
            const a = s.objects.get(hinge.a);
            const b = s.objects.get(hinge.b);
            if (!a || !b) continue;

            // World-space anchor points
            const wAnchorA = hinge.anchorA.clone().applyQuaternion(a.mesh.quaternion).add(a.mesh.position);
            const wAnchorB = hinge.anchorB.clone().applyQuaternion(b.mesh.quaternion).add(b.mesh.position);

            // Positional correction — pull anchors together
            const correction = wAnchorB.clone().sub(wAnchorA);
            const corrLen = correction.length();
            if (corrLen > 0.001) {
              const corrDir = correction.clone().normalize();
              const invMassSum = 1 / a.mass + 1 / b.mass;
              const baumFactor = Math.min(corrLen * 0.4, 0.2); // Baumgarte stabilisation
              a.velocity.addScaledVector(corrDir,  baumFactor * (1 / a.mass) / invMassSum * 60 * subDt);
              b.velocity.addScaledVector(corrDir, -baumFactor * (1 / b.mass) / invMassSum * 60 * subDt);
            }

            // Motor: apply torque along hinge axis to reach motorSpeed
            if (hinge.motorForce > 0) {
              const worldAxis = hinge.axis.clone().applyQuaternion(a.mesh.quaternion).normalize();
              const relOmega = a.angularVelocity.clone().sub(b.angularVelocity).dot(worldAxis);
              const speedErr = hinge.motorSpeed - relOmega;
              const torqueMag = Math.max(-hinge.motorForce, Math.min(hinge.motorForce, speedErr * 8)) * subDt;
              a.angularVelocity.addScaledVector(worldAxis,  torqueMag / a.mass);
              b.angularVelocity.addScaledVector(worldAxis, -torqueMag / b.mass);
              a.sleeping = false; b.sleeping = false;
            }
          }

          // Per-object integration
          for (const obj of s.objects.values()) {
            if (obj.sleeping) continue;

            // Gravity
            obj.velocity.addScaledVector(s.gravity, subDt);

            // Damping
            obj.velocity.multiplyScalar(Math.pow(LINEAR_DAMPING, subDt * 60));
            obj.angularVelocity.multiplyScalar(Math.pow(ANGULAR_DAMPING, subDt * 60));

            // Integrate position
            obj.mesh.position.addScaledVector(obj.velocity, subDt);

            // Integrate rotation via axis-angle → quaternion delta
            const ωLen = obj.angularVelocity.length();
            if (ωLen > 1e-5) {
              const angle = ωLen * subDt;
              const axis = obj.angularVelocity.clone().normalize();
              const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
              obj.mesh.quaternion.premultiply(dq);
            }

            // Ground collision
            const floor = GROUND_Y + obj.radius;
            if (obj.mesh.position.y < floor) {
              obj.mesh.position.y = floor;
              if (obj.velocity.y < 0) {
                obj.velocity.y *= -obj.restitution;
                // Friction on horizontal velocity
                const lateralFactor = 1 - obj.friction * subDt * 30;
                obj.velocity.x *= Math.max(0, lateralFactor);
                obj.velocity.z *= Math.max(0, lateralFactor);
              }
              // Ground contact angular friction
              obj.angularVelocity.multiplyScalar(1 - obj.friction * 0.15);
            }

            // Arena walls (soft boundary — push back)
            const WALL = 19;
            for (const axis of ["x", "z"] as const) {
              if (obj.mesh.position[axis] > WALL) {
                obj.mesh.position[axis] = WALL;
                if (obj.velocity[axis] > 0) obj.velocity[axis] *= -obj.restitution;
              } else if (obj.mesh.position[axis] < -WALL) {
                obj.mesh.position[axis] = -WALL;
                if (obj.velocity[axis] < 0) obj.velocity[axis] *= -obj.restitution;
              }
            }

            // Sleep check
            const speed = obj.velocity.length() + obj.angularVelocity.length();
            if (speed < SLEEP_THRESHOLD && obj.mesh.position.y < floor + 0.05) {
              obj.sleepTimer += subDt;
              if (obj.sleepTimer > SLEEP_DELAY) { obj.sleeping = true; }
            } else {
              obj.sleepTimer = 0;
            }
          }

          // Object-object sphere collision (O(n²) — fine for < 200 objects)
          const objs = Array.from(s.objects.values());
          for (let i = 0; i < objs.length; i++) {
            for (let j = i + 1; j < objs.length; j++) {
              const a = objs[i], b = objs[j];
              if (a.sleeping && b.sleeping) continue;
              const dx = b.mesh.position.x - a.mesh.position.x;
              const dy = b.mesh.position.y - a.mesh.position.y;
              const dz = b.mesh.position.z - a.mesh.position.z;
              const dist2 = dx * dx + dy * dy + dz * dz;
              const minDist = a.radius + b.radius;
              if (dist2 >= minDist * minDist || dist2 < 1e-8) continue;

              const dist = Math.sqrt(dist2);
              const nx = dx / dist, ny = dy / dist, nz = dz / dist;
              // Penetration correction
              const pen = (minDist - dist) * 0.5;
              const invMassSum = 1 / a.mass + 1 / b.mass;
              const corrA = pen / (invMassSum * a.mass);
              const corrB = pen / (invMassSum * b.mass);
              a.mesh.position.x -= nx * corrA;
              a.mesh.position.y -= ny * corrA;
              a.mesh.position.z -= nz * corrA;
              b.mesh.position.x += nx * corrB;
              b.mesh.position.y += ny * corrB;
              b.mesh.position.z += nz * corrB;

              // Velocity response
              const restitution = Math.min(a.restitution, b.restitution);
              const relVel = (b.velocity.x - a.velocity.x) * nx
                           + (b.velocity.y - a.velocity.y) * ny
                           + (b.velocity.z - a.velocity.z) * nz;
              if (relVel > 0) continue; // already separating
              const j2 = -(1 + restitution) * relVel / invMassSum;
              const jx = nx * j2, jy = ny * j2, jz = nz * j2;
              a.velocity.x -= jx / a.mass;
              a.velocity.y -= jy / a.mass;
              a.velocity.z -= jz / a.mass;
              b.velocity.x += jx / b.mass;
              b.velocity.y += jy / b.mass;
              b.velocity.z += jz / b.mass;
              a.sleeping = false; a.sleepTimer = 0;
              b.sleeping = false; b.sleepTimer = 0;
            }
          }
        }

        renderer.render(scene, camera);

        // Overlay update (throttled)
        if (overlayRef.current) {
          const sleeping = Array.from(s.objects.values()).filter(o => o.sleeping).length;
          const total = s.objects.size;
          const parts: string[] = [`${total} obj`];
          if (sleeping > 0) parts.push(`${sleeping} asleep`);
          if (s.springs.size > 0) parts.push(`${s.springs.size} springs`);
          if (s.hinges.size > 0) parts.push(`${s.hinges.size} hinges`);
          parts.push(`${s.fps.toFixed(0)} fps`);
          if (s.trainingLog.length > 0) parts.push(s.trainingLog[s.trainingLog.length - 1].slice(0, 48));
          overlayRef.current.textContent = parts.join('  ');
        }
      };

      s.animId = requestAnimationFrame(animate);
    })();

    return () => {
      destroyed = true;
      const s = capturedState;
      if (s.animId !== null) cancelAnimationFrame(s.animId);
      if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
      s.scene = null; s.camera = null;
      s.objects.clear(); s.springs.clear();
      s.THREE = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (s.renderer) s.renderer.setSize(width, height);
    if (s.camera) { s.camera.aspect = width / height; s.camera.updateProjectionMatrix(); }
  }, [width, height]);

  // ── Orbit controls ────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = stateRef.current;
    s.orbitActive = true;
    s.orbitLastX = e.clientX;
    s.orbitLastY = e.clientY;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s.orbitActive) return;
    const dx = e.clientX - s.orbitLastX;
    const dy = e.clientY - s.orbitLastY;
    s.orbitLastX = e.clientX;
    s.orbitLastY = e.clientY;
    s.orbitTheta -= dx * 0.008;
    s.orbitPhi = Math.max(-1.45, Math.min(1.45, s.orbitPhi + dy * 0.008));
    updateCamera();
  }, [updateCamera]);

  const onPointerUp = useCallback(() => { stateRef.current.orbitActive = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    s.orbitRadius = Math.max(1.5, Math.min(80, s.orbitRadius * (1 + e.deltaY * 0.001)));
    updateCamera();
  }, [updateCamera]);

  return (
    <div style={{ position: "relative", width, height, background: "#0a0b10" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      />
      <div
        ref={overlayRef}
        style={{
          position: "absolute", top: 8, left: 10,
          color: "rgba(180,200,255,0.5)",
          fontSize: 10, fontFamily: "monospace",
          pointerEvents: "none", userSelect: "none",
          letterSpacing: "0.06em",
        }}
      >
        0 obj  — fps
      </div>
      <div style={{
        position: "absolute", bottom: 8, right: 10,
        color: "rgba(180,200,255,0.25)",
        fontSize: 9, fontFamily: "monospace",
        pointerEvents: "none", userSelect: "none",
        letterSpacing: "0.08em",
      }}>
        DRAG · SCROLL
      </div>
    </div>
  );
}
