import { describe, expect, it } from 'vitest';
import { LegacyGridLike, nav } from '../../src/nav';

/** Same legacy-jo_grid stand-in the nav suite uses. */
function legacyGrid(rows: string[]): LegacyGridLike {
  const width = rows[0].length;
  const cells: LegacyGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({ solid: ch === '#' || ch === 'D', door: ch === 'D', restricted: ch === 'R' });
    }
  }
  return { width, height: rows.length, cell_size: 64, cells };
}

const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

describe('nav.hearingDistance (roadmap §5.2 — sound travels around walls)', () => {
  it('measures roughly the straight-line distance in open space', () => {
    nav.build(legacyGrid(['##########', '#........#', '#........#', '##########']));
    const d = nav.hearingDistance(at(1, 1), at(8, 1));
    // seven cells apart → ~7 × 64 px, allowing for the diagonal-free grid metric
    expect(d).toBeGreaterThan(6 * 64);
    expect(d).toBeLessThan(9 * 64);
  });

  it('a sound behind a barrier carries further than the wall gap suggests', () => {
    // A wall splits the room with a single doorway at the bottom; the listener is just
    // across the wall from the source but sound must detour through the gap.
    nav.build(
      legacyGrid([
        '#########',
        '#...#...#',
        '#...#...#',
        '#...#...#',
        '#.......#',
        '#########',
      ]),
    );
    const source = at(2, 1);
    const listenerAcrossWall = at(5, 1);
    const straight = Math.hypot(source.x - listenerAcrossWall.x, source.y - listenerAcrossWall.y);
    const navDist = nav.hearingDistance(source, listenerAcrossWall);
    // The detour around the wall is strictly longer than line-of-sight.
    expect(navDist).toBeGreaterThan(straight);
  });

  it('returns Infinity to a listener sealed in an unreachable region', () => {
    nav.build(
      legacyGrid([
        '#######',
        '#..#..#',
        '#..#..#',
        '#######',
      ]),
    );
    // left room to right room with a full dividing wall and no door → unreachable
    const d = nav.hearingDistance(at(1, 1), at(5, 1));
    expect(d).toBe(Infinity);
  });
});
