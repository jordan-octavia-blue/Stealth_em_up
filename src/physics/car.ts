/**
 * Top-down car model (roadmap §3.3) — front-wheel ("bicycle") steering on a Box2D body.
 *
 * This file is the *physics* half of the drivable van (Phase 7): pure body math with no
 * Pixi, no input, no sound. `src/systems/car.ts` is the gameplay half that reads the
 * keyboard, plays the engine, and reacts to what the car runs into.
 *
 * ## How the model works
 *
 * The car keeps one piece of state beyond its Box2D body: the **front-wheel angle**
 * (`CarSteering.steer`, radians, 0 = straight ahead). Each fixed step:
 *
 *  1. **Turn the wheels, not the car.** The wheel angle chases the stick at a finite
 *     rate (`steerRate`) and self-centres faster when released (`steerReturnRate`).
 *     How far the wheels can turn shrinks with speed — full lock in a car park,
 *     a few degrees at top speed (`maxSteerLowSpeed` → `maxSteerHighSpeed`). That
 *     speed-sensitive lock is what keeps the car controllable flat-out: the turn gets
 *     wider as you go faster instead of the car spinning out.
 *  2. **Yaw follows the wheels geometrically.** A car with its front wheels at angle θ
 *     drives a circle of radius `wheelbase / tan θ`, so the correct yaw rate is
 *     `forwardSpeed · tan θ / wheelbase`. We *set* the body's angular velocity to
 *     exactly that — no impulses, no overshoot. The same formula makes reversing steer
 *     the right way for free (forwardSpeed is negative, so the yaw flips).
 *  3. **Tyres grip.** The sideways component of velocity decays exponentially
 *     (`gripDecay` per second), applied as a mass-scaled impulse. The handbrake swaps
 *     in a much weaker decay (`handbrakeGripDecay`) so the car keeps sliding — that
 *     one knob is the whole drift system.
 *  4. **Drive, brake, coast.** Throttle and brake are *accelerations* (m/s²), turned
 *     into forces by the body's mass — so the feel never changes when the mass does.
 *     Holding reverse while rolling forward brakes hard first, then backs up (and vice
 *     versa), like a real automatic. With no throttle at all, a gentle engine-brake
 *     deceleration coasts the car to an actual stop.
 *
 * `driveCarBody` runs **every step whether or not anyone is driving** — the physics
 * world calls it with zero controls for an unmanned car (see `PhysicsWorld.step`).
 * That is deliberate: a parked car still has tyres and a parking pawl, so pedestrians
 * shoving on the bodywork can't skid it around. Combined with a realistic mass
 * (`density` puts the van near two tonnes), a person on foot simply cannot move it.
 */

import { Body, Vec2 } from 'planck';

/** One frame of driver intent. `throttle`/`steer` are in [-1, 1]. */
export interface CarControls {
  /** +1 full throttle, -1 brake/reverse, 0 coast. */
  throttle: number;
  /** +1 steer right (clockwise), -1 steer left. */
  steer: number;
  /** Handbrake held — drops the tyre grip so the car drifts. */
  handbrake: boolean;
}

/**
 * The car's persistent steering state: where the front wheels point right now, in
 * radians (0 = straight, + = right). Owned by the physics world alongside the body;
 * mutated by `driveCarBody` each step. Exposed through `CarState.steer` so the render
 * layer can draw the wheels at their true angle.
 */
export interface CarSteering {
  steer: number;
}

/** Everything that shapes how the car feels. All in Box2D units (metres, kg, seconds). */
export interface CarTuning {
  /** Front-to-rear axle distance, metres. Turn radius = wheelbase / tan(wheel angle). */
  wheelbase: number;
  /** Full-lock wheel angle at a standstill, radians — how tight it can park. */
  maxSteerLowSpeed: number;
  /** Full-lock wheel angle at `maxSpeed`, radians — the stability knob at speed. */
  maxSteerHighSpeed: number;
  /** How fast the wheels turn toward the stick, rad/s. */
  steerRate: number;
  /** How fast they self-centre when the stick is released, rad/s. */
  steerReturnRate: number;
  /** Full-throttle acceleration, m/s². */
  acceleration: number;
  /** Braking deceleration when input opposes the direction of travel, m/s². */
  brakeDeceleration: number;
  /** Acceleration when actually backing up, m/s². */
  reverseAcceleration: number;
  /** Forward speed cap, m/s. */
  maxSpeed: number;
  /** Reverse speed cap, m/s. */
  maxReverseSpeed: number;
  /** Coast-down deceleration with no throttle, m/s² — also what stops a shoved car. */
  engineBrake: number;
  /** Sideways-velocity decay rate with grip, 1/s (higher = the tyres hold harder). */
  gripDecay: number;
  /** The same with the handbrake down, 1/s (low = the back end keeps sliding). */
  handbrakeGripDecay: number;
  /** Body linear damping — near zero; the explicit decelerations above do the work. */
  linearDamping: number;
  /** Angular damping on the body, for the rare spin the model didn't set itself. */
  angularDamping: number;
  /** Fixture density, kg/m². Sized to give the van a real vehicle's mass. */
  density: number;
}

/**
 * Default van feel. `maxSpeed` 24 m/s ≈ 768 px/s — comfortably past the hero's 480 px/s
 * sprint. `acceleration` 11 m/s² reaches it in a bit over two seconds. The steering lock
 * runs from ~32° at a standstill (a 3.3 m turn radius — one tile) down to ~8° flat-out
 * (a ~15 m radius), so speed makes turns wider, never wilder. `density` 300 over the
 * van's ~6.1 m² footprint puts it at ~1.8 tonnes: a walking hero (≈0.6 kg body) cannot
 * budge it, while the tuning above never notices because everything is accelerations.
 */
export const DEFAULT_CAR_TUNING: CarTuning = {
  wheelbase: 2.1,
  maxSteerLowSpeed: 0.55,
  maxSteerHighSpeed: 0.14,
  steerRate: 3.5,
  steerReturnRate: 7,
  acceleration: 11,
  brakeDeceleration: 30,
  reverseAcceleration: 7,
  maxSpeed: 24,
  maxReverseSpeed: 8,
  engineBrake: 5,
  gripDecay: 45,
  handbrakeGripDecay: 2.5,
  linearDamping: 0.05,
  angularDamping: 2.5,
  density: 300,
};

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Apply one step of the car model to `body`, advancing the wheel angle in `steering`.
 * Call once per fixed step, before `world.step` — with zero controls when no one is
 * driving, so the tyres and parking brake exist even for a parked car. Pure in the
 * sense that it reads only its arguments — no globals.
 */
export function driveCarBody(
  body: Body,
  controls: CarControls,
  tuning: CarTuning,
  steering: CarSteering,
  dt: number,
): void {
  const v = body.getLinearVelocity();
  const forward = body.getWorldVector(Vec2(1, 0));
  const right = body.getWorldVector(Vec2(0, 1));
  const mass = body.getMass();
  const center = body.getWorldCenter();
  const forwardSpeed = dot(v, forward);
  const speedAbs = Math.abs(forwardSpeed);

  // 1: wheel angle chases the stick, inside a lock that narrows with speed.
  const speedT = Math.min(speedAbs / tuning.maxSpeed, 1);
  const maxSteer =
    tuning.maxSteerLowSpeed + (tuning.maxSteerHighSpeed - tuning.maxSteerLowSpeed) * speedT;
  const target = controls.steer * maxSteer;
  const rate = controls.steer !== 0 ? tuning.steerRate : tuning.steerReturnRate;
  const maxDelta = rate * dt;
  const delta = target - steering.steer;
  steering.steer += Math.abs(delta) <= maxDelta ? delta : Math.sign(delta) * maxDelta;

  // 2: yaw rate straight from turning-circle geometry. Negative forwardSpeed (reversing)
  // flips the yaw, which is exactly how a real car steers in reverse.
  body.setAngularVelocity((forwardSpeed / tuning.wheelbase) * Math.tan(steering.steer));

  // 3: tyre grip — exponential decay of the sideways velocity, as a mass-scaled impulse.
  const decay = controls.handbrake ? tuning.handbrakeGripDecay : tuning.gripDecay;
  const lateral = dot(v, right);
  const scrub = -lateral * (1 - Math.exp(-decay * dt)) * mass;
  body.applyLinearImpulse(Vec2(right.x * scrub, right.y * scrub), center, true);

  // 4: throttle / brake / reverse / coast, all as accelerations.
  let accel = 0;
  if (controls.throttle > 0) {
    if (forwardSpeed < -0.3) accel = tuning.brakeDeceleration; // braking out of reverse
    else if (forwardSpeed < tuning.maxSpeed) accel = tuning.acceleration * controls.throttle;
  } else if (controls.throttle < 0) {
    if (forwardSpeed > 0.3) accel = -tuning.brakeDeceleration; // braking from forward
    else if (forwardSpeed > -tuning.maxReverseSpeed)
      accel = tuning.reverseAcceleration * controls.throttle; // throttle is negative here
  } else if (speedAbs > 1e-3) {
    // engine brake: coast down, clamped so it stops at zero instead of oscillating.
    accel = -Math.sign(forwardSpeed) * Math.min(tuning.engineBrake, speedAbs / dt);
  }
  const f = accel * mass;
  body.applyForceToCenter(Vec2(forward.x * f, forward.y * f), true);
}
