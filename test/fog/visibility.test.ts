import { describe, expect, it } from 'vitest';
import { buildOccluders, OccluderGridLike, Segment } from '../../src/fog/occluders';
import { computeVisibility } from '../../src/fog/visibility';

const CS = 64;

function gridFrom(rows: string[]): OccluderGridLike {
  const height = rows.length;
  const width = rows[0].length;
  const cells: Array<{ blocks_vision: boolean }> = [];
  for (const row of rows) {
    for (const ch of row) cells.push({ blocks_vision: ch === '#' });
  }
  return { width, height, cell_size: CS, cells };
}

/** Centre of cell (x, y). */
function centre(x: number, y: number): { x: number; y: number } {
  return { x: x * CS + CS / 2, y: y * CS + CS / 2 };
}

/** Standard even-odd test against a flat [x, y, ...] polygon. */
function inside(polygon: number[], px: number, py: number): boolean {
  let hit = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i * 2];
    const yi = polygon[i * 2 + 1];
    const xj = polygon[j * 2];
    const yj = polygon[j * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const BIG = 10_000;

describe('computeVisibility', () => {
  it('sees the whole open room when nothing blocks', () => {
    const grid = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    const polygon = computeVisibility(centre(2, 2), buildOccluders(grid), { radius: BIG });
    for (const cell of [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
      [2, 0],
    ]) {
      expect(inside(polygon, centre(cell[0], cell[1]).x, centre(cell[0], cell[1]).y)).toBe(true);
    }
  });

  it('casts a shadow behind a wall', () => {
    //  the wall at (2,2) hides (4,2) from a viewer at (0,2)
    const grid = gridFrom(['.....', '.....', '..#..', '.....', '.....']);
    const polygon = computeVisibility(centre(0, 2), buildOccluders(grid), { radius: BIG });
    expect(inside(polygon, centre(1, 2).x, centre(1, 2).y)).toBe(true);
    expect(inside(polygon, centre(4, 2).x, centre(4, 2).y)).toBe(false);
    // ...but the room either side of the shadow is still visible
    expect(inside(polygon, centre(4, 0).x, centre(4, 0).y)).toBe(true);
    expect(inside(polygon, centre(4, 4).x, centre(4, 4).y)).toBe(true);
  });

  it('sees through a gap that opens up — the marquee destructible-wall behaviour', () => {
    const rows = ['.....', '.....', '#####', '.....', '.....'];
    const grid = gridFrom(rows);
    const viewer = centre(2, 0);
    const behind = centre(2, 4);

    let polygon = computeVisibility(viewer, buildOccluders(grid), { radius: BIG });
    expect(inside(polygon, behind.x, behind.y)).toBe(false);

    // blow a hole straight through
    grid.cells[2 * 5 + 2].blocks_vision = false;
    polygon = computeVisibility(viewer, buildOccluders(grid), { radius: BIG });
    expect(inside(polygon, behind.x, behind.y)).toBe(true);
  });

  it('never reaches past its radius', () => {
    const grid = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    const origin = centre(2, 2);
    const radius = 100;
    const polygon = computeVisibility(origin, buildOccluders(grid), { radius });
    for (let i = 0; i < polygon.length; i += 2) {
      const dx = polygon[i] - origin.x;
      const dy = polygon[i + 1] - origin.y;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(radius + 1e-6);
    }
    expect(inside(polygon, origin.x + 300, origin.y)).toBe(false);
  });

  it('limits a cone to its arc and anchors it at the viewer', () => {
    const grid = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    const origin = centre(2, 2);
    const polygon = computeVisibility(origin, buildOccluders(grid), {
      radius: BIG,
      facing: 0, // due east
      coneAngle: Math.PI / 2,
    });
    // the fan closes through the viewer
    expect(polygon[0]).toBeCloseTo(origin.x);
    expect(polygon[1]).toBeCloseTo(origin.y);
    expect(inside(polygon, origin.x + 100, origin.y)).toBe(true);
    expect(inside(polygon, origin.x - 100, origin.y)).toBe(false);
    expect(inside(polygon, origin.x, origin.y - 100)).toBe(false);
  });

  it('a closed door blocks and an open one does not', () => {
    // the door cell is the only thing between the two rooms
    const rows = ['#####', '#...#', '##.##', '#...#', '#####'];
    const grid = gridFrom(rows);
    const doorIndex = 2 * 5 + 2;
    const viewer = centre(2, 1);
    const other = centre(2, 3);

    grid.cells[doorIndex].blocks_vision = true; // closed
    let polygon = computeVisibility(viewer, buildOccluders(grid), { radius: BIG });
    expect(inside(polygon, other.x, other.y)).toBe(false);

    grid.cells[doorIndex].blocks_vision = false; // opened
    polygon = computeVisibility(viewer, buildOccluders(grid), { radius: BIG });
    expect(inside(polygon, other.x, other.y)).toBe(true);
  });

  it('produces a polygon that is cheap to draw — no ray per corner survives as a vertex', () => {
    // an empty room's boundary is 4 segments; the arc sampling should dominate and
    // consecutive rays landing on the same wall collapse to one vertex each.
    const grid = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    const segments: readonly Segment[] = buildOccluders(grid);
    const polygon = computeVisibility(centre(2, 2), segments, { radius: BIG });
    expect(polygon.length / 2).toBeLessThan(80);
    expect(polygon.length / 2).toBeGreaterThan(3);
  });
});
