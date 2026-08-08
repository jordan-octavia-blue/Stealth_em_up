import { describe, expect, it } from 'vitest';
import { buildOccluders, OccluderGridLike, Segment } from '../../src/fog/occluders';

const CS = 64;

/** A grid from an ASCII map: `#` blocks vision, `.` does not. */
function gridFrom(rows: string[]): OccluderGridLike {
  const height = rows.length;
  const width = rows[0].length;
  const cells: Array<{ blocks_vision: boolean }> = [];
  for (const row of rows) {
    for (const ch of row) cells.push({ blocks_vision: ch === '#' });
  }
  return { width, height, cell_size: CS, cells };
}

/** Segments minus the four map-boundary ones every build appends. */
function interior(segments: Segment[], grid: OccluderGridLike): Segment[] {
  const w = grid.width * CS;
  const h = grid.height * CS;
  const isBorder = (s: Segment) =>
    (s.y1 === 0 && s.y2 === 0) ||
    (s.y1 === h && s.y2 === h) ||
    (s.x1 === 0 && s.x2 === 0) ||
    (s.x1 === w && s.x2 === w);
  return segments.filter((s) => !isBorder(s));
}

function has(segments: Segment[], x1: number, y1: number, x2: number, y2: number): boolean {
  return segments.some(
    (s) =>
      (s.x1 === x1 && s.y1 === y1 && s.x2 === x2 && s.y2 === y2) ||
      (s.x1 === x2 && s.y1 === y2 && s.x2 === x1 && s.y2 === y1),
  );
}

describe('buildOccluders', () => {
  it('always closes the map with its four boundary segments', () => {
    const grid = gridFrom(['...', '...', '...']);
    const segments = buildOccluders(grid);
    expect(segments).toHaveLength(4);
    expect(has(segments, 0, 0, 3 * CS, 0)).toBe(true);
    expect(has(segments, 0, 3 * CS, 0, 0)).toBe(true);
  });

  it('emits the four edges of an isolated blocking cell', () => {
    const grid = gridFrom(['...', '.#.', '...']);
    const segments = interior(buildOccluders(grid), grid);
    expect(segments).toHaveLength(4);
    expect(has(segments, CS, CS, 2 * CS, CS)).toBe(true); // top
    expect(has(segments, CS, 2 * CS, 2 * CS, 2 * CS)).toBe(true); // bottom
    expect(has(segments, CS, CS, CS, 2 * CS)).toBe(true); // left
    expect(has(segments, 2 * CS, CS, 2 * CS, 2 * CS)).toBe(true); // right
  });

  it('merges a horizontal run into one segment per side', () => {
    const grid = gridFrom(['.....', '.###.', '.....']);
    const segments = interior(buildOccluders(grid), grid);
    // one top, one bottom, one left cap, one right cap
    expect(segments).toHaveLength(4);
    expect(has(segments, CS, CS, 4 * CS, CS)).toBe(true);
    expect(has(segments, CS, 2 * CS, 4 * CS, 2 * CS)).toBe(true);
    expect(has(segments, CS, CS, CS, 2 * CS)).toBe(true);
    expect(has(segments, 4 * CS, CS, 4 * CS, 2 * CS)).toBe(true);
  });

  it('merges a vertical run into one segment per side', () => {
    const grid = gridFrom(['...', '.#.', '.#.', '.#.', '...']);
    const segments = interior(buildOccluders(grid), grid);
    expect(segments).toHaveLength(4);
    expect(has(segments, CS, CS, CS, 4 * CS)).toBe(true); // west face, full run
    expect(has(segments, 2 * CS, CS, 2 * CS, 4 * CS)).toBe(true); // east face
    expect(has(segments, CS, CS, 2 * CS, CS)).toBe(true); // top cap
    expect(has(segments, CS, 4 * CS, 2 * CS, 4 * CS)).toBe(true); // bottom cap
  });

  it('emits nothing for a cell walled in on all sides — only boundary edges survive', () => {
    const grid = gridFrom(['###', '###', '###']);
    expect(interior(buildOccluders(grid), grid)).toHaveLength(0);
  });

  it('treats outside the map as blocking, so border walls have no outward edge', () => {
    // The left column is solid. Its west face is the map edge and must not be emitted
    // twice (once as a cell edge, once as the boundary segment).
    const grid = gridFrom(['#..', '#..', '#..']);
    const segments = interior(buildOccluders(grid), grid);
    expect(has(segments, CS, 0, CS, 3 * CS)).toBe(true); // east face
    expect(has(segments, 0, 0, 0, 3 * CS)).toBe(false); // west face is the map edge
    expect(segments).toHaveLength(1);
  });

  it('splits a run around a gap', () => {
    const grid = gridFrom(['.....', '.#.#.', '.....']);
    const segments = interior(buildOccluders(grid), grid);
    expect(has(segments, CS, CS, 2 * CS, CS)).toBe(true);
    expect(has(segments, 3 * CS, CS, 4 * CS, CS)).toBe(true);
    expect(has(segments, CS, CS, 4 * CS, CS)).toBe(false);
  });

  it('insets each wall face into the wall, leaving the map boundary untouched', () => {
    const grid = gridFrom(['...', '.#.', '...']);
    const inset = 20;
    const all = buildOccluders(grid, inset);
    const segments = interior(all, grid);
    expect(segments).toHaveLength(4);
    // Each face slides `inset` px perpendicular, off the wall's edge and into its body;
    // its length along the run is unchanged.
    expect(has(segments, CS, CS + inset, 2 * CS, CS + inset)).toBe(true); // top, slid south
    expect(has(segments, CS, 2 * CS - inset, 2 * CS, 2 * CS - inset)).toBe(true); // bottom, slid north
    expect(has(segments, CS + inset, CS, CS + inset, 2 * CS)).toBe(true); // left, slid east
    expect(has(segments, 2 * CS - inset, CS, 2 * CS - inset, 2 * CS)).toBe(true); // right, slid west
    // The four map-boundary segments are never inset.
    const w = grid.width * CS;
    const h = grid.height * CS;
    expect(has(all, 0, 0, w, 0)).toBe(true);
    expect(has(all, 0, h, 0, 0)).toBe(true);
  });

  it('is derived from the live flags — clearing a cell removes its edges', () => {
    const grid = gridFrom(['...', '.#.', '...']);
    expect(interior(buildOccluders(grid), grid)).toHaveLength(4);
    // this is what a breach does to the grid before the cache is invalidated
    grid.cells[4].blocks_vision = false;
    expect(interior(buildOccluders(grid), grid)).toHaveLength(0);
  });
});
