/**
 * Top-down car model (roadmap §3.3).
 *
 * A single dynamic box body, driven with the standard Box2D top-down-car recipe. This
 * file is the *physics* half of the drivable van (Phase 7): pure body math with no Pixi,
 * no input, no sound. `src/systems/car.ts` is the gameplay half that reads the keyboard,
 * plays the engine, and reacts to what the car runs into.
 *
 * Each fixed step, `driveCarBody` does four things to the body:
 *
 *  1&2. **Kill sideways velocity.** A real tyre resists sliding: decompose the body's
 *       velocity into forward and sideways parts and cancel the sideways part with an
 *       impulse, *clamped* to a maximum. That clamp is the whole drift feel — a high cap
 *       (`gripLateralImpulse`) means the tyres hold and the car tracks; the handbrake
 *       swaps in a low cap (`handbrakeLateralImpulse`) so the sideways velocity survives
 *       and the back end slides.
 *  3.   **Drive.** A forward force for throttle/reverse, cut off once the car is already at
 *       its speed cap so the cap is a hard ceiling rather than a slow crawl past it.
 *  4.   **Steer.** An angular impulse scaled by how fast the car is moving (no turning on
 *       the spot) and sign-flipped in reverse (backing up steers like a real car).
 *
 * Plus a mild rolling-resistance drag so the car coasts to a stop when you lift off.
 */

import { Body, Vec2 } from 'planck';

/** One frame of driver intent. `throttle`/`steer` are in [-1, 1]. */
export interface CarControls {
  /** +1 full throttle, -1 full reverse, 0 coast. */
  throttle: number;
  /** +1 steer right (clockwise), -1 steer left. */
  steer: number;
  /** Handbrake held — drops the sideways-grip cap so the car drifts. */
  handbrake: boolean;
}

/** Everything that shapes how the car feels. All in Box2D units (metres, kg, seconds). */
export interface CarTuning {
  /** Forward force at full throttle, in newtons. */
  driveForce: number;
  /** Reverse force at full reverse. */
  reverseForce: number;
  /** Forward speed cap, m/s. Above it, throttle stops adding force. */
  maxSpeed: number;
  /** Reverse speed cap, m/s. */
  maxReverseSpeed: number;
  /** Sideways-velocity-cancelling impulse cap with the tyres gripping (high = tracks true). */
  gripLateralImpulse: number;
  /** The same cap with the handbrake down (low = the back end slides). */
  handbrakeLateralImpulse: number;
  /** Angular impulse at full steer, before the speed scaling. */
  steerImpulse: number;
  /** Forward speed (m/s) at which steering reaches full authority. */
  turnSpeedRef: number;
  /** Linear drag force per unit velocity — the coast-down. */
  rollingResistance: number;
  /** Angular damping set on the body so it doesn't spin freely. */
  angularDamping: number;
}

/**
 * Default van feel. `maxSpeed` 14 m/s ≈ 448 px/s — faster than the hero's 240 px/s walk
 * and just under the 480 px/s sprint, so the getaway is quick without being twitchy. These
 * are the numbers the "drift-feel tuning session" in the roadmap's Verify step turns.
 */
export const DEFAULT_CAR_TUNING: CarTuning = {
  driveForce: 150,
  reverseForce: 80,
  maxSpeed: 14,
  maxReverseSpeed: 6,
  gripLateralImpulse: 30,
  handbrakeLateralImpulse: 3,
  steerImpulse: 1.0,
  turnSpeedRef: 3,
  rollingResistance: 1.5,
  angularDamping: 2.5,
};

/** Dot product of a body-space unit vector already rotated into world space, with velocity. */
function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Apply one step of the top-down car model to `body`. Call once per fixed step, before
 * `world.step`. Pure in the sense that it reads only the body and the tuning — no globals.
 */
export function driveCarBody(body: Body, controls: CarControls, tuning: CarTuning): void {
  const v = body.getLinearVelocity();
  const forward = body.getWorldVector(Vec2(1, 0));
  const right = body.getWorldVector(Vec2(0, 1));
  const mass = body.getMass();
  const center = body.getWorldCenter();

  // 1 & 2: cancel the sideways component of velocity, clamped — the drift knob.
  const lateralSpeed = dot(v, right);
  let impulse = -lateralSpeed * mass;
  const maxLat = controls.handbrake ? tuning.handbrakeLateralImpulse : tuning.gripLateralImpulse;
  if (impulse > maxLat) impulse = maxLat;
  else if (impulse < -maxLat) impulse = -maxLat;
  body.applyLinearImpulse(Vec2(right.x * impulse, right.y * impulse), center, true);

  // 3: drive force along forward, cut at the speed cap.
  const forwardSpeed = dot(v, forward);
  if (controls.throttle > 0 && forwardSpeed < tuning.maxSpeed) {
    const f = tuning.driveForce * controls.throttle;
    body.applyForceToCenter(Vec2(forward.x * f, forward.y * f), true);
  } else if (controls.throttle < 0 && forwardSpeed > -tuning.maxReverseSpeed) {
    const f = tuning.reverseForce * controls.throttle; // throttle is negative here
    body.applyForceToCenter(Vec2(forward.x * f, forward.y * f), true);
  }

  // 4: steering — scaled by speed (none on the spot), sign-flipped in reverse.
  const speedFactor = Math.min(Math.abs(forwardSpeed) / tuning.turnSpeedRef, 1);
  const dir = forwardSpeed >= 0 ? 1 : -1;
  if (controls.steer !== 0 && speedFactor > 0) {
    body.applyAngularImpulse(controls.steer * tuning.steerImpulse * speedFactor * dir, true);
  }

  // 5: rolling resistance — a drag proportional to velocity, so lifting off coasts to a stop.
  body.applyForceToCenter(Vec2(-v.x * tuning.rollingResistance, -v.y * tuning.rollingResistance), true);
}
