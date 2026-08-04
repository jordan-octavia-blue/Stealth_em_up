import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events';
import { LegacyGridLike, nav } from '../../src/nav';

/**
 * Region relabel on destruction (roadmap §6.2, pipeline step 2).
 *
 * These tests exercise the real wiring: `grid.destroyCell` emits `cell:destroyed`, and nav
 * subscribes to that event. So emitting it here is exactly what the game does when a bomb
 * or a bullet breaks a wall — nav should re-derive walkability, relabel regions, and drop
 * the flow field, making the breach immediately pathable.
 */

function legacyGrid(rows: string[]): LegacyGridLike {
  const width = rows[0].length;
  const cells: LegacyGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({ solid: ch === '#', door: false, restricted: false });
    }
  }
  return { width, height: rows.length, cell_size: 64, cells };
}

/** Centre of cell (x, y) in world pixels. */
const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

describe('nav reacts to cell:destroyed', () => {
  beforeEach(() => nav.reset());

  // Two rooms split by a solid wall down the middle column.
  const TWO_ROOMS = [
    '#####',
    '#.#.#',
    '#.#.#',
    '#.#.#',
    '#####',
  ];

  it('starts with the two rooms unreachable from each other', () => {
    nav.build(legacyGrid(TWO_ROOMS));
    expect(nav.canReach(at(1, 2), at(3, 2))).toBe(false);
    expect(nav.stats.regions).toBe(2);
  });

  it('merges the regions when the dividing wall is destroyed', () => {
    const grid = nav.build(legacyGrid(TWO_ROOMS));
    const wall = grid.index(2, 2); // a cell in the dividing column

    events.emit('cell:destroyed', wall);

    expect(grid.isWalkable(wall)).toBe(true);
    expect(nav.canReach(at(1, 2), at(3, 2))).toBe(true);
    expect(nav.stats.regions).toBe(1);
  });

  it('leaves a breach cheap to path but flagged as rubble, not clean floor', () => {
    const grid = nav.build(legacyGrid(TWO_ROOMS));
    const wall = grid.index(2, 2);
    events.emit('cell:destroyed', wall);
    // Walkable, but a touch more costly than open floor so paths prefer clean ground.
    expect(grid.isWalkable(wall)).toBe(true);
    expect(grid.costAt(wall)).toBeGreaterThan(1);
  });
});
