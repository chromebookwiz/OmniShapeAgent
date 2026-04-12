export interface PhysicsCmd {
  id: string;
  type:
    | 'spawn'
    | 'delete'
    | 'apply_force'
    | 'apply_impulse'
    | 'apply_torque'
    | 'set_velocity'
    | 'set_angular_velocity'
    | 'set_position'
    | 'set_property'
    | 'set_gravity'
    | 'add_spring'
    | 'remove_spring'
    | 'add_hinge'
    | 'set_motor'
    | 'remove_hinge'
    | 'add_sensor'
    | 'camera_goto'
    | 'set_sky'
    | 'explode'
    | 'get_state'
    | 'reset'
    | 'run_script'
    | 'run_training_loop'
    | 'spawn_creature'
    | 'save_controller'
    | 'load_controller'
    | 'clear_controller'
    | 'evaluate_controller';
  objId?: string;
  shape?: 'sphere' | 'box' | 'cylinder' | 'cone' | 'torus' | 'icosahedron' | 'tetrahedron' | 'capsule';
  position?: [number, number, number];
  color?: string;
  mass?: number;
  radius?: number;
  size?: [number, number, number];
  restitution?: number;
  friction?: number;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  wireframe?: boolean;
  fixed?: boolean;
  force?: [number, number, number];
  torque?: [number, number, number];
  velocity?: [number, number, number];
  angularVelocity?: [number, number, number];
  property?: string;
  value?: unknown;
  gravity?: [number, number, number];
  springId?: string;
  objId2?: string;
  restLength?: number;
  stiffness?: number;
  damping?: number;
  hingeId?: string;
  axis?: [number, number, number];
  anchorA?: [number, number, number];
  anchorB?: [number, number, number];
  minAngle?: number;
  maxAngle?: number;
  motorSpeed?: number;
  motorForce?: number;
  sensorId?: string;
  sensorType?: 'distance' | 'speed' | 'angle' | 'contact';
  target?: [number, number, number] | string;
  skyColor?: string;
  origin?: [number, number, number];
  strength?: number;
  falloff?: number;
  script?: string;
  rewardFn?: string;
  networkLayers?: number[];
  generations?: number;
  populationSize?: number;
  simSteps?: number;
  mutationRate?: number;
  creatureId?: string;
  bodyPlan?: Array<{
    id: string;
    shape: string;
    position: [number, number, number];
    size?: [number, number, number];
    radius?: number;
    color?: string;
    mass?: number;
    hinges?: Array<{
      parentId: string;
      axis: [number, number, number];
      anchorA: [number, number, number];
      anchorB: [number, number, number];
    }>;
  }>;
  controllerId?: string;
  controllerRootId?: string;
  trainedHinges?: string[];
  overwrite?: boolean;
}