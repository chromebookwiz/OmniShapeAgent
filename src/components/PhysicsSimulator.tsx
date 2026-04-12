"use client";

import React, { useEffect, useRef, useCallback } from "react";
import type { PhysicsCmd } from '@/lib/physics-types';

// ── Command protocol ─────────────────────────────────────────────────────────

// ── Internal types ────────────────────────────────────────────────────────────

interface PhysicsObject {
  id: string;
  mesh: import("three").Mesh;
  velocity: import("three").Vector3;
  angularVelocity: import("three").Vector3;
  mass: number;
  invMass: number;
  invInertia: import("three").Vector3;
  radius: number;       // effective collision radius
  shape: NonNullable<PhysicsCmd['shape']>;
  size: [number, number, number];
  fixed: boolean;
  restitution: number;
  friction: number;
  sleeping: boolean;
  sleepTimer: number;
  ownerId?: string;
  team?: string;
  contactDamage: number;
  partRole?: string;
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

interface SensorBinding {
  id: string;
  type: NonNullable<PhysicsCmd['sensorType']>;
  objId?: string;
  objId2?: string;
  target?: [number, number, number] | string;
}

interface ActiveController {
  controllerId?: string;
  combatantId?: string;
  rootId: string;
  hingeIds: string[];
  net: NeuralNet;
  step: number;
  maxMotorSpeed: number;
  baseMotorForce: number;
  bestReward?: number;
}

interface SerializedPhysicsController {
  version: 1;
  controllerId?: string;
  rootId: string;
  hingeIds: string[];
  maxMotorSpeed: number;
  baseMotorForce: number;
  step: number;
  bestReward?: number;
  network: {
    sizes: number[];
    layers: number[][];
  };
  savedAt: number;
}

interface PhysicsRules {
  arenaHalfExtent: number;
  wallRestitution: number;
  groundFriction: number;
  groundProfile: 'flat' | 'hills';
  groundAmplitude: number;
  groundFrequency: number;
  contactDamageScale: number;
  impactDamageThreshold: number;
  boundaryDamagePerSecond: number;
  hazardRingRadius: number;
  hazardRingDamagePerSecond: number;
  friendlyFire: boolean;
  allowSleep: boolean;
}

interface Combatant {
  id: string;
  rootId: string;
  hingeIds: string[];
  partIds: string[];
  team: string;
  health: number;
  maxHealth: number;
  aggression: number;
  contactDamage: number;
  eliminated: boolean;
}

const DEFAULT_PHYSICS_RULES: PhysicsRules = {
  arenaHalfExtent: 19,
  wallRestitution: 0.35,
  groundFriction: 0.7,
  groundProfile: 'flat',
  groundAmplitude: 0,
  groundFrequency: 0.18,
  contactDamageScale: 4.5,
  impactDamageThreshold: 2.6,
  boundaryDamagePerSecond: 0,
  hazardRingRadius: 0,
  hazardRingDamagePerSecond: 0,
  friendlyFire: false,
  allowSleep: true,
};

function sampleGroundHeight(x: number, z: number, rules: PhysicsRules) {
  if (rules.groundProfile !== 'hills' || rules.groundAmplitude <= 0) return 0;
  const freq = Math.max(0.02, rules.groundFrequency);
  const ridge = Math.sin(x * freq) * Math.cos(z * freq * 0.9);
  const swell = 0.45 * Math.sin((x + z) * freq * 0.55);
  return rules.groundAmplitude * (ridge + swell);
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

function serializeNeuralNet(net: NeuralNet) {
  return {
    sizes: [...net.sizes],
    layers: net.layers.map((layer) => Array.from(layer)),
  };
}

function deserializeNeuralNet(serialized: { sizes: number[]; layers: number[][] }) {
  const net = new NeuralNet(serialized.sizes);
  net.layers = serialized.layers.map((layer) => Float32Array.from(layer));
  return net;
}

function serializeController(controller: ActiveController): SerializedPhysicsController {
  return {
    version: 1,
    controllerId: controller.controllerId,
    rootId: controller.rootId,
    hingeIds: [...controller.hingeIds],
    maxMotorSpeed: controller.maxMotorSpeed,
    baseMotorForce: controller.baseMotorForce,
    step: controller.step,
    bestReward: controller.bestReward,
    network: serializeNeuralNet(controller.net),
    savedAt: Date.now(),
  };
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
    sensors: Map<string, SensorBinding>;
    combatants: Map<string, Combatant>;
    activeControllers: Map<string, ActiveController>;
    primaryControllerRootId: string | null;
    physicsRules: PhysicsRules;
    simTime: number;
    combatHitCooldowns: Map<string, number>;
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
    groundMesh: import("three").Mesh | null;
    trainingLog: string[];
    activeController: ActiveController | null;
  }>({
    THREE: null, renderer: null, scene: null, camera: null,
    objects: new Map(), springs: new Map(), hinges: new Map(),
    sensors: new Map(),
    combatants: new Map(),
    activeControllers: new Map(),
    primaryControllerRootId: null,
    physicsRules: { ...DEFAULT_PHYSICS_RULES },
    simTime: 0,
    combatHitCooldowns: new Map(),
    gravity: null as any, // set after THREE loads
    animId: null, lastTime: 0,
    fpsFrames: 0, fpsTime: 0, fps: 0,
    orbitActive: false, orbitLastX: 0, orbitLastY: 0,
    orbitTheta: 0.6, orbitPhi: 0.42, orbitRadius: 18,
    orbitTarget: null as any,
    groundMesh: null,
    trainingLog: [],
    activeController: null,
  });

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const commandsRef = useRef<PhysicsCmd[]>(commands);
  useEffect(() => { commandsRef.current = commands; }, [commands]);

  const removeObject = useCallback((objectId: string) => {
    const s = stateRef.current;
    const existing = s.objects.get(objectId);
    if (!existing || !s.scene) return;
    s.scene.remove(existing.mesh);
    existing.mesh.geometry.dispose();
    const material = existing.mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
    s.objects.delete(objectId);
    for (const [springId, spring] of Array.from(s.springs.entries())) {
      if (spring.a === objectId || spring.b === objectId) s.springs.delete(springId);
    }
    for (const [hingeId, hinge] of Array.from(s.hinges.entries())) {
      if (hinge.a === objectId || hinge.b === objectId) s.hinges.delete(hingeId);
    }
    for (const [sensorId, sensor] of Array.from(s.sensors.entries())) {
      if (sensor.objId === objectId || sensor.objId2 === objectId) s.sensors.delete(sensorId);
    }
  }, []);

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

  const refreshGroundMesh = useCallback(() => {
    const s = stateRef.current;
    const mesh = s.groundMesh;
    if (!mesh) return;
    const geometry = mesh.geometry as import('three').PlaneGeometry;
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = -positions.getY(index);
      positions.setZ(index, sampleGroundHeight(x, z, s.physicsRules));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }, []);

  // ── Command processing ────────────────────────────────────────────────────

  const processCommands = useCallback(() => {
    const s = stateRef.current;
    if (!s.THREE || !s.scene) return;
    const THREE = s.THREE;
    let shouldPublishState = false;
    const safeInverse = (value: number) => value > 1e-8 ? 1 / value : 0;
    const computeInvInertia = (shape: NonNullable<PhysicsCmd['shape']>, size: [number, number, number], radius: number, mass: number) => {
      if (!(mass > 0) || !Number.isFinite(mass)) return new THREE.Vector3();
      let ix = mass * radius * radius * 0.4;
      let iy = ix;
      let iz = ix;
      if (shape === 'box') {
        const [sx, sy, sz] = size;
        ix = (mass * (sy * sy + sz * sz)) / 12;
        iy = (mass * (sx * sx + sz * sz)) / 12;
        iz = (mass * (sx * sx + sy * sy)) / 12;
      } else if (shape === 'cylinder' || shape === 'cone') {
        const r = Math.max(size[0], size[2]) * 0.5;
        const h = size[1];
        ix = iz = (mass * (3 * r * r + h * h)) / 12;
        iy = 0.5 * mass * r * r;
      } else if (shape === 'capsule') {
        const r = radius;
        const h = Math.max(0, size[1] - 2 * r);
        ix = iz = (mass * (3 * r * r + h * h)) / 12;
        iy = 0.5 * mass * r * r;
      }
      return new THREE.Vector3(safeInverse(ix), safeInverse(iy), safeInverse(iz));
    };
    type SimBody = {
      id: string;
      position: import('three').Vector3;
      quaternion: import('three').Quaternion;
      velocity: import('three').Vector3;
      angularVelocity: import('three').Vector3;
      mass: number;
      invMass: number;
      invInertia: import('three').Vector3;
      radius: number;
      shape: NonNullable<PhysicsCmd['shape']>;
      size: [number, number, number];
      fixed: boolean;
      restitution: number;
      friction: number;
      contactedGround: boolean;
      ownerId?: string;
      team?: string;
      contactDamage: number;
    };
    type SimHinge = {
      id: string;
      a: string;
      b: string;
      axis: import('three').Vector3;
      anchorA: import('three').Vector3;
      anchorB: import('three').Vector3;
      angle: number;
      minAngle: number;
      maxAngle: number;
      motorSpeed: number;
      motorForce: number;
    };
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const supportExtentAlong = (body: { shape: NonNullable<PhysicsCmd['shape']>; size: [number, number, number]; radius: number; quaternion?: import('three').Quaternion; mesh?: import('three').Mesh }, normal: import('three').Vector3) => {
      const dir = normal.clone().normalize();
      const quaternion = body.quaternion ?? body.mesh?.quaternion;
      if (!quaternion) return body.radius;
      if (body.shape === 'sphere' || body.shape === 'icosahedron' || body.shape === 'tetrahedron' || body.shape === 'torus') return body.radius;
      if (body.shape === 'box') {
        const half = new THREE.Vector3(body.size[0] * 0.5, body.size[1] * 0.5, body.size[2] * 0.5);
        const axes = [
          new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
          new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
          new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
        ];
        return Math.abs(dir.dot(axes[0])) * half.x + Math.abs(dir.dot(axes[1])) * half.y + Math.abs(dir.dot(axes[2])) * half.z;
      }
      if (body.shape === 'capsule' || body.shape === 'cylinder' || body.shape === 'cone') {
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
        const halfLine = Math.max(0, body.size[1] * 0.5 - body.radius);
        return body.radius + Math.abs(dir.dot(axis)) * halfLine;
      }
      return body.radius;
    };
    const applyAxisTorqueToBody = (body: { quaternion?: import('three').Quaternion; mesh?: import('three').Mesh; invInertia: import('three').Vector3; angularVelocity: import('three').Vector3; fixed: boolean }, worldAxis: import('three').Vector3, torqueMagnitude: number) => {
      if (body.fixed || Math.abs(torqueMagnitude) < 1e-8) return;
      const quaternion = body.quaternion ?? body.mesh?.quaternion;
      if (!quaternion) return;
      const localAxis = worldAxis.clone().applyQuaternion(quaternion.clone().invert()).normalize();
      const invInertia =
        localAxis.x * localAxis.x * body.invInertia.x +
        localAxis.y * localAxis.y * body.invInertia.y +
        localAxis.z * localAxis.z * body.invInertia.z;
      if (invInertia <= 0) return;
      body.angularVelocity.addScaledVector(worldAxis, torqueMagnitude * invInertia);
    };
    const selectRootObjectId = (bodies: Map<string, PhysicsObject>, hinges: Map<string, HingeConstraint>) => {
      const children = new Set(Array.from(hinges.values()).map((hinge) => hinge.b));
      const candidates = Array.from(bodies.values()).filter((body) => !body.fixed);
      const pool = candidates.filter((body) => !children.has(body.id));
      const ranked = (pool.length > 0 ? pool : candidates).sort((left, right) => right.mass - left.mass);
      return ranked[0]?.id ?? null;
    };
    const controlledHingeIdsForRoot = (rootId: string, hinges: Map<string, HingeConstraint>) => {
      const prefix = rootId.split('_').slice(0, -1).join('_');
      const related = Array.from(hinges.values()).filter((hinge) => hinge.a === rootId || hinge.b === rootId || (prefix && hinge.id.includes(prefix)));
      return (related.length > 0 ? related : Array.from(hinges.values())).map((hinge) => hinge.id).sort();
    };
    const resolveRootId = (rootOrCombatantId?: string | null, combatantId?: string | null) => {
      if (combatantId && s.combatants.has(combatantId)) return s.combatants.get(combatantId)?.rootId ?? null;
      if (rootOrCombatantId && s.combatants.has(rootOrCombatantId)) return s.combatants.get(rootOrCombatantId)?.rootId ?? null;
      return rootOrCombatantId ?? null;
    };
    const nearestOpponentForRoot = (bodies: Map<string, SimBody>, rootId: string) => {
      const root = bodies.get(rootId);
      if (!root) return null;
      let best: SimBody | null = null;
      let bestDist = Infinity;
      for (const body of bodies.values()) {
        if (body.id === rootId || body.ownerId === root.ownerId) continue;
        const dist = body.position.distanceTo(root.position);
        if (dist < bestDist) {
          bestDist = dist;
          best = body;
        }
      }
      return best;
    };
    const buildObservation = (bodies: Map<string, SimBody>, hinges: SimHinge[], rootId: string) => {
      const root = bodies.get(rootId);
      if (!root) return { values: [0, 0, 0, 0, 0, 0, 1, 0] };
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
      const nearestOpponent = nearestOpponentForRoot(bodies, rootId);
      const combatant = root.ownerId ? s.combatants.get(root.ownerId) : null;
      const enemyCombatant = nearestOpponent?.ownerId ? s.combatants.get(nearestOpponent.ownerId) : null;
      const values = [
        root.position.x / 10,
        root.position.y / 5,
        root.position.z / 10,
        root.velocity.x / 6,
        root.velocity.y / 6,
        root.velocity.z / 6,
        up.y,
        (combatant?.health ?? 100) / Math.max(1, combatant?.maxHealth ?? 100),
        (enemyCombatant?.health ?? 100) / Math.max(1, enemyCombatant?.maxHealth ?? 100),
        nearestOpponent ? (nearestOpponent.position.x - root.position.x) / 12 : 0,
        nearestOpponent ? (nearestOpponent.position.z - root.position.z) / 12 : 0,
        nearestOpponent ? nearestOpponent.velocity.length() / 8 : 0,
        Math.max(0, root.position.length() - s.physicsRules.arenaHalfExtent) / Math.max(1, s.physicsRules.arenaHalfExtent),
      ];
      for (const hinge of hinges) values.push(hinge.angle / Math.PI, hinge.motorSpeed / 8);
      values.push(Array.from(bodies.values()).filter((body) => body.contactedGround).length / Math.max(1, bodies.size));
      return { values };
    };
    const cloneSimulationState = () => {
      const bodies = new Map<string, SimBody>();
      for (const [id, body] of s.objects.entries()) {
        bodies.set(id, {
          id,
          position: body.mesh.position.clone(),
          quaternion: body.mesh.quaternion.clone(),
          velocity: body.velocity.clone(),
          angularVelocity: body.angularVelocity.clone(),
          mass: body.mass,
          invMass: body.invMass,
          invInertia: body.invInertia.clone(),
          radius: body.radius,
          shape: body.shape,
          size: [...body.size] as [number, number, number],
          fixed: body.fixed,
          restitution: body.restitution,
          friction: body.friction,
          contactedGround: false,
          ownerId: body.ownerId,
          team: body.team,
          contactDamage: body.contactDamage,
        });
      }
      const hinges = Array.from(s.hinges.values()).map((hinge) => ({
        id: hinge.id,
        a: hinge.a,
        b: hinge.b,
        axis: hinge.axis.clone(),
        anchorA: hinge.anchorA.clone(),
        anchorB: hinge.anchorB.clone(),
        angle: hinge.angle,
        minAngle: hinge.minAngle,
        maxAngle: hinge.maxAngle,
        motorSpeed: hinge.motorSpeed,
        motorForce: hinge.motorForce,
      }));
      const combatants = new Map<string, Combatant>();
      for (const [id, combatant] of s.combatants.entries()) {
        combatants.set(id, {
          ...combatant,
          hingeIds: [...combatant.hingeIds],
          partIds: [...combatant.partIds],
        });
      }
      return { bodies, hinges, combatants };
    };
    const applyCombatDamage = (
      combatants: Map<string, Combatant>,
      attackerId: string | undefined,
      defenderId: string | undefined,
      amount: number,
      pairCooldowns: Map<string, number>,
      clock: number,
    ) => {
      if (!defenderId || attackerId === defenderId || amount <= 0) return;
      const attacker = attackerId ? combatants.get(attackerId) : null;
      const defender = combatants.get(defenderId);
      if (!defender || defender.eliminated) return;
      if (attacker && !s.physicsRules.friendlyFire && attacker.team === defender.team) return;
      const pairKey = `${attackerId}->${defenderId}`;
      const lastHit = pairCooldowns.get(pairKey) ?? -Infinity;
      if (clock - lastHit < 0.12) return;
      pairCooldowns.set(pairKey, clock);
      defender.health = Math.max(0, defender.health - amount);
      if (defender.health <= 0) defender.eliminated = true;
    };
    const simulateBodiesStep = (bodies: Map<string, SimBody>, hinges: SimHinge[], combatants: Map<string, Combatant>, dtStep: number, clockRef: { value: number }, pairCooldowns: Map<string, number>) => {
      for (const body of bodies.values()) body.contactedGround = false;
      clockRef.value += dtStep;
      for (const hinge of hinges) {
        const a = bodies.get(hinge.a);
        const b = bodies.get(hinge.b);
        if (!a || !b) continue;
        const worldAnchorA = hinge.anchorA.clone().applyQuaternion(a.quaternion).add(a.position);
        const worldAnchorB = hinge.anchorB.clone().applyQuaternion(b.quaternion).add(b.position);
        const correction = worldAnchorB.clone().sub(worldAnchorA);
        const corrLen = correction.length();
        const invMassSum = a.invMass + b.invMass;
        if (corrLen > 1e-4 && invMassSum > 0) {
          const corrDir = correction.normalize();
          const correctionSpeed = clamp(corrLen * 18, 0, 4);
          if (a.invMass > 0) a.velocity.addScaledVector(corrDir, correctionSpeed * (a.invMass / invMassSum));
          if (b.invMass > 0) b.velocity.addScaledVector(corrDir, -correctionSpeed * (b.invMass / invMassSum));
        }
        const worldAxis = hinge.axis.clone().applyQuaternion(a.quaternion).normalize();
        const relOmega = a.angularVelocity.clone().sub(b.angularVelocity).dot(worldAxis);
        hinge.angle = clamp(hinge.angle + relOmega * dtStep, -Math.PI * 4, Math.PI * 4);
        let torque = clamp((hinge.motorSpeed - relOmega) * 14, -hinge.motorForce, hinge.motorForce);
        const limitedAngle = clamp(hinge.angle, hinge.minAngle, hinge.maxAngle);
        if (Math.abs(limitedAngle - hinge.angle) > 1e-5) {
          const limitError = limitedAngle - hinge.angle;
          torque += clamp(limitError * 90 - relOmega * 8, -hinge.motorForce * 1.35, hinge.motorForce * 1.35);
          hinge.angle = limitedAngle;
        }
        applyAxisTorqueToBody(a, worldAxis, torque * dtStep);
        applyAxisTorqueToBody(b, worldAxis, -torque * dtStep);
      }
      for (const body of bodies.values()) {
        if (body.fixed) continue;
        body.velocity.addScaledVector(s.gravity, dtStep);
        body.velocity.multiplyScalar(Math.pow(0.985, dtStep * 60));
        body.angularVelocity.multiplyScalar(Math.pow(0.88, dtStep * 60));
        body.position.addScaledVector(body.velocity, dtStep);
        const omega = body.angularVelocity.length();
        if (omega > 1e-5) {
          const dq = new THREE.Quaternion().setFromAxisAngle(body.angularVelocity.clone().normalize(), omega * dtStep);
          body.quaternion.premultiply(dq).normalize();
        }
        const floor = supportExtentAlong(body, new THREE.Vector3(0, 1, 0));
        if (body.position.y < floor) {
          body.position.y = floor;
          body.contactedGround = true;
          if (body.velocity.y < 0) body.velocity.y *= -body.restitution;
          const grip = clamp(1 - Math.max(body.friction, s.physicsRules.groundFriction) * dtStep * 18, 0.2, 1);
          body.velocity.x *= grip;
          body.velocity.z *= grip;
        }
        if (s.physicsRules.hazardRingRadius > 0) {
          const radialDistance = Math.sqrt(body.position.x * body.position.x + body.position.z * body.position.z);
          if (radialDistance > s.physicsRules.hazardRingRadius && body.ownerId) {
            applyCombatDamage(combatants, '__hazard__', body.ownerId, s.physicsRules.hazardRingDamagePerSecond * dtStep, pairCooldowns, clockRef.value + radialDistance * 0.0001);
          }
        }
        if (s.physicsRules.boundaryDamagePerSecond > 0 && body.ownerId) {
          const overflow = Math.max(0, Math.abs(body.position.x) - s.physicsRules.arenaHalfExtent) + Math.max(0, Math.abs(body.position.z) - s.physicsRules.arenaHalfExtent);
          if (overflow > 0) {
            applyCombatDamage(combatants, '__boundary__', body.ownerId, overflow * s.physicsRules.boundaryDamagePerSecond * dtStep, pairCooldowns, clockRef.value + overflow * 0.0001);
          }
        }
      }
      const list = Array.from(bodies.values());
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.fixed && b.fixed) continue;
          const delta = b.position.clone().sub(a.position);
          const dist2 = delta.lengthSq();
          const minDist = a.radius + b.radius;
          if (dist2 >= minDist * minDist || dist2 < 1e-8) continue;
          const dist = Math.sqrt(dist2);
          const normal = delta.multiplyScalar(1 / dist);
          const invMassSum = a.invMass + b.invMass;
          if (invMassSum <= 0) continue;
          const penetration = minDist - dist;
          if (a.invMass > 0) a.position.addScaledVector(normal, -(penetration * (a.invMass / invMassSum)));
          if (b.invMass > 0) b.position.addScaledVector(normal, penetration * (b.invMass / invMassSum));
          const relVel = b.velocity.clone().sub(a.velocity).dot(normal);
          if (relVel >= 0) continue;
          const restitution = Math.min(a.restitution, b.restitution);
          const impulse = (-(1 + restitution) * relVel) / invMassSum;
          if (a.invMass > 0) a.velocity.addScaledVector(normal, -impulse * a.invMass);
          if (b.invMass > 0) b.velocity.addScaledVector(normal, impulse * b.invMass);
          const impactSpeed = Math.abs(relVel);
          if (impactSpeed > s.physicsRules.impactDamageThreshold) {
            const averageDamage = (a.contactDamage + b.contactDamage) * 0.5;
            const damage = Math.max(0, (impactSpeed - s.physicsRules.impactDamageThreshold) * s.physicsRules.contactDamageScale * averageDamage * dtStep);
            applyCombatDamage(combatants, a.ownerId, b.ownerId, damage, pairCooldowns, clockRef.value);
            applyCombatDamage(combatants, b.ownerId, a.ownerId, damage, pairCooldowns, clockRef.value + 0.00001);
          }
        }
      }
    };
    const evaluateNetworkOnCreature = (net: NeuralNet, rootId: string, hingeIds: string[], simSteps: number, rewardFn: (creature: Record<string, unknown>, step: number) => number) => {
      const { bodies, hinges, combatants } = cloneSimulationState();
      const controlled = hingeIds.map((hingeId) => hinges.find((hinge) => hinge.id === hingeId)).filter((hinge): hinge is SimHinge => Boolean(hinge));
      if (!bodies.has(rootId) || controlled.length === 0) return { reward: -Infinity };
      const maxMotorSpeed = 7;
      const baseMotorForce = Math.max(20, ...controlled.map((hinge) => hinge.motorForce || 0), 45);
      const clockRef = { value: 0 };
      const pairCooldowns = new Map<string, number>();
      let totalReward = 0;
      for (let step = 0; step < simSteps; step++) {
        const actions = net.forward(buildObservation(bodies, controlled, rootId).values);
        for (let i = 0; i < controlled.length; i++) {
          controlled[i].motorSpeed = clamp(actions[i] ?? 0, -1, 1) * maxMotorSpeed;
          controlled[i].motorForce = baseMotorForce;
        }
        for (const [combatantId, controller] of s.activeControllers.entries()) {
          if (controller.rootId === rootId) continue;
          const liveCombatant = combatants.get(combatantId);
          if (!liveCombatant || liveCombatant.eliminated) continue;
          const opponentHinges = controller.hingeIds.map((hingeId) => hinges.find((hinge) => hinge.id === hingeId)).filter((hinge): hinge is SimHinge => Boolean(hinge));
          if (opponentHinges.length === 0 || !bodies.has(controller.rootId)) continue;
          const opponentActions = controller.net.forward(buildObservation(bodies, opponentHinges, controller.rootId).values);
          for (let i = 0; i < opponentHinges.length; i++) {
            opponentHinges[i].motorSpeed = clamp(opponentActions[i] ?? 0, -1, 1) * controller.maxMotorSpeed;
            opponentHinges[i].motorForce = Math.max(opponentHinges[i].motorForce, controller.baseMotorForce);
          }
        }
        for (let sub = 0; sub < 4; sub++) simulateBodiesStep(bodies, hinges, combatants, 0.016 / 4, clockRef, pairCooldowns);
        const root = bodies.get(rootId)!;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
        const selfCombatant = root.ownerId ? combatants.get(root.ownerId) : null;
        const nearestOpponent = nearestOpponentForRoot(bodies, rootId);
        const opponentCombatant = nearestOpponent?.ownerId ? combatants.get(nearestOpponent.ownerId) : null;
        const creature = {
          pos: root.position.toArray(),
          vel: root.velocity.toArray(),
          up: up.toArray(),
          hingeAngles: controlled.map((hinge) => hinge.angle),
          hingeSpeeds: controlled.map((hinge) => hinge.motorSpeed),
          contacts: Array.from(bodies.values()).filter((body) => body.contactedGround).map((body) => body.id),
          ownHealth: selfCombatant?.health ?? null,
          ownMaxHealth: selfCombatant?.maxHealth ?? null,
          opponentHealth: opponentCombatant?.health ?? null,
          opponentMaxHealth: opponentCombatant?.maxHealth ?? null,
          enemy: nearestOpponent
            ? {
                id: nearestOpponent.id,
                pos: nearestOpponent.position.toArray(),
                vel: nearestOpponent.velocity.toArray(),
              }
            : null,
          fallen: up.y < 0.2 || root.position.y < 0.35,
          step,
        };
        try {
          totalReward += rewardFn(creature, step);
        } catch {
          totalReward += (selfCombatant?.maxHealth ?? 100) - (opponentCombatant?.health ?? 0) + root.position.x - Math.abs(root.velocity.y) * 0.2;
        }
        if (creature.fallen) totalReward -= 8;
        if (selfCombatant?.eliminated) totalReward -= 40;
        if (opponentCombatant?.eliminated) totalReward += 60;
      }
      return { reward: totalReward };
    };

    const publishState = () => {
      const objState: Record<string, object> = {};
      for (const [id, obj] of s.objects) {
        objState[id] = {
          position: obj.mesh.position.toArray(),
          velocity: obj.velocity.toArray(),
          angularVelocity: obj.angularVelocity.toArray(),
          sleeping: obj.sleeping,
          mass: obj.mass,
          radius: obj.radius,
          restitution: obj.restitution,
          friction: obj.friction,
          fixed: obj.fixed,
          ownerId: obj.ownerId ?? null,
          team: obj.team ?? null,
          contactDamage: obj.contactDamage,
          partRole: obj.partRole ?? null,
        };
      }
      const hingeState: Record<string, object> = {};
      for (const [id, h] of s.hinges) {
        hingeState[id] = {
          a: h.a,
          b: h.b,
          motorSpeed: h.motorSpeed,
          motorForce: h.motorForce,
          minAngle: h.minAngle,
          maxAngle: h.maxAngle,
        };
      }
      const sensorState: Record<string, object> = {};
      for (const [id, sensor] of s.sensors) {
        const primary = sensor.objId ? s.objects.get(sensor.objId) : null;
        const secondary = sensor.objId2 ? s.objects.get(sensor.objId2) : null;
        let reading: number | boolean | null = null;
        if (sensor.type === 'distance') {
          if (primary && secondary) reading = primary.mesh.position.distanceTo(secondary.mesh.position);
          else if (primary && Array.isArray(sensor.target)) reading = primary.mesh.position.distanceTo(new THREE.Vector3(...sensor.target));
        } else if (sensor.type === 'speed') {
          if (primary) reading = primary.velocity.length();
        } else if (sensor.type === 'angle') {
          const hinge = s.hinges.get(sensor.id) ?? (sensor.objId ? Array.from(s.hinges.values()).find((entry) => entry.a === sensor.objId || entry.b === sensor.objId) : undefined);
          reading = hinge?.angle ?? null;
        } else if (sensor.type === 'contact') {
          if (primary) reading = primary.mesh.position.y <= supportExtentAlong(primary, new THREE.Vector3(0, 1, 0)) + 0.01;
        } else if (sensor.type === 'health') {
          const combatantId = typeof sensor.target === 'string' ? sensor.target : primary?.ownerId;
          reading = combatantId ? s.combatants.get(combatantId)?.health ?? null : null;
        } else if (sensor.type === 'enemy_distance') {
          if (primary?.ownerId) {
            const enemy = Array.from(s.objects.values())
              .filter((candidate) => candidate.ownerId && candidate.ownerId !== primary.ownerId)
              .sort((left, right) => left.mesh.position.distanceTo(primary.mesh.position) - right.mesh.position.distanceTo(primary.mesh.position))[0];
            reading = enemy ? primary.mesh.position.distanceTo(enemy.mesh.position) : null;
          }
        } else if (sensor.type === 'boundary_distance') {
          if (primary) reading = Math.max(0, s.physicsRules.arenaHalfExtent - Math.max(Math.abs(primary.mesh.position.x), Math.abs(primary.mesh.position.z)));
        }
        sensorState[id] = {
          type: sensor.type,
          objId: sensor.objId ?? null,
          objId2: sensor.objId2 ?? null,
          target: sensor.target ?? null,
          reading,
        };
      }
      const combatantState: Record<string, object> = {};
      for (const [id, combatant] of s.combatants) {
        combatantState[id] = {
          rootId: combatant.rootId,
          team: combatant.team,
          health: combatant.health,
          maxHealth: combatant.maxHealth,
          aggression: combatant.aggression,
          contactDamage: combatant.contactDamage,
          hingeIds: [...combatant.hingeIds],
          partIds: [...combatant.partIds],
          eliminated: combatant.eliminated,
        };
      }
      const activeControllers: Record<string, object> = {};
      for (const [rootId, controller] of s.activeControllers) {
        activeControllers[rootId] = {
          controllerId: controller.controllerId ?? null,
          combatantId: controller.combatantId ?? null,
          rootId: controller.rootId,
          hingeIds: [...controller.hingeIds],
          step: controller.step,
          maxMotorSpeed: controller.maxMotorSpeed,
          baseMotorForce: controller.baseMotorForce,
          bestReward: controller.bestReward ?? null,
          networkSizes: [...controller.net.sizes],
        };
      }
      const primaryController = s.primaryControllerRootId ? s.activeControllers.get(s.primaryControllerRootId) ?? null : Array.from(s.activeControllers.values())[0] ?? null;
      const statePayload = {
        objects: objState,
        hinges: hingeState,
        sensors: sensorState,
        combatants: combatantState,
        rules: { ...s.physicsRules },
        trainingLog: s.trainingLog,
        activeController: primaryController
          ? {
              controllerId: primaryController.controllerId ?? null,
              combatantId: primaryController.combatantId ?? null,
              rootId: primaryController.rootId,
              hingeIds: primaryController.hingeIds,
              step: primaryController.step,
              maxMotorSpeed: primaryController.maxMotorSpeed,
              baseMotorForce: primaryController.baseMotorForce,
              bestReward: primaryController.bestReward ?? null,
              networkSizes: [...primaryController.net.sizes],
            }
          : null,
        activeControllers,
        objectCount: Object.keys(objState).length,
        hingeCount: Object.keys(hingeState).length,
        sensorCount: Object.keys(sensorState).length,
        combatantCount: Object.keys(combatantState).length,
        timestamp: Date.now(),
      };
      fetch('/api/physics-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statePayload),
      }).catch(() => {});
    };

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
          const resolvedShape = shape as NonNullable<PhysicsCmd['shape']>;
          const resolvedSize: [number, number, number] =
            resolvedShape === "sphere" || resolvedShape === "icosahedron" || resolvedShape === "tetrahedron"
              ? [radius * 2, radius * 2, radius * 2]
              : resolvedShape === "capsule"
                ? [radius * 2, (cmd.size?.[1] ?? 1.0) + radius * 2, radius * 2]
                : resolvedShape === "cylinder" || resolvedShape === "cone"
                  ? [(cmd.radius ?? 0.4) * 2, cmd.size?.[1] ?? 1.2, (cmd.radius ?? 0.4) * 2]
                  : resolvedShape === "torus"
                    ? [radius * 2.8, radius * 0.8, radius * 2.8]
                    : (cmd.size ?? [1, 1, 1]);
          const invInertia = isFixed ? new THREE.Vector3() : computeInvInertia(resolvedShape, resolvedSize, radius, mass);
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
          if (cmd.objId) removeObject(cmd.objId);

          s.scene.add(mesh);
          if (cmd.objId) {
            s.objects.set(cmd.objId, {
              id: cmd.objId, mesh,
              velocity: new THREE.Vector3(),
              angularVelocity: new THREE.Vector3(),
              mass: isFixed ? 1e9 : mass,
              invMass: isFixed ? 0 : safeInverse(mass),
              invInertia,
              radius, restitution, friction,
              shape: resolvedShape,
              size: resolvedSize,
              fixed: isFixed,
              sleeping: isFixed,  // fixed bodies don't simulate
              sleepTimer: isFixed ? 999 : 0,
              ownerId: undefined,
              team: cmd.team,
              contactDamage: Math.max(0.1, Number(cmd.contactDamage ?? 1)),
              partRole: undefined,
            });
          }
          shouldPublishState = true;
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
            shouldPublishState = true;
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
            shouldPublishState = true;
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
            shouldPublishState = true;
          }
          break;
        }
        case "set_velocity": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.velocity) {
            obj.velocity.set(...cmd.velocity);
            obj.sleeping = false; obj.sleepTimer = 0;
            shouldPublishState = true;
          }
          break;
        }
        case "set_angular_velocity": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.angularVelocity) {
            obj.angularVelocity.set(...cmd.angularVelocity);
            obj.sleeping = false; obj.sleepTimer = 0;
            shouldPublishState = true;
          }
          break;
        }
        case "set_position": {
          const obj = cmd.objId ? s.objects.get(cmd.objId) : null;
          if (obj && cmd.position) {
            obj.mesh.position.set(...cmd.position);
            obj.velocity.set(0, 0, 0);
            obj.sleeping = false; obj.sleepTimer = 0;
            shouldPublishState = true;
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
            case "contactDamage": obj.contactDamage = Math.max(0.1, Number(cmd.value)); break;
            case "team": obj.team = String(cmd.value ?? obj.team ?? 'neutral'); break;
          }
          mat.needsUpdate = true;
          shouldPublishState = true;
          break;
        }

        // ── gravity ───────────────────────────────────────────────────────
        case "set_gravity": {
          if (cmd.gravity) {
            s.gravity.set(...cmd.gravity);
            shouldPublishState = true;
          }
          break;
        }

        // ── set_rules ─────────────────────────────────────────────────────
        case "set_rules": {
          if (cmd.gravity) s.gravity.set(...cmd.gravity);
          s.physicsRules = {
            ...s.physicsRules,
            ...(typeof cmd.arenaHalfExtent === 'number' ? { arenaHalfExtent: Math.max(6, cmd.arenaHalfExtent) } : {}),
            ...(typeof cmd.wallRestitution === 'number' ? { wallRestitution: Math.max(0, Math.min(1, cmd.wallRestitution)) } : {}),
            ...(typeof cmd.groundFriction === 'number' ? { groundFriction: Math.max(0, Math.min(1, cmd.groundFriction)) } : {}),
            ...(cmd.groundProfile === 'flat' || cmd.groundProfile === 'hills' ? { groundProfile: cmd.groundProfile } : {}),
            ...(typeof cmd.groundAmplitude === 'number' ? { groundAmplitude: Math.max(0, Math.min(6, cmd.groundAmplitude)) } : {}),
            ...(typeof cmd.groundFrequency === 'number' ? { groundFrequency: Math.max(0.02, Math.min(1.2, cmd.groundFrequency)) } : {}),
            ...(typeof cmd.contactDamageScale === 'number' ? { contactDamageScale: Math.max(0, cmd.contactDamageScale) } : {}),
            ...(typeof cmd.impactDamageThreshold === 'number' ? { impactDamageThreshold: Math.max(0.1, cmd.impactDamageThreshold) } : {}),
            ...(typeof cmd.boundaryDamagePerSecond === 'number' ? { boundaryDamagePerSecond: Math.max(0, cmd.boundaryDamagePerSecond) } : {}),
            ...(typeof cmd.hazardRingRadius === 'number' ? { hazardRingRadius: Math.max(0, cmd.hazardRingRadius) } : {}),
            ...(typeof cmd.hazardRingDamagePerSecond === 'number' ? { hazardRingDamagePerSecond: Math.max(0, cmd.hazardRingDamagePerSecond) } : {}),
            ...(typeof cmd.friendlyFire === 'boolean' ? { friendlyFire: cmd.friendlyFire } : {}),
            ...(typeof cmd.allowSleep === 'boolean' ? { allowSleep: cmd.allowSleep } : {}),
          };
          refreshGroundMesh();
          shouldPublishState = true;
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
          shouldPublishState = true;
          break;
        }
        case "remove_spring": {
          if (cmd.springId) {
            s.springs.delete(cmd.springId);
            shouldPublishState = true;
          }
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
          shouldPublishState = true;
          break;
        }

        // ── get_state ─────────────────────────────────────────────────────
        case "get_state": {
          publishState();
          break;
        }

        // ── reset ─────────────────────────────────────────────────────────
        case "reset": {
          if (cmd.objId) removeObject(cmd.objId);
          for (const objectId of Array.from(s.objects.keys())) removeObject(objectId);
          s.springs.clear();
          s.hinges.clear();
          s.sensors.clear();
          s.combatants.clear();
          s.activeControllers.clear();
          s.primaryControllerRootId = null;
          s.combatHitCooldowns.clear();
          s.physicsRules = { ...DEFAULT_PHYSICS_RULES };
          refreshGroundMesh();
          s.simTime = 0;
          s.trainingLog = [];
          s.activeController = null;
          s.gravity.set(0, -9.81, 0);
          s.orbitTarget.set(0, 0, 0);
          s.orbitTheta = 0.6; s.orbitPhi = 0.42; s.orbitRadius = 18;
          if (s.scene) s.scene.background = new THREE.Color(0x0a0b10);
          updateCamera();
          shouldPublishState = true;
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
            shouldPublishState = true;
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
          shouldPublishState = true;
          break;
        }

        // ── set_motor ─────────────────────────────────────────────────────
        case "set_motor": {
          if (!cmd.hingeId) break;
          const hinge = s.hinges.get(cmd.hingeId);
          if (hinge) {
            hinge.motorSpeed = cmd.motorSpeed ?? 0;
            hinge.motorForce = cmd.motorForce ?? 10;
            shouldPublishState = true;
          }
          break;
        }

        // ── remove_hinge ─────────────────────────────────────────────────
        case "remove_hinge": {
          if (cmd.hingeId) {
            s.hinges.delete(cmd.hingeId);
            shouldPublishState = true;
          }
          break;
        }

        // ── add_sensor ────────────────────────────────────────────────────
        case "add_sensor": {
          if (!cmd.sensorId || !cmd.sensorType) break;
          s.sensors.set(cmd.sensorId, {
            id: cmd.sensorId,
            type: cmd.sensorType,
            objId: cmd.objId,
            objId2: cmd.objId2,
            target: cmd.target,
          });
          console.info("[PhysicsSimulator] sensor registered:", cmd.sensorId, cmd.sensorType, cmd.objId, cmd.objId2);
          shouldPublishState = true;
          break;
        }

        // ── spawn_creature ────────────────────────────────────────────────
        case "spawn_creature": {
          if (!cmd.bodyPlan || !cmd.creatureId) break;
          const creaturePrefix = `${cmd.creatureId}_`;
          for (const existingId of Array.from(s.objects.keys())) {
            if (existingId.startsWith(creaturePrefix)) removeObject(existingId);
          }
          for (const hingeId of Array.from(s.hinges.keys())) {
            if (hingeId.startsWith(`${cmd.creatureId}_hinge_`)) s.hinges.delete(hingeId);
          }
          s.combatants.delete(cmd.creatureId);
          for (const [existingRootId, controller] of Array.from(s.activeControllers.entries())) {
            if (controller.combatantId === cmd.creatureId || existingRootId.startsWith(`${cmd.creatureId}_`)) {
              s.activeControllers.delete(existingRootId);
            }
          }

          const partIds = new Set(cmd.bodyPlan.map((part) => part.id));
          const creaturePartIds: string[] = [];
          const rootPart = cmd.bodyPlan.find((part) => !part.hinges || part.hinges.length === 0) ?? cmd.bodyPlan[0];
          for (const part of cmd.bodyPlan) {
            const partId = `${cmd.creatureId}_${part.id}`;
            creaturePartIds.push(partId);
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
              mass,
              invMass: safeInverse(mass),
              invInertia: computeInvInertia((part.shape as NonNullable<PhysicsCmd['shape']>) ?? 'box', part.shape === "sphere" ? [radius * 2, radius * 2, radius * 2] : part.shape === "capsule" ? [radius * 2, (part.size?.[1] ?? 0.8) + radius * 2, radius * 2] : (part.size ?? [0.6, 0.6, 0.6]), radius, mass),
              radius,
              shape: ((part.shape as NonNullable<PhysicsCmd['shape']>) ?? 'box'),
              size: part.shape === "sphere" ? [radius * 2, radius * 2, radius * 2] : part.shape === "capsule" ? [radius * 2, (part.size?.[1] ?? 0.8) + radius * 2, radius * 2] : (part.size ?? [0.6, 0.6, 0.6]),
              fixed: false,
              restitution: 0.2, friction: 0.7,
              sleeping: false, sleepTimer: 0,
              ownerId: cmd.creatureId,
              team: cmd.team ?? cmd.creatureId,
              contactDamage: Math.max(0.15, Number(part.contactDamage ?? cmd.contactDamage ?? 1)),
              partRole: part.role ?? undefined,
            });
          }
          for (const part of cmd.bodyPlan) {
            if (!part.hinges) continue;
            const partId = `${cmd.creatureId}_${part.id}`;
            for (const h of part.hinges) {
              if (!partIds.has(h.parentId)) {
                console.warn("[PhysicsSimulator] spawn_creature hinge skipped: missing parent", h.parentId, "for", part.id);
                continue;
              }
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
          const rootId = `${cmd.creatureId}_${rootPart.id}`;
          const hingeIds = Array.from(s.hinges.values()).filter((hinge) => hinge.id.startsWith(`${cmd.creatureId}_hinge_`)).map((hinge) => hinge.id);
          s.combatants.set(cmd.creatureId, {
            id: cmd.creatureId,
            rootId,
            hingeIds,
            partIds: creaturePartIds,
            team: cmd.team ?? cmd.creatureId,
            health: Math.max(1, Number(cmd.health ?? 100)),
            maxHealth: Math.max(1, Number(cmd.health ?? 100)),
            aggression: Math.max(0, Number(cmd.aggression ?? 1)),
            contactDamage: Math.max(0.15, Number(cmd.contactDamage ?? 1)),
            eliminated: false,
          });
          shouldPublishState = true;
          break;
        }

        // ── run_training_loop ─────────────────────────────────────────────
        case "run_training_loop": {
          const generations = cmd.generations ?? 30;
          const popSize = cmd.populationSize ?? 20;
          const simSteps = cmd.simSteps ?? 300;
          const mutRate = cmd.mutationRate ?? 0.15;
          const rewardSrc = cmd.rewardFn ?? "(creature) => creature.pos ? creature.pos[0] - 0.25 * Math.abs(creature.vel?.[1] ?? 0) + 0.6 * (creature.up?.[1] ?? 0) - (creature.fallen ? 4 : 0) : 0";
          const rootId = resolveRootId(cmd.controllerRootId, cmd.combatantId) ?? selectRootObjectId(s.objects, s.hinges);
          const hingeIds = rootId ? controlledHingeIdsForRoot(rootId, s.hinges) : [];
          const combatantId = cmd.combatantId ?? Array.from(s.combatants.values()).find((combatant) => combatant.rootId === rootId)?.id;

          if (!rootId || hingeIds.length === 0) {
            s.trainingLog = ['ERROR: build an articulated creature with at least one hinge before training.'];
            break;
          }

          const inputDim = buildObservation(cloneSimulationState().bodies, hingeIds.map((hingeId) => cloneSimulationState().hinges.find((hinge) => hinge.id === hingeId)).filter((hinge): hinge is SimHinge => Boolean(hinge)), rootId).values.length;
          const hiddenLayers = Array.isArray(cmd.networkLayers) && cmd.networkLayers.length > 0 ? cmd.networkLayers : [48, 32];
          const layerSizes = [inputDim, ...hiddenLayers, hingeIds.length];

          s.trainingLog = [`Training articulated creature: ${generations} gens × ${popSize} policies × ${simSteps} steps on ${hingeIds.length} hinges`];
          console.info("[PhysicsSimulator] Training start:", s.trainingLog[0]);

          let rewardFn: (creature: object, step: number) => number;
          try {
            rewardFn = new Function("creature", "step", `return (${rewardSrc})(creature, step)`) as any;
          } catch (e) {
            console.warn("[PhysicsSimulator] Invalid reward function:", e);
            s.trainingLog.push("ERROR: invalid reward function");
            break;
          }

          let population: NeuralNet[] = Array.from({ length: popSize }, () => new NeuralNet(layerSizes));
          let bestNet: NeuralNet = population[0];
          let bestReward = -Infinity;

          for (let gen = 0; gen < generations; gen++) {
            const rewards: number[] = population.map((net) => evaluateNetworkOnCreature(net, rootId, hingeIds, simSteps, rewardFn).reward);

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

            const eliteCount = Math.max(2, Math.floor(popSize * 0.25));
            population = [
              ...ranked.slice(0, eliteCount).map(r => r.net),
              ...Array.from({ length: popSize - eliteCount }, (_, i) => ranked[i % eliteCount].net.mutate(mutRate)),
            ];
          }

          s.activeController = {
            controllerId: cmd.controllerId ?? `${rootId}-controller`,
            combatantId,
            rootId,
            hingeIds,
            net: bestNet.clone(),
            step: 0,
            maxMotorSpeed: 7,
            baseMotorForce: Math.max(20, ...hingeIds.map((hingeId) => s.hinges.get(hingeId)?.motorForce ?? 0), 45),
            bestReward,
          };
          s.activeControllers.set(rootId, s.activeController);
          s.primaryControllerRootId = rootId;

          s.trainingLog.push(`Done! Best reward: ${bestReward.toFixed(2)}. Installed trained controller on ${hingeIds.length} live hinges for root '${rootId}'.`);
          console.info("[PhysicsSimulator] Training complete. Best reward:", bestReward.toFixed(2));
          fetch('/api/physics-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainingLog: s.trainingLog, bestReward, trainedRootId: rootId, trainedHinges: hingeIds, timestamp: Date.now() }),
          }).catch(() => {});
          shouldPublishState = true;
          break;
        }

        // ── save_controller ───────────────────────────────────────────────
        case "save_controller": {
          const rootId = resolveRootId(cmd.controllerRootId, cmd.combatantId) ?? s.primaryControllerRootId;
          const activeController = rootId ? s.activeControllers.get(rootId) ?? null : null;
          if (!activeController) {
            s.trainingLog.push('ERROR: no active controller to save. Train or load one first.');
            shouldPublishState = true;
            break;
          }
          const controllerId = cmd.controllerId ?? activeController.controllerId ?? `${activeController.rootId}-controller`;
          const payload = serializeController({
            ...activeController,
            controllerId,
          });
          fetch('/api/physics-controller', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save',
              controllerId,
              controller: payload,
              performanceScore: payload.bestReward ?? 0,
              iterations: payload.step,
              metadata: {
                rootId: payload.rootId,
                hingeIds: payload.hingeIds,
                networkSizes: payload.network.sizes,
              },
            }),
          })
            .then((response) => response.json())
            .then((result) => {
              if (result?.error) {
                s.trainingLog.push(`ERROR: failed to save controller '${controllerId}': ${result.error}`);
              } else {
                const updated = { ...activeController, controllerId };
                s.activeControllers.set(updated.rootId, updated);
                s.activeController = updated;
                s.primaryControllerRootId = updated.rootId;
                s.trainingLog.push(`Saved controller '${controllerId}' to ${result.filepath ?? 'weights store'}.`);
              }
              publishState();
            })
            .catch((error) => {
              s.trainingLog.push(`ERROR: failed to save controller '${controllerId}': ${String(error)}`);
              publishState();
            });
          break;
        }

        // ── load_controller ───────────────────────────────────────────────
        case "load_controller": {
          if (!cmd.controllerId) {
            s.trainingLog.push('ERROR: load_controller requires controllerId.');
            shouldPublishState = true;
            break;
          }
          const requestedRootId = cmd.controllerRootId;
          const requestedHinges = cmd.trainedHinges;
          fetch(`/api/physics-controller?id=${encodeURIComponent(cmd.controllerId)}`)
            .then((response) => response.json())
            .then((result) => {
              if (result?.error || !result?.controller) {
                s.trainingLog.push(`ERROR: controller '${cmd.controllerId}' could not be loaded.`);
                publishState();
                return;
              }
              const loaded = result.controller as SerializedPhysicsController;
              const rootId = resolveRootId(requestedRootId ?? loaded.rootId, cmd.combatantId) ?? selectRootObjectId(s.objects, s.hinges);
              if (!rootId || !s.objects.has(rootId)) {
                s.trainingLog.push(`ERROR: controller '${cmd.controllerId}' loaded, but root '${rootId ?? 'unknown'}' is not present in the scene.`);
                publishState();
                return;
              }
              const hingeIds = Array.isArray(requestedHinges) && requestedHinges.length > 0
                ? requestedHinges.filter((hingeId) => s.hinges.has(hingeId))
                : (loaded.hingeIds ?? []).filter((hingeId) => s.hinges.has(hingeId));
              const resolvedHinges = hingeIds.length > 0 ? hingeIds : controlledHingeIdsForRoot(rootId, s.hinges);
              const net = deserializeNeuralNet(loaded.network);
              if (net.sizes[net.sizes.length - 1] !== resolvedHinges.length) {
                s.trainingLog.push(`ERROR: controller '${cmd.controllerId}' expects ${net.sizes[net.sizes.length - 1]} hinge outputs, but the scene exposes ${resolvedHinges.length}.`);
                publishState();
                return;
              }
              const combatantId = cmd.combatantId ?? Array.from(s.combatants.values()).find((combatant) => combatant.rootId === rootId)?.id;
              s.activeController = {
                controllerId: loaded.controllerId ?? cmd.controllerId,
                combatantId,
                rootId,
                hingeIds: resolvedHinges,
                net,
                step: 0,
                maxMotorSpeed: loaded.maxMotorSpeed ?? 7,
                baseMotorForce: loaded.baseMotorForce ?? 45,
                bestReward: loaded.bestReward,
              };
              s.activeControllers.set(rootId, s.activeController);
              s.primaryControllerRootId = rootId;
              s.trainingLog.push(`Loaded controller '${cmd.controllerId}' onto root '${rootId}' with ${resolvedHinges.length} hinges.`);
              publishState();
            })
            .catch((error) => {
              s.trainingLog.push(`ERROR: failed to load controller '${cmd.controllerId}': ${String(error)}`);
              publishState();
            });
          break;
        }

        // ── clear_controller ──────────────────────────────────────────────
        case "clear_controller": {
          const rootId = resolveRootId(cmd.controllerRootId, cmd.combatantId);
          const targets = rootId ? [rootId] : Array.from(s.activeControllers.keys());
          for (const targetRootId of targets) {
            const controller = s.activeControllers.get(targetRootId);
            if (!controller) continue;
            for (const hingeId of controller.hingeIds) {
              const hinge = s.hinges.get(hingeId);
              if (!hinge) continue;
              hinge.motorSpeed = 0;
              hinge.motorForce = 0;
            }
            s.activeControllers.delete(targetRootId);
          }
          s.primaryControllerRootId = rootId && s.activeControllers.has(rootId) ? rootId : (Array.from(s.activeControllers.keys())[0] ?? null);
          s.activeController = s.primaryControllerRootId ? s.activeControllers.get(s.primaryControllerRootId) ?? null : null;
          s.trainingLog.push(rootId ? `Cleared active controller for '${rootId}'.` : 'Cleared all active controllers.');
          shouldPublishState = true;
          break;
        }

        // ── evaluate_controller ───────────────────────────────────────────
        case "evaluate_controller": {
          const rootId = resolveRootId(cmd.controllerRootId, cmd.combatantId) ?? s.primaryControllerRootId;
          const activeController = rootId ? s.activeControllers.get(rootId) ?? null : null;
          if (!activeController) {
            s.trainingLog.push('ERROR: no active controller to evaluate.');
            shouldPublishState = true;
            break;
          }
          let rewardFn: (creature: object, step: number) => number;
          try {
            rewardFn = new Function('creature', 'step', `return (${cmd.rewardFn ?? "(c) => c.pos ? c.pos[0] - 0.2 * Math.abs(c.vel?.[1] ?? 0) + 0.5 * (c.up?.[1] ?? 0) - (c.fallen ? 4 : 0) : 0"})(creature, step)`) as (creature: object, step: number) => number;
          } catch {
            rewardFn = ((creature: Record<string, any>) => creature.pos ? creature.pos[0] : 0) as (creature: object, step: number) => number;
          }
          const evaluation = evaluateNetworkOnCreature(
            activeController.net,
            activeController.rootId,
            activeController.hingeIds,
            cmd.simSteps ?? 300,
            rewardFn,
          );
          s.trainingLog.push(`Controller evaluation reward: ${Number(evaluation.reward ?? 0).toFixed(2)} over ${cmd.simSteps ?? 300} steps.`);
          shouldPublishState = true;
          break;
        }

        // ── run_script ────────────────────────────────────────────────────
        case "run_script": {
          if (!cmd.script) break;
          try {
            new Function("objects", "springs", "hinges", "combatants", "controllers", "rules", "THREE", "scene", "gravity", "NeuralNet", cmd.script)(
              s.objects, s.springs, s.hinges, s.combatants, s.activeControllers, s.physicsRules, THREE, s.scene, s.gravity, NeuralNet
            );
            shouldPublishState = true;
          } catch (e) {
            console.warn("[PhysicsSimulator] script error:", e);
          }
          break;
        }
      }
    }

    if (shouldPublishState) {
      publishState();
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
      const groundGeo = new THREE.PlaneGeometry(64, 64, 96, 96);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x111318,
        metalness: 0.4,
        roughness: 0.6,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      s.groundMesh = ground;
      refreshGroundMesh();

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
      // ── Animation loop ────────────────────────────────────────────────────
      const tmpVec = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();

      type SimBody = {
        id: string;
        position: import('three').Vector3;
        quaternion: import('three').Quaternion;
        velocity: import('three').Vector3;
        angularVelocity: import('three').Vector3;
        mass: number;
        invMass: number;
        invInertia: import('three').Vector3;
        radius: number;
        shape: NonNullable<PhysicsCmd['shape']>;
        size: [number, number, number];
        fixed: boolean;
        restitution: number;
        friction: number;
        contactedGround: boolean;
        ownerId?: string;
        team?: string;
        contactDamage: number;
      };

      type SimHinge = {
        id: string;
        a: string;
        b: string;
        axis: import('three').Vector3;
        anchorA: import('three').Vector3;
        anchorB: import('three').Vector3;
        angle: number;
        minAngle: number;
        maxAngle: number;
        motorSpeed: number;
        motorForce: number;
      };

      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

      const safeInverse = (value: number) => value > 1e-8 ? 1 / value : 0;

      const computeInvInertia = (shape: NonNullable<PhysicsCmd['shape']>, size: [number, number, number], radius: number, mass: number) => {
        if (!(mass > 0) || !Number.isFinite(mass)) return new THREE.Vector3();
        let ix = mass * radius * radius * 0.4;
        let iy = ix;
        let iz = ix;
        if (shape === 'box') {
          const [sx, sy, sz] = size;
          ix = (mass * (sy * sy + sz * sz)) / 12;
          iy = (mass * (sx * sx + sz * sz)) / 12;
          iz = (mass * (sx * sx + sy * sy)) / 12;
        } else if (shape === 'cylinder' || shape === 'cone') {
          const r = Math.max(size[0], size[2]) * 0.5;
          const h = size[1];
          ix = iz = (mass * (3 * r * r + h * h)) / 12;
          iy = 0.5 * mass * r * r;
        } else if (shape === 'capsule') {
          const r = radius;
          const h = Math.max(0, size[1] - 2 * r);
          ix = iz = (mass * (3 * r * r + h * h)) / 12;
          iy = 0.5 * mass * r * r;
        }
        return new THREE.Vector3(safeInverse(ix), safeInverse(iy), safeInverse(iz));
      };

      const supportExtentAlong = (body: { shape: NonNullable<PhysicsCmd['shape']>; size: [number, number, number]; radius: number; quaternion?: import('three').Quaternion; mesh?: import('three').Mesh }, normal: import('three').Vector3) => {
        const dir = normal.clone().normalize();
        const quaternion = body.quaternion ?? body.mesh?.quaternion;
        if (!quaternion) return body.radius;
        if (body.shape === 'sphere' || body.shape === 'icosahedron' || body.shape === 'tetrahedron' || body.shape === 'torus') {
          return body.radius;
        }
        if (body.shape === 'box') {
          const half = new THREE.Vector3(body.size[0] * 0.5, body.size[1] * 0.5, body.size[2] * 0.5);
          const axes = [
            new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
            new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
            new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
          ];
          return Math.abs(dir.dot(axes[0])) * half.x + Math.abs(dir.dot(axes[1])) * half.y + Math.abs(dir.dot(axes[2])) * half.z;
        }
        if (body.shape === 'capsule' || body.shape === 'cylinder' || body.shape === 'cone') {
          const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
          const halfLine = Math.max(0, body.size[1] * 0.5 - body.radius);
          return body.radius + Math.abs(dir.dot(axis)) * halfLine;
        }
        return body.radius;
      };

      const applyAxisTorqueToBody = (body: { quaternion?: import('three').Quaternion; mesh?: import('three').Mesh; invInertia: import('three').Vector3; angularVelocity: import('three').Vector3; fixed: boolean }, worldAxis: import('three').Vector3, torqueMagnitude: number) => {
        if (body.fixed || Math.abs(torqueMagnitude) < 1e-8) return;
        const quaternion = body.quaternion ?? body.mesh?.quaternion;
        if (!quaternion) return;
        tmpQuat.copy(quaternion).invert();
        const localAxis = worldAxis.clone().applyQuaternion(tmpQuat).normalize();
        const invInertia =
          localAxis.x * localAxis.x * body.invInertia.x +
          localAxis.y * localAxis.y * body.invInertia.y +
          localAxis.z * localAxis.z * body.invInertia.z;
        if (invInertia <= 0) return;
        body.angularVelocity.addScaledVector(worldAxis, torqueMagnitude * invInertia);
      };

      const selectRootObjectId = (bodies: Map<string, PhysicsObject>, hinges: Map<string, HingeConstraint>) => {
        const children = new Set(Array.from(hinges.values()).map((hinge) => hinge.b));
        const candidates = Array.from(bodies.values()).filter((body) => !body.fixed);
        if (candidates.length === 0) return null;
        const nonChildren = candidates.filter((body) => !children.has(body.id));
        const pool = nonChildren.length > 0 ? nonChildren : candidates;
        pool.sort((left, right) => right.mass - left.mass);
        return pool[0]?.id ?? null;
      };

      const controlledHingeIdsForRoot = (rootId: string, hinges: Map<string, HingeConstraint>) => {
        const related = Array.from(hinges.values()).filter((hinge) => hinge.a === rootId || hinge.b === rootId || hinge.id.includes(rootId.split('_').slice(0, -1).join('_')));
        return (related.length > 0 ? related : Array.from(hinges.values()))
          .map((hinge) => hinge.id)
          .sort();
      };

      const nearestOpponentForRoot = (bodies: Map<string, SimBody>, rootId: string) => {
        const root = bodies.get(rootId);
        if (!root) return null;
        let best: SimBody | null = null;
        let bestDist = Infinity;
        for (const body of bodies.values()) {
          if (body.id === rootId || body.ownerId === root.ownerId) continue;
          const dist = body.position.distanceTo(root.position);
          if (dist < bestDist) {
            bestDist = dist;
            best = body;
          }
        }
        return best;
      };

      const buildObservation = (bodies: Map<string, SimBody>, hinges: SimHinge[], rootId: string) => {
        const root = bodies.get(rootId);
        if (!root) return { values: [0, 0, 0, 0, 0, 0, 1], contacts: 0 };
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
        const contacts = Array.from(bodies.values()).reduce((sum, body) => sum + (body.contactedGround ? 1 : 0), 0);
        const nearestOpponent = nearestOpponentForRoot(bodies, rootId);
        const combatant = root.ownerId ? s.combatants.get(root.ownerId) : null;
        const enemyCombatant = nearestOpponent?.ownerId ? s.combatants.get(nearestOpponent.ownerId) : null;
        const values = [
          root.position.x / 10,
          root.position.y / 5,
          root.position.z / 10,
          root.velocity.x / 6,
          root.velocity.y / 6,
          root.velocity.z / 6,
          up.y,
          (combatant?.health ?? 100) / Math.max(1, combatant?.maxHealth ?? 100),
          (enemyCombatant?.health ?? 100) / Math.max(1, enemyCombatant?.maxHealth ?? 100),
          nearestOpponent ? (nearestOpponent.position.x - root.position.x) / 12 : 0,
          nearestOpponent ? (nearestOpponent.position.z - root.position.z) / 12 : 0,
          nearestOpponent ? nearestOpponent.velocity.length() / 8 : 0,
          Math.max(0, root.position.length() - s.physicsRules.arenaHalfExtent) / Math.max(1, s.physicsRules.arenaHalfExtent),
        ];
        for (const hinge of hinges) {
          values.push(hinge.angle / Math.PI, hinge.motorSpeed / 8);
        }
        values.push(contacts / Math.max(1, bodies.size));
        return { values, contacts };
      };

      const cloneSimulationState = () => {
        const bodies = new Map<string, SimBody>();
        for (const [id, body] of s.objects.entries()) {
          bodies.set(id, {
            id,
            position: body.mesh.position.clone(),
            quaternion: body.mesh.quaternion.clone(),
            velocity: body.velocity.clone(),
            angularVelocity: body.angularVelocity.clone(),
            mass: body.mass,
            invMass: body.invMass,
            invInertia: body.invInertia.clone(),
            radius: body.radius,
            shape: body.shape,
            size: [...body.size] as [number, number, number],
            fixed: body.fixed,
            restitution: body.restitution,
            friction: body.friction,
            contactedGround: false,
            ownerId: body.ownerId,
            team: body.team,
            contactDamage: body.contactDamage,
          });
        }
        const hinges = Array.from(s.hinges.values()).map((hinge) => ({
          id: hinge.id,
          a: hinge.a,
          b: hinge.b,
          axis: hinge.axis.clone(),
          anchorA: hinge.anchorA.clone(),
          anchorB: hinge.anchorB.clone(),
          angle: hinge.angle,
          minAngle: hinge.minAngle,
          maxAngle: hinge.maxAngle,
          motorSpeed: hinge.motorSpeed,
          motorForce: hinge.motorForce,
        }));
        return { bodies, hinges };
      };

      const simulateBodiesStep = (bodies: Map<string, SimBody>, hinges: SimHinge[], dtStep: number) => {
        for (const body of bodies.values()) {
          body.contactedGround = false;
        }

        for (const hinge of hinges) {
          const a = bodies.get(hinge.a);
          const b = bodies.get(hinge.b);
          if (!a || !b) continue;
          const worldAnchorA = hinge.anchorA.clone().applyQuaternion(a.quaternion).add(a.position);
          const worldAnchorB = hinge.anchorB.clone().applyQuaternion(b.quaternion).add(b.position);
          const correction = worldAnchorB.clone().sub(worldAnchorA);
          const corrLen = correction.length();
          const invMassSum = a.invMass + b.invMass;
          if (corrLen > 1e-4 && invMassSum > 0) {
            const corrDir = correction.normalize();
            const correctionSpeed = clamp(corrLen * 18, 0, 4);
            if (a.invMass > 0) a.velocity.addScaledVector(corrDir, correctionSpeed * (a.invMass / invMassSum));
            if (b.invMass > 0) b.velocity.addScaledVector(corrDir, -correctionSpeed * (b.invMass / invMassSum));
          }

          const worldAxis = hinge.axis.clone().applyQuaternion(a.quaternion).normalize();
          const relOmega = a.angularVelocity.clone().sub(b.angularVelocity).dot(worldAxis);
          hinge.angle = clamp(hinge.angle + relOmega * dtStep, -Math.PI * 4, Math.PI * 4);

          let torque = clamp((hinge.motorSpeed - relOmega) * 14, -hinge.motorForce, hinge.motorForce);
          const limitedAngle = clamp(hinge.angle, hinge.minAngle, hinge.maxAngle);
          if (Math.abs(limitedAngle - hinge.angle) > 1e-5) {
            const limitError = limitedAngle - hinge.angle;
            torque += clamp(limitError * 90 - relOmega * 8, -hinge.motorForce * 1.35, hinge.motorForce * 1.35);
            hinge.angle = limitedAngle;
          }

          applyAxisTorqueToBody(a, worldAxis, torque * dtStep);
          applyAxisTorqueToBody(b, worldAxis, -torque * dtStep);
        }

        for (const body of bodies.values()) {
          if (body.fixed) continue;
          body.velocity.addScaledVector(s.gravity, dtStep);
          body.velocity.multiplyScalar(Math.pow(LINEAR_DAMPING, dtStep * 60));
          body.angularVelocity.multiplyScalar(Math.pow(ANGULAR_DAMPING, dtStep * 60));
          body.position.addScaledVector(body.velocity, dtStep);
          const omega = body.angularVelocity.length();
          if (omega > 1e-5) {
            const dq = new THREE.Quaternion().setFromAxisAngle(body.angularVelocity.clone().normalize(), omega * dtStep);
            body.quaternion.premultiply(dq).normalize();
          }

          const floor = sampleGroundHeight(body.position.x, body.position.z, s.physicsRules) + supportExtentAlong(body, new THREE.Vector3(0, 1, 0));
          if (body.position.y < floor) {
            body.position.y = floor;
            body.contactedGround = true;
            if (body.velocity.y < 0) body.velocity.y *= -body.restitution;
            const groundGrip = clamp(1 - body.friction * dtStep * 18, 0.2, 1);
            body.velocity.x *= groundGrip;
            body.velocity.z *= groundGrip;
            body.angularVelocity.multiplyScalar(clamp(1 - body.friction * dtStep * 8, 0.35, 1));
          }

          const WALL = s.physicsRules.arenaHalfExtent;
          for (const axis of ['x', 'z'] as const) {
            if (body.position[axis] > WALL) {
              body.position[axis] = WALL;
              if (body.velocity[axis] > 0) body.velocity[axis] *= -body.restitution;
            } else if (body.position[axis] < -WALL) {
              body.position[axis] = -WALL;
              if (body.velocity[axis] < 0) body.velocity[axis] *= -body.restitution;
            }
          }
        }

        const list = Array.from(bodies.values());
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            if (a.fixed && b.fixed) continue;
            const delta = b.position.clone().sub(a.position);
            const dist2 = delta.lengthSq();
            const minDist = a.radius + b.radius;
            if (dist2 >= minDist * minDist || dist2 < 1e-8) continue;
            const dist = Math.sqrt(dist2);
            const normal = delta.multiplyScalar(1 / dist);
            const invMassSum = a.invMass + b.invMass;
            if (invMassSum <= 0) continue;
            const penetration = minDist - dist;
            if (a.invMass > 0) a.position.addScaledVector(normal, -(penetration * (a.invMass / invMassSum)));
            if (b.invMass > 0) b.position.addScaledVector(normal, penetration * (b.invMass / invMassSum));

            const relVel = b.velocity.clone().sub(a.velocity).dot(normal);
            if (relVel >= 0) continue;
            const restitution = Math.min(a.restitution, b.restitution);
            const impulse = (-(1 + restitution) * relVel) / invMassSum;
            if (a.invMass > 0) a.velocity.addScaledVector(normal, -impulse * a.invMass);
            if (b.invMass > 0) b.velocity.addScaledVector(normal, impulse * b.invMass);
          }
        }
      };

      const evaluateNetworkOnCreature = (net: NeuralNet, rootId: string, hingeIds: string[], simSteps: number, rewardFn: (creature: Record<string, unknown>, step: number) => number) => {
        const { bodies, hinges } = cloneSimulationState();
        const controlled = hingeIds
          .map((hingeId) => hinges.find((hinge) => hinge.id === hingeId))
          .filter((hinge): hinge is SimHinge => Boolean(hinge));
        if (!bodies.has(rootId) || controlled.length === 0) {
          return { reward: -Infinity, observations: 0 };
        }
        const maxMotorSpeed = 7;
        const baseMotorForce = Math.max(20, ...controlled.map((hinge) => hinge.motorForce || 0), 45);
        let totalReward = 0;
        for (let step = 0; step < simSteps; step++) {
          const observation = buildObservation(bodies, controlled, rootId).values;
          const actions = net.forward(observation);
          for (let i = 0; i < controlled.length; i++) {
            controlled[i].motorSpeed = clamp(actions[i] ?? 0, -1, 1) * maxMotorSpeed;
            controlled[i].motorForce = baseMotorForce;
          }
          for (let sub = 0; sub < SUB_STEPS; sub++) {
            simulateBodiesStep(bodies, hinges, 0.016 / SUB_STEPS);
          }
          const root = bodies.get(rootId)!;
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
          const creature = {
            pos: root.position.toArray(),
            vel: root.velocity.toArray(),
            up: up.toArray(),
            hingeAngles: controlled.map((hinge) => hinge.angle),
            hingeSpeeds: controlled.map((hinge) => hinge.motorSpeed),
            contacts: Array.from(bodies.values()).filter((body) => body.contactedGround).map((body) => body.id),
            fallen: up.y < 0.2 || root.position.y < 0.35,
            step,
          };
          try {
            totalReward += rewardFn(creature, step);
          } catch {
            totalReward += root.position.x - Math.abs(root.velocity.y) * 0.2;
          }
          if (creature.fallen) {
            totalReward -= 8;
          }
        }
        return { reward: totalReward, observations: controlled.length };
      };

      const animate = (now: number) => {
        if (destroyed) return;
        s.animId = requestAnimationFrame(animate);

        const dt = Math.min((s.lastTime ? (now - s.lastTime) / 1000 : 0.016), 0.05);
        s.lastTime = now;
        s.simTime += dt;

        s.fpsFrames++;
        s.fpsTime += dt;
        if (s.fpsTime >= 0.5) {
          s.fps = s.fpsFrames / s.fpsTime;
          s.fpsFrames = 0; s.fpsTime = 0;
        }

        processCommands();

        const subDt = dt / SUB_STEPS;

        const applyLiveCombatDamage = (attackerId: string | undefined, defenderId: string | undefined, amount: number, timeOffset = 0) => {
          if (!defenderId || attackerId === defenderId || amount <= 0) return;
          const attacker = attackerId ? s.combatants.get(attackerId) ?? null : null;
          const defender = s.combatants.get(defenderId);
          if (!defender || defender.eliminated) return;
          if (attacker && !s.physicsRules.friendlyFire && attacker.team === defender.team) return;
          const key = `${attackerId}->${defenderId}`;
          const currentTime = s.simTime + timeOffset;
          const lastHit = s.combatHitCooldowns.get(key) ?? -Infinity;
          if (currentTime - lastHit < 0.12) return;
          s.combatHitCooldowns.set(key, currentTime);
          defender.health = Math.max(0, defender.health - amount);
          if (defender.health <= 0) {
            defender.eliminated = true;
            const controller = s.activeControllers.get(defender.rootId);
            if (controller) {
              for (const hingeId of controller.hingeIds) {
                const hinge = s.hinges.get(hingeId);
                if (!hinge) continue;
                hinge.motorSpeed = 0;
                hinge.motorForce = 0;
              }
            }
          }
        };

        for (let step = 0; step < SUB_STEPS; step++) {
          for (const [rootId, controller] of s.activeControllers.entries()) {
            const controllerCombatant = controller.combatantId ? s.combatants.get(controller.combatantId) : Array.from(s.combatants.values()).find((combatant) => combatant.rootId === rootId);
            if (controllerCombatant?.eliminated) continue;
            const controlledHinges = controller.hingeIds
              .map((hingeId) => s.hinges.get(hingeId))
              .filter((hinge): hinge is HingeConstraint => Boolean(hinge));
            if (controlledHinges.length === 0) continue;
            const simBodies = new Map<string, SimBody>();
            for (const [id, body] of s.objects.entries()) {
              simBodies.set(id, {
                id,
                position: body.mesh.position.clone(),
                quaternion: body.mesh.quaternion.clone(),
                velocity: body.velocity.clone(),
                angularVelocity: body.angularVelocity.clone(),
                mass: body.mass,
                invMass: body.invMass,
                invInertia: body.invInertia.clone(),
                radius: body.radius,
                shape: body.shape,
                size: [...body.size] as [number, number, number],
                fixed: body.fixed,
                restitution: body.restitution,
                friction: body.friction,
                contactedGround: false,
                ownerId: body.ownerId,
                team: body.team,
                contactDamage: body.contactDamage,
              });
            }
            const observation = buildObservation(simBodies, controlledHinges.map((hinge) => ({
              id: hinge.id,
              a: hinge.a,
              b: hinge.b,
              axis: hinge.axis,
              anchorA: hinge.anchorA,
              anchorB: hinge.anchorB,
              angle: hinge.angle,
              minAngle: hinge.minAngle,
              maxAngle: hinge.maxAngle,
              motorSpeed: hinge.motorSpeed,
              motorForce: hinge.motorForce,
            })), controller.rootId).values;
            const actions = controller.net.forward(observation);
            for (let i = 0; i < controlledHinges.length; i++) {
              controlledHinges[i].motorSpeed = clamp(actions[i] ?? 0, -1, 1) * controller.maxMotorSpeed;
              controlledHinges[i].motorForce = Math.max(controlledHinges[i].motorForce, controller.baseMotorForce);
            }
            controller.step += 1;
          }

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
            if (!a.fixed) a.velocity.addScaledVector(f,  subDt * a.invMass);
            if (!b.fixed) b.velocity.addScaledVector(f, -subDt * b.invMass);
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
              const invMassSum = a.invMass + b.invMass;
              if (invMassSum <= 0) continue;
              const baumFactor = Math.min(corrLen * 0.4, 0.2); // Baumgarte stabilisation
              if (!a.fixed) a.velocity.addScaledVector(corrDir,  baumFactor * a.invMass / invMassSum * 60 * subDt);
              if (!b.fixed) b.velocity.addScaledVector(corrDir, -baumFactor * b.invMass / invMassSum * 60 * subDt);
            }

            const worldAxis = hinge.axis.clone().applyQuaternion(a.mesh.quaternion).normalize();
            const relOmega = a.angularVelocity.clone().sub(b.angularVelocity).dot(worldAxis);
            hinge.angle = clamp(hinge.angle + relOmega * subDt, -Math.PI * 4, Math.PI * 4);
            let torqueMag = 0;
            if (hinge.motorForce > 0) {
              const speedErr = hinge.motorSpeed - relOmega;
              torqueMag += clamp(speedErr * 14, -hinge.motorForce, hinge.motorForce) * subDt;
            }
            const limitedAngle = clamp(hinge.angle, hinge.minAngle, hinge.maxAngle);
            if (Math.abs(limitedAngle - hinge.angle) > 1e-5) {
              const limitError = limitedAngle - hinge.angle;
              torqueMag += clamp(limitError * 80 - relOmega * 8, -Math.max(hinge.motorForce, 25), Math.max(hinge.motorForce, 25)) * subDt;
              hinge.angle = limitedAngle;
            }
            if (Math.abs(torqueMag) > 1e-8) {
              applyAxisTorqueToBody(a, worldAxis, torqueMag);
              applyAxisTorqueToBody(b, worldAxis, -torqueMag);
              a.sleeping = false; b.sleeping = false;
            }
          }

          // Per-object integration
          for (const obj of s.objects.values()) {
            if (obj.fixed || obj.sleeping) continue;

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
            const floor = sampleGroundHeight(obj.mesh.position.x, obj.mesh.position.z, s.physicsRules) + supportExtentAlong(obj, new THREE.Vector3(0, 1, 0));
            if (obj.mesh.position.y < floor) {
              obj.mesh.position.y = floor;
              if (obj.velocity.y < 0) {
                obj.velocity.y *= -obj.restitution;
                // Friction on horizontal velocity
                const lateralFactor = 1 - Math.max(obj.friction, s.physicsRules.groundFriction) * subDt * 30;
                obj.velocity.x *= Math.max(0, lateralFactor);
                obj.velocity.z *= Math.max(0, lateralFactor);
              }
              // Ground contact angular friction
              obj.angularVelocity.multiplyScalar(1 - Math.max(obj.friction, s.physicsRules.groundFriction) * 0.15);
            }

            if (s.physicsRules.hazardRingRadius > 0 && obj.ownerId) {
              const radialDistance = Math.sqrt(obj.mesh.position.x * obj.mesh.position.x + obj.mesh.position.z * obj.mesh.position.z);
              if (radialDistance > s.physicsRules.hazardRingRadius) {
                applyLiveCombatDamage('__hazard__', obj.ownerId, s.physicsRules.hazardRingDamagePerSecond * subDt, radialDistance * 0.0001);
              }
            }

            // Arena walls (soft boundary — push back)
            const WALL = s.physicsRules.arenaHalfExtent;
            for (const axis of ["x", "z"] as const) {
              if (obj.mesh.position[axis] > WALL) {
                obj.mesh.position[axis] = WALL;
                if (obj.velocity[axis] > 0) obj.velocity[axis] *= -Math.max(obj.restitution, s.physicsRules.wallRestitution);
              } else if (obj.mesh.position[axis] < -WALL) {
                obj.mesh.position[axis] = -WALL;
                if (obj.velocity[axis] < 0) obj.velocity[axis] *= -Math.max(obj.restitution, s.physicsRules.wallRestitution);
              }
            }

            if (s.physicsRules.boundaryDamagePerSecond > 0 && obj.ownerId) {
              const overflow = Math.max(0, Math.abs(obj.mesh.position.x) - WALL) + Math.max(0, Math.abs(obj.mesh.position.z) - WALL);
              if (overflow > 0) {
                applyLiveCombatDamage('__boundary__', obj.ownerId, overflow * s.physicsRules.boundaryDamagePerSecond * subDt, overflow * 0.0001);
              }
            }

            // Sleep check
            const speed = obj.velocity.length() + obj.angularVelocity.length();
            if (s.physicsRules.allowSleep && speed < SLEEP_THRESHOLD && obj.mesh.position.y < floor + 0.05) {
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
              if ((a.sleeping && b.sleeping) || (a.fixed && b.fixed)) continue;
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
              const invMassSum = a.invMass + b.invMass;
              if (invMassSum <= 0) continue;
              const corrA = pen * (a.invMass / invMassSum);
              const corrB = pen * (b.invMass / invMassSum);
              if (!a.fixed) {
                a.mesh.position.x -= nx * corrA;
                a.mesh.position.y -= ny * corrA;
                a.mesh.position.z -= nz * corrA;
              }
              if (!b.fixed) {
                b.mesh.position.x += nx * corrB;
                b.mesh.position.y += ny * corrB;
                b.mesh.position.z += nz * corrB;
              }

              // Velocity response
              const restitution = Math.min(a.restitution, b.restitution);
              const relVel = (b.velocity.x - a.velocity.x) * nx
                           + (b.velocity.y - a.velocity.y) * ny
                           + (b.velocity.z - a.velocity.z) * nz;
              if (relVel > 0) continue; // already separating
              const j2 = -(1 + restitution) * relVel / invMassSum;
              const jx = nx * j2, jy = ny * j2, jz = nz * j2;
              if (!a.fixed) {
                a.velocity.x -= jx * a.invMass;
                a.velocity.y -= jy * a.invMass;
                a.velocity.z -= jz * a.invMass;
              }
              if (!b.fixed) {
                b.velocity.x += jx * b.invMass;
                b.velocity.y += jy * b.invMass;
                b.velocity.z += jz * b.invMass;
              }
              const impactSpeed = Math.abs(relVel);
              if (impactSpeed > s.physicsRules.impactDamageThreshold) {
                const averageDamage = (a.contactDamage + b.contactDamage) * 0.5;
                const damage = Math.max(0, (impactSpeed - s.physicsRules.impactDamageThreshold) * s.physicsRules.contactDamageScale * averageDamage * subDt);
                applyLiveCombatDamage(a.ownerId, b.ownerId, damage);
                applyLiveCombatDamage(b.ownerId, a.ownerId, damage, 0.00001);
              }
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
          if (s.combatants.size > 0) parts.push(`${Array.from(s.combatants.values()).filter((combatant) => !combatant.eliminated).length}/${s.combatants.size} combatants`);
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
      s.objects.clear(); s.springs.clear(); s.hinges.clear(); s.sensors.clear(); s.combatants.clear(); s.activeControllers.clear(); s.combatHitCooldowns.clear();
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
        position: "absolute", top: 8, right: 10,
        width: 270,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(180,200,255,0.14)",
        background: "rgba(7,10,18,0.74)",
        color: "rgba(220,232,255,0.88)",
        fontSize: 10,
        lineHeight: 1.45,
        fontFamily: "monospace",
        pointerEvents: "none",
        userSelect: "none",
      }}>
        <div style={{ fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, color: "rgba(186,210,255,0.95)" }}>
          Machine Recipe
        </div>
        <div>1. Create a fixed anchor or chassis.</div>
        <div>2. Spawn moving parts beside it.</div>
        <div>3. Connect them with a hinge.</div>
        <div>4. Drive the hinge with a motor, then inspect state.</div>
        <div style={{ marginTop: 8, color: "rgba(194,214,255,0.72)" }}>
          Example: axle fixed box → wheel torus → add_hinge(h1) → set_motor(h1, 3, 50) → get_state.
        </div>
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
