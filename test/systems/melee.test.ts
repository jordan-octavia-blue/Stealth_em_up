import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { physics } from '../../src/physics';
import { sprintKnockback, tickStunned } from '../../src/systems/melee';

const CS = 64;

/** An open floor grid — no walls, so nothing gets in the way of the shove. */
function floorGrid(w: number, h: number) {
  const cells = [];
  for (let i = 0; i < w * h; i++) cells.push({ solid: false, door: false, blocks_vision: false });
  return { width: w, height: h, cell_size: CS, cells };
}

function makeGuard(x: number, y: number) {
  return {
    x,
    y,
    radius: 19,
    alive: true,
    being_choked_out: false,
    stunnedUntil: 0,
    path: [{ x: 1, y: 1 }] as Array<{ x: number; y: number }>,
    target: { x: 2, y: 2 } as { x: number | null; y: number | null },
  };
}

function makeHero(x: number, y: number) {
  return { x, y, radius: 14, alive: true };
}

describe('sprint knockback + stun', () => {
  beforeEach(() => {
    physics.reset();
    physics.build(floorGrid(12, 12));
  });
  afterEach(() => {
    physics.reset();
  });

  it('launches a touching guard away from a sprinting hero and stuns them', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + hero.radius + 19, 300); // just touching, due east
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 480, 0); // sprinting east

    sprintKnockback(hero, [guard], true);

    const gv = physics.getVelocity(guard);
    expect(gv.x).toBeGreaterThan(400); // flung east, away from the hero
    expect(Math.abs(gv.y)).toBeLessThan(1);
    expect(guard.stunnedUntil).toBeGreaterThan(0);
    // the route it was on (planned from its old spot) is dropped
    expect(guard.path.length).toBe(0);
    expect(guard.target.x).toBeNull();
  });

  it('does nothing when the sprint key is not held', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + hero.radius + 19, 300);
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 480, 0);

    sprintKnockback(hero, [guard], false);

    expect(physics.getVelocity(guard).x).toBeCloseTo(0);
    expect(guard.stunnedUntil).toBe(0);
  });

  it('does nothing when sprinting but barely moving (holding shift while standing)', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + hero.radius + 19, 300);
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 40, 0); // below the minimum charge speed

    sprintKnockback(hero, [guard], true);

    expect(guard.stunnedUntil).toBe(0);
  });

  it('leaves a guard that is out of reach untouched', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + 250, 300); // far away
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 480, 0);

    sprintKnockback(hero, [guard], true);

    expect(guard.stunnedUntil).toBe(0);
    expect(physics.getVelocity(guard).x).toBeCloseTo(0);
  });

  it('does not re-launch a guard already mid-stun', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + hero.radius + 19, 300);
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 480, 0);

    sprintKnockback(hero, [guard], true);
    const firstStun = guard.stunnedUntil;
    // decay the launch, then try to shove again while still stunned
    physics.setVelocity(guard, 100, 0);
    sprintKnockback(hero, [guard], true);

    expect(guard.stunnedUntil).toBe(firstStun); // unchanged: no fresh launch
    expect(physics.getVelocity(guard).x).toBeCloseTo(100);
  });

  it('tickStunned reports dazed and bleeds off the launch velocity while the stun lasts', () => {
    const hero = makeHero(300, 300);
    physics.addHero(hero, hero.radius);
    const guard = makeGuard(300 + hero.radius + 19, 300);
    physics.addGuard(guard, guard.radius);
    physics.setVelocity(hero, 480, 0);
    sprintKnockback(hero, [guard], true);

    const before = physics.getVelocity(guard).x;
    expect(tickStunned(guard)).toBe(true);
    const after = physics.getVelocity(guard).x;
    expect(after).toBeLessThan(before); // decaying
    expect(after).toBeGreaterThan(0); // still coasting, not stopped dead
  });

  it('tickStunned reports not-stunned for a guard that was never shoved', () => {
    const guard = makeGuard(300, 300);
    physics.addGuard(guard, guard.radius);
    expect(tickStunned(guard)).toBe(false);
  });
});
