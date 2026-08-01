import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/nav/astar';
import { computeFlowField, pathFromField } from '../../src/nav/flowfield';
import { DIR_X, DIR_Y } from '../../src/nav/navgrid';
import { asCoords, gridFromAscii } from './helpers';

describe('computeFlowField', () => {
  it('measures cost-weighted distance outward from the target', () => {
    const grid = gridFromAscii([
      '...',
      '...',
      '...',
    ]);
    const field = computeFlowField(grid, grid.index(1, 1));
    expect(field.distanceAt(grid.index(1, 1))).toBe(0);
    expect(field.distanceAt(grid.index(0, 1))).toBeCloseTo(1);
    expect(field.distanceAt(grid.index(0, 0))).toBeCloseTo(Math.SQRT2);
  });

  it('leaves unreachable cells at Infinity', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const field = computeFlowField(grid, grid.index(0, 0));
    expect(field.reachable(grid.index(4, 4))).toBe(true);
    expect(field.reachable(grid.index(2, 2))).toBe(false);
    expect(field.distanceAt(grid.index(2, 2))).toBe(Infinity);
  });

  it('points every cell downhill towards the target', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.....',
    ]);
    const target = grid.index(4, 0);
    const field = computeFlowField(grid, target);
    for (let i = 0; i < grid.size; i++) {
      if (i === target || !field.reachable(i)) continue;
      const dir = field.dir[i];
      expect(dir).toBeGreaterThanOrEqual(0);
      const next = grid.index(grid.cellX(i) + DIR_X[dir], grid.cellY(i) + DIR_Y[dir]);
      expect(field.distanceAt(next)).toBeLessThan(field.distanceAt(i));
    }
  });

  it('returns an empty field for an unwalkable target', () => {
    const grid = gridFromAscii(['.#.']);
    const field = computeFlowField(grid, grid.index(1, 0));
    expect(field.reachable(grid.index(0, 0))).toBe(false);
  });

  it('bends around the danger layer, like the search does', () => {
    const grid = gridFromAscii([
      '.....',
      '.....',
      '.....',
    ]);
    grid.dangerCost[grid.index(2, 1)] = 10;
    const field = computeFlowField(grid, grid.index(4, 1));
    const path = pathFromField(grid, field, grid.index(0, 1));
    expect(path.length).toBeGreaterThan(0);
    expect(path).not.toContain(grid.index(2, 1));
  });
});

describe('pathFromField', () => {
  it('walks the direction table to the target', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.....',
    ]);
    const field = computeFlowField(grid, grid.index(0, 0));
    const path = pathFromField(grid, field, grid.index(4, 0));
    expect(path[0]).toBe(grid.index(4, 0));
    expect(path[path.length - 1]).toBe(grid.index(0, 0));
    for (const cell of path) expect(grid.isWalkable(cell)).toBe(true);
  });

  it('agrees with A* on the route it produces', () => {
    const grid = gridFromAscii([
      '..........',
      '.####.###.',
      '.#......#.',
      '.#.####.#.',
      '..........',
    ]);
    const start = grid.index(2, 2);
    const goal = grid.index(9, 4);
    const field = computeFlowField(grid, goal);
    const viaField = pathFromField(grid, field, start);
    const viaSearch = findPath(grid, start, goal).path;
    // Both are optimal under the same costs, so the totals match even if the
    // tie-breaking picks different equally-good cells.
    expect(viaField[0]).toBe(start);
    expect(viaField[viaField.length - 1]).toBe(goal);
    expect(viaField.length).toBe(viaSearch.length);
    expect(asCoords(grid, viaField).length).toBeGreaterThan(1);
  });

  it('returns nothing when the start cannot reach the target', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const field = computeFlowField(grid, grid.index(0, 0));
    expect(pathFromField(grid, field, grid.index(2, 2))).toEqual([]);
  });

  it('costs one search no matter how many units converge', () => {
    const rows: string[] = [];
    for (let y = 0; y < 20; y++) rows.push('.'.repeat(20));
    const grid = gridFromAscii(rows);
    const field = computeFlowField(grid, grid.index(10, 10));
    // 15 "guards" all read routes out of the same table
    for (let i = 0; i < 15; i++) {
      const path = pathFromField(grid, field, grid.index(i, 0));
      expect(path[path.length - 1]).toBe(grid.index(10, 10));
    }
  });
});
