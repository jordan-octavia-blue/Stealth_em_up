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
 *       impulse, *clamped* to a maximum. The clamp is expressed as a top sideways *speed*
 *       (m/s) the tyres can scrub off in one step, and is multiplied by the body's mass
 *       here so the feel is identical whatever the van weighs. That clamp is the whole
 *       drift knob — a high cap (`gripLateralVel`) means the tyres hold and the car tracks;
 *       the handbrake swaps in a low cap (`handbrakeLateralVel`) so the sideways velocity
 *       survives and the back end slides.
 *  3.   **Drive.** A forward force for throttle/reverse, cut off once the car is already at
 *       its speed cap so the cap is a hard ceiling rather than a slow crawl past it.
 *  4.   **Steer.** An angular impulse scaled by how fast the car is moving (no turning on
 *       the spot) and sign-flipped in reverse (backing up steers like a real car).
 *
 * The coast-to-a-stop drag is *not* here: it is the body's `linearDamping`, set when the
 * van body is created. Keeping it on the body (rather than as a force applied here) means a
 * parked van you bump into still slows down and stops, even though this function — driver
 * input — only runs while someone is behind the wheel.
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
  /** Top sideways speed (m/s) the gripping tyres scrub off per step (high = tracks true). */
  gripLateralVel: number;
  /** The same, with the handbrake down (low = the back end keeps sliding). */
  handbrakeLateralVel: number;
  /** Angular impulse at full steer, before the speed scaling. */
  steerImpulse: number;
  /** Forward speed (m/s) at which steering reaches full authority. */
  turnSpeedRef: number;
  /** Body linear damping — the coast-down, and what stops a parked van after a bump. */
  linearDamping: number;
  /** Angular damping set on the body so it doesn't spin freely. */
  angularDamping: number;
}

/**
 * Default van feel. `maxSpeed` 24 m/s ≈ 768 px/s — comfortably past the hero's 480 px/s
 * sprint, so once you're rolling nothing on foot keeps up. `driveForce` 400 N on the van's
 * ~18 kg mass (density 3, set in `addCar`) is ~22 m/s² of push, so it reaches that top
 * speed in about a second. `linearDamping` 0.5 is a gentle coast-down that also stops a
 * parked van after you walk into it. `steerImpulse` is sized for that heavier body, so the
 * turn rate matches the old lighter van.
 */
export const DEFAULT_CAR_TUNING: CarTuning = {
  driveForce: 400,
  reverseForce: 220,
  maxSpeed: 24,
  maxReverseSpeed: 10,
  gripLateralVel: 6.0,
  handbrakeLateralVel: 0.5,
  steerImpulse: 3.0,
  turnSpeedRef: 3,
  linearDamping: 0.5,
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

  // 1 & 2: cancel the sideways component of velocity, clamped — the drift knob. The clamp
  // is a top sideways speed (m/s), turned into an impulse cap by the mass, so a heavier van
  // grips exactly as hard as a light one.
  const lateralSpeed = dot(v, right);
  let impulse = -lateralSpeed * mass;
  const maxLatVel = controls.handbrake ? tuning.handbrakeLateralVel : tuning.gripLateralVel;
  const maxLat = maxLatVel * mass;
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

  // The coast-down (lifting off) is the body's linearDamping, set in `addCar` — not applied
  // here, so a parked van you bump into still slows to a stop even when no one is driving.
}
