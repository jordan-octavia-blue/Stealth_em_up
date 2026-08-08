import { beforeEach, describe, expect, it } from 'vitest';
import { LegacyGridLike, nav } from '../../src/nav';

/**
 * The "green line through a wall" regression (follow-time first-leg clearance).
 *
 * A smoothed path only guarantees each leg is clear from the spot it was planned at. A unit
 * that has since moved — a deferred search, a stale target from a replaced route, or a
 * physics shove — can end up steering its FIRST leg (unit -> next waypoint) straight through
 * a wall, while every later waypoint-to-waypoint leg stays clear. `nav.isDirectPathClear`
 * is the follow-time check the guard loop uses to catch exactly that and re-plan.
 */
function legacyGrid(rows: string[]): LegacyGridLike {
  const width = rows[0].length;
  const cells: LegacyGridLike['cells'] = [];
  for (const row of rows) for (const ch of row) {
    cells.push({ solid: ch === '#', door: false, restricted: false });
  }
  return { width, height: rows.length, cell_size: 64, cells };
}
const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

describe('nav.isDirectPathClear (follow-time first-leg check)', () => {
  beforeEach(() => nav.reset());

  const MAP = [
    '.......',
    '.......',
    '###.###', // a wall with a one-cell gap at column 3
    '.......',
    '.......',
  ];

  it('accepts a straight leg with no wall between', () => {
    nav.build(legacyGrid(MAP));
    expect(nav.isDirectPathClear(at(3, 0), at(3, 4), 19)).toBe(true); // straight down the gap
  });

  it('rejects a leg whose straight line crosses a wall', () => {
    nav.build(legacyGrid(MAP));
    // A waypoint that was reachable when planned from the gap (col 3) is NOT reachable in a
    // straight line once the unit has drifted to col 0 — the line now crosses the wall row.
    expect(nav.isDirectPathClear(at(0, 1), at(3, 4), 19)).toBe(false);
  });

  it('rejects a leg that would clip a wall corner with the body but not the centre', () => {
    nav.build(legacyGrid(MAP));
    // Centre line threads the gap; the body (radius 19) does not.
    expect(nav.isDirectPathClear(at(2, 1), at(4, 3), 30)).toBe(false);
  });

  it('never blocks movement before the grid is built', () => {
    nav.reset();
    expect(nav.isDirectPathClear(at(0, 0), at(9, 9), 19)).toBe(true);
  });
});
