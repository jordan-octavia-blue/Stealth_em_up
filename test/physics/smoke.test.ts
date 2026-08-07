import { beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, PhysicsGridLike } from '../../src/physics/world';
import { VISION_MASK, BULLET_MASK } from '../../src/physics/constants';

const CS = 64;

/** An all-floor room: no walls, so nothing blocks sight until we add smoke. */
function openRoom(w: number, h: number): PhysicsGridLike {
  const cells: PhysicsGridLike['cells'] = [];
  for (let i = 0; i < w * h; i++) cells.push({ solid: false, door: false, blocks_vision: false });
  return { width: w, height: h, cell_size: CS, cells };
}

const centre = (cx: number, cy: number): { x: number; y: number } => ({
  x: cx * CS + CS / 2,
  y: cy * CS + CS / 2,
});

describe('smoke vision-blockers (Phase 8)', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
    world.build(openRoom(6, 1)); // a clear 6-cell corridor
  });

  const from = centre(0, 0);
  const to = centre(5, 0);

  it('an empty corridor is clear line of sight', () => {
    expect(world.isClear(from.x, from.y, to.x, to.y, VISION_MASK)).toBe(true);
  });

  it('a smoke cloud in the middle breaks the vision lock, and lifting it restores sight', () => {
    const mid = centre(2, 0);
    const id = world.addVisionBlocker([{ x: mid.x, y: mid.y, r: CS * 0.72 }]);

    // Guard sight (VISION_MASK) is now blocked...
    expect(world.isClear(from.x, from.y, to.x, to.y, VISION_MASK)).toBe(false);
    // ...and so is a bullet along the same line (smoke is a VISION_BLOCKER).
    expect(world.rayCast(from.x, from.y, to.x, to.y, BULLET_MASK)).not.toBeNull();

    world.removeVisionBlocker(id);
    expect(world.isClear(from.x, from.y, to.x, to.y, VISION_MASK)).toBe(true);
  });

  it('smoke is a sensor: it never becomes solid geometry a body would collide with', () => {
    const mid = centre(2, 0);
    world.addVisionBlocker([{ x: mid.x, y: mid.y, r: CS * 0.72 }]);
    // spotClear tests only non-sensor collision fixtures, so smoke leaves a spot "clear"
    // to stand in even though it blocks sight through it.
    expect(world.spotClear(mid.x, mid.y, 14, 0xffff)).toBe(true);
  });
});
