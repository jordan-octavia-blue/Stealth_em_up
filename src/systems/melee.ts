/**
 * Melee shove — a sprinting hero bowls guards over (feature: "run into an NPC while
 * sprinting to send them flying backwards, stunned for a second, as if kicked").
 *
 * Two halves, both driven from the guard game loop:
 *
 *  - `sprintKnockback(hero, guards, sprinting)` runs once per fixed step, after the guards
 *    have chosen their velocities and before the physics step. When the hero is *sprinting
 *    and actually moving fast*, any living guard the hero is touching is launched away at a
 *    fixed speed and flagged `stunnedUntil` for a beat.
 *  - `tickStunned(guard)` is called at the top of each guard's turn: while the stun lasts it
 *    bleeds the launch velocity off with an exponential decay (the guard skids back, then
 *    stands dazed) and reports `true` so the caller skips that guard's normal perception,
 *    aiming and pathing for the tick.
 *
 * The guard's body is velocity-driven every step, so a knockback that wasn't protected by
 * the stun window would be overwritten by `move_to_target` on the very next tick — the two
 * functions are a pair, not independent helpers.
 */

import { gameClock } from '../core/clock';
import { physics } from '../physics';

/** Launch speed, pixels/second. Well above sprint pace so the hit reads as a hard shove. */
const KNOCKBACK_SPEED_PX_S = 850;
/** How long the guard is out of the fight after being shoved. */
const STUN_MS = 1000;
/** The hero must be moving at least this fast (px/s) to bowl someone over — holding shift
 *  while standing next to a guard does nothing; you have to run into them. */
const MIN_HERO_SPEED_PX_S = 300;
/** Slack on top of the two bodies' radii for "touching" — they are solid, so in practice
 *  they are already at radius-sum when the hero runs up against a guard. */
const CONTACT_MARGIN_PX = 6;
/** Per-tick velocity retained while stunned. At 60 Hz the guard coasts ~130 px then rests. */
const KNOCKBACK_DECAY = 0.9;

interface Stunnable {
  x: number;
  y: number;
  radius: number;
  alive: boolean;
  being_choked_out?: boolean;
  stunnedUntil?: number;
  path: unknown[];
  target: { x: number | null; y: number | null };
}

interface Mover {
  x: number;
  y: number;
  radius: number;
  alive: boolean;
}

function isStunned(guard: Stunnable, now: number): boolean {
  return !!guard.stunnedUntil && now < guard.stunnedUntil;
}

/**
 * Advance a guard's stun for this tick. Returns true while the guard is still dazed, in
 * which case the caller must skip its AI so the decaying launch velocity is what carries it.
 */
export function tickStunned(guard: Stunnable): boolean {
  const now = gameClock.now();
  if (!isStunned(guard, now)) return false;
  // Skid to a halt: the body keeps whatever velocity it had (the launch, or last tick's
  // decayed remainder) because no one steered it, and we shave a bit more off here.
  if (physics.hasActor(guard)) physics.scaleVelocity(guard, KNOCKBACK_DECAY);
  return true;
}

/**
 * If the hero is sprinting into guards, launch and stun the ones they are touching.
 *
 * `sprinting` is the caller's read of the sprint key (the hero cannot sprint while dragging
 * a body, so the caller gates on that too). A guard already mid-stun is left alone, so one
 * charge is one launch rather than a per-frame re-launch while the bodies stay in contact.
 */
export function sprintKnockback(hero: Mover, guards: Stunnable[], sprinting: boolean): void {
  if (!sprinting || !hero.alive) return;
  // Hero out of the physics world (e.g. driving the van) has no body to read a speed from.
  if (!physics.hasActor(hero)) return;
  const hv = physics.getVelocity(hero);
  const heroSpeed = Math.sqrt(hv.x * hv.x + hv.y * hv.y);
  if (heroSpeed < MIN_HERO_SPEED_PX_S) return;

  const now = gameClock.now();
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i];
    if (!guard.alive || guard.being_choked_out) continue;
    if (isStunned(guard, now)) continue;
    if (!physics.hasActor(guard)) continue;

    const dx = guard.x - hero.x;
    const dy = guard.y - hero.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > hero.radius + guard.radius + CONTACT_MARGIN_PX) continue;

    // Fling the guard away from the hero; if they are exactly overlapping, use the hero's
    // heading so there is always a well-defined direction.
    let nx: number;
    let ny: number;
    if (dist > 0.001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      nx = hv.x / heroSpeed;
      ny = hv.y / heroSpeed;
    }
    physics.setVelocity(guard, nx * KNOCKBACK_SPEED_PX_S, ny * KNOCKBACK_SPEED_PX_S);
    guard.stunnedUntil = now + STUN_MS;
    // Whatever route the guard was on was planned from where it used to be standing; drop it
    // so a fresh one is asked for once the stun wears off.
    guard.path = [];
    guard.target = { x: null, y: null };
  }
}
