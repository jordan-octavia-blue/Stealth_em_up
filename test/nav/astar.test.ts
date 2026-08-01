import { describe, expect, it } from 'vitest';
import { findPath, octileDistance } from '../../src/nav/astar';
import { NavGrid } from '../../src/nav/navgrid';
import { asCoords, gridFromAscii } from './helpers';

/** Cost of a path, using the same convention as the search: every node but the first. */
function pathCost(grid: NavGrid, path: readonly number[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(grid.cellX(path[i]) - grid.cellX(path[i - 1]));
    const dy = Math.abs(grid.cellY(path[i]) - grid.cellY(path[i - 1]));
    const step = dx === 1 && dy === 1 ? Math.SQRT2 : 1;
    cost += step * grid.costAt(path[i]);
  }
  return cost;
}

describe('octileDistance', () => {
  it('is straight-line distance along an axis', () => {
    expect(octileDistance(0, 0, 5, 0)).toBeCloseTo(5);
    expect(octileDistance(0, 0, 0, 3)).toBeCloseTo(3);
  });

  it('charges sqrt(2) per diagonal step', () => {
    expect(octileDistance(0, 0, 3, 3)).toBeCloseTo(3 * Math.SQRT2);
  });

  it('mixes diagonal and straight legs', () => {
    // 2 diagonals then 3 straight
    expect(octileDistance(0, 0, 5, 2)).toBeCloseTo(2 * Math.SQRT2 + 3);
  });
});

describe('findPath', () => {
  it('walks a straight open corridor', () => {
    const grid = gridFromAscii([
      '#####',
      '#...#',
      '#####',
    ]);
    const { path, stats } = findPath(grid, grid.index(1, 1), grid.index(3, 1));
    expect(stats.found).toBe(true);
    expect(asCoords(grid, path)).toEqual(['1,1', '2,1', '3,1']);
  });

  it('prefers diagonals in the open (octile, not Manhattan)', () => {
    const grid = gridFromAscii([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    const { path } = findPath(grid, grid.index(0, 0), grid.index(4, 4));
    expect(path.length).toBe(5);
    expect(asCoords(grid, path)).toEqual(['0,0', '1,1', '2,2', '3,3', '4,4']);
  });

  it('returns just the start cell when already there', () => {
    const grid = gridFromAscii(['...']);
    const { path, stats } = findPath(grid, grid.index(1, 0), grid.index(1, 0));
    expect(stats.found).toBe(true);
    expect(path).toEqual([grid.index(1, 0)]);
  });

  it('routes around an obstacle', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.....',
    ]);
    const { path } = findPath(grid, grid.index(0, 1), grid.index(4, 1));
    expect(path.length).toBeGreaterThan(0);
    // never steps on a wall
    for (const cell of path) expect(grid.isWalkable(cell)).toBe(true);
    expect(path[0]).toBe(grid.index(0, 1));
    expect(path[path.length - 1]).toBe(grid.index(4, 1));
  });

  it('refuses to cut the corner between two walls', () => {
    // The only way from 0,0 to 1,1 is the diagonal, and both of its shared
    // orthogonal neighbours are solid — so a unit with a body cannot squeeze through.
    const grid = gridFromAscii([
      '.#',
      '#.',
    ]);
    const { path, stats } = findPath(grid, grid.index(0, 0), grid.index(1, 1));
    expect(stats.found).toBe(false);
    expect(path).toEqual([]);
  });

  it('refuses a diagonal even when only one neighbour is solid', () => {
    // Roadmap §4 takes the strict rule: BOTH shared orthogonals must be walkable.
    // Squeezing past a single wall corner is what used to let guards clip walls.
    const grid = gridFromAscii([
      '..',
      '#.',
    ]);
    const { path } = findPath(grid, grid.index(0, 0), grid.index(1, 1));
    expect(asCoords(grid, path)).toEqual(['0,0', '1,0', '1,1']);
  });

  it('takes the diagonal when both shared neighbours are open', () => {
    const grid = gridFromAscii([
      '..',
      '..',
    ]);
    const { path } = findPath(grid, grid.index(0, 0), grid.index(1, 1));
    expect(asCoords(grid, path)).toEqual(['0,0', '1,1']);
  });

  it('finds no path into a sealed room', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const { path, stats } = findPath(grid, grid.index(0, 0), grid.index(2, 2));
    expect(stats.found).toBe(false);
    expect(path).toEqual([]);
  });

  it('rejects a start or goal that is solid', () => {
    const grid = gridFromAscii(['.#.']);
    expect(findPath(grid, grid.index(1, 0), grid.index(2, 0)).path).toEqual([]);
    expect(findPath(grid, grid.index(0, 0), grid.index(1, 0)).path).toEqual([]);
  });

  it('detours around the danger layer instead of walking through it', () => {
    const rows = [
      '.....',
      '.....',
      '.....',
    ];
    const clean = gridFromAscii(rows);
    const direct = findPath(clean, clean.index(0, 1), clean.index(4, 1)).path;
    expect(asCoords(clean, direct)).toEqual(['0,1', '1,1', '2,1', '3,1', '4,1']);

    const dangerous = gridFromAscii(rows);
    for (const y of [0, 1, 2]) {
      // a hot column across the middle of the map, worst at the centre row
      dangerous.dangerCost[dangerous.index(2, y)] = y === 1 ? 8 : 0;
    }
    const avoided = findPath(dangerous, dangerous.index(0, 1), dangerous.index(4, 1)).path;
    expect(avoided.length).toBeGreaterThan(0);
    expect(avoided).not.toContain(dangerous.index(2, 1));
    expect(pathCost(dangerous, avoided)).toBeLessThan(pathCost(dangerous, direct));
  });

  it('treats a doorway as passable but expensive', () => {
    // The doorway is the short way across; the detour one row down is longer in
    // distance but cheaper once the chokepoint penalty is summed in.
    const grid = gridFromAscii([
      '#####',
      '#.D.#',
      '#...#',
      '#####',
    ]);
    const { path, stats } = findPath(grid, grid.index(1, 1), grid.index(3, 1));
    expect(stats.found).toBe(true);
    expect(path).not.toContain(grid.index(2, 1));

    // ...but it is still passable when it is the only way through.
    const corridor = gridFromAscii([
      '#####',
      '#.D.#',
      '#####',
    ]);
    expect(findPath(corridor, corridor.index(1, 1), corridor.index(3, 1)).path).toContain(
      corridor.index(2, 1),
    );
  });

  it('expands far fewer nodes than the grid holds on an open map', () => {
    const rows: string[] = [];
    for (let y = 0; y < 40; y++) rows.push('.'.repeat(40));
    const grid = gridFromAscii(rows);
    const { stats } = findPath(grid, grid.index(0, 0), grid.index(39, 39));
    expect(stats.found).toBe(true);
    expect(stats.expanded).toBeLessThan(grid.size);
  });

  it('does not leak state between searches (generation stamping)', () => {
    const grid = gridFromAscii([
      '.....',
      '.....',
      '.....',
    ]);
    const first = findPath(grid, grid.index(0, 0), grid.index(4, 2)).path;
    const second = findPath(grid, grid.index(0, 0), grid.index(4, 2)).path;
    expect(second).toEqual(first);
    // and a different query is unaffected by the previous one's scratch
    const third = findPath(grid, grid.index(4, 0), grid.index(0, 2)).path;
    expect(third[0]).toBe(grid.index(4, 0));
    expect(third[third.length - 1]).toBe(grid.index(0, 2));
  });
});
