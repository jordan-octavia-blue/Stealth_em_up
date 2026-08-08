import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/nav/astar';
import { isCorridorWalkable, isSegmentWalkable, smoothPath } from '../../src/nav/smooth';
import { center, gridFromAscii } from './helpers';

describe('isSegmentWalkable', () => {
  it('accepts a clear line', () => {
    const grid = gridFromAscii([
      '...',
      '...',
    ]);
    const a = center(grid, 0, 0);
    const b = center(grid, 2, 1);
    expect(isSegmentWalkable(grid, a.x, a.y, b.x, b.y)).toBe(true);
  });

  it('rejects a line that crosses a wall', () => {
    const grid = gridFromAscii(['.#.']);
    const a = center(grid, 0, 0);
    const b = center(grid, 2, 0);
    expect(isSegmentWalkable(grid, a.x, a.y, b.x, b.y)).toBe(false);
  });

  it('rejects a line that leaves the map', () => {
    const grid = gridFromAscii(['...']);
    const a = center(grid, 0, 0);
    expect(isSegmentWalkable(grid, a.x, a.y, -100, a.y)).toBe(false);
  });

  it('counts a wall the line only grazes at a corner', () => {
    const grid = gridFromAscii([
      '..',
      '#.',
    ]);
    const a = center(grid, 0, 0);
    const b = center(grid, 1, 1);
    // The centre-to-centre diagonal passes exactly through the corner point shared
    // with the solid cell. The traversal counts that cell rather than threading the
    // needle — same conservative answer the A* corner rule gives.
    expect(isSegmentWalkable(grid, a.x, a.y, b.x, b.y)).toBe(false);
    expect(isCorridorWalkable(grid, a, b, 19)).toBe(false);
  });
});

describe('isCorridorWalkable', () => {
  it('needs room for the whole body, not just the centre line', () => {
    // A one-cell gap: the centre line is clear, the flanks are not.
    const grid = gridFromAscii([
      '#.#',
      '#.#',
      '#.#',
    ]);
    const a = center(grid, 1, 0);
    const b = center(grid, 1, 2);
    expect(isCorridorWalkable(grid, a, b, 0)).toBe(true);
    expect(isCorridorWalkable(grid, a, b, 19)).toBe(true);
    // a body wider than the corridor does not fit
    expect(isCorridorWalkable(grid, a, b, 40)).toBe(false);
  });

  it('handles a zero-length segment', () => {
    const grid = gridFromAscii(['.#']);
    expect(isCorridorWalkable(grid, center(grid, 0, 0), center(grid, 0, 0), 10)).toBe(true);
  });
});

describe('smoothPath', () => {
  it('collapses a straight run to its endpoint', () => {
    const grid = gridFromAscii(['.....']);
    const cells = [0, 1, 2, 3, 4];
    expect(smoothPath(grid, cells, 19)).toEqual([center(grid, 4, 0)]);
  });

  it('cuts the staircase off a diagonal run', () => {
    const grid = gridFromAscii([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    const cells = [
      grid.index(0, 0),
      grid.index(1, 0),
      grid.index(1, 1),
      grid.index(2, 1),
      grid.index(2, 2),
    ];
    const smoothed = smoothPath(grid, cells, 19);
    expect(smoothed.length).toBeLessThan(cells.length);
    expect(smoothed[smoothed.length - 1]).toEqual(center(grid, 2, 2));
  });

  it('keeps the corner waypoint when a wall is in the way', () => {
    const grid = gridFromAscii([
      '...',
      '##.',
      '...',
    ]);
    const cells = [grid.index(0, 0), grid.index(1, 0), grid.index(2, 0), grid.index(2, 1), grid.index(2, 2)];
    const smoothed = smoothPath(grid, cells, 19);
    // it cannot go straight from 0,0 to 2,2 — the wall row is between them
    expect(smoothed.length).toBeGreaterThan(1);
    expect(smoothed[smoothed.length - 1]).toEqual(center(grid, 2, 2));
  });

  it('every leg of the smoothed path stays walkable', () => {
    const grid = gridFromAscii([
      '..........',
      '.####.###.',
      '.#......#.',
      '.#.####.#.',
      '..........',
    ]);
    const cells = [
      grid.index(2, 2),
      grid.index(3, 2),
      grid.index(4, 2),
      grid.index(5, 2),
      grid.index(6, 2),
      grid.index(7, 2),
      grid.index(7, 3),
      grid.index(7, 4),
    ];
    const start = center(grid, 2, 2);
    const smoothed = smoothPath(grid, cells, 19);
    let from = start;
    for (const point of smoothed) {
      expect(isCorridorWalkable(grid, from, point, 19)).toBe(true);
      from = point;
    }
    expect(from).toEqual(center(grid, 7, 4));
  });

  it('anchors on the unit actual position, and does not emit it', () => {
    const grid = gridFromAscii(['....']);
    const start = { x: 10, y: 40 };
    const smoothed = smoothPath(grid, [0, 1, 2], 19, start);
    expect(smoothed).not.toContainEqual(start);
    expect(smoothed[smoothed.length - 1]).toEqual(center(grid, 2, 0));
  });

  it('returns nothing for an empty or single-cell path', () => {
    const grid = gridFromAscii(['...']);
    expect(smoothPath(grid, [], 19)).toEqual([]);
    expect(smoothPath(grid, [1], 19)).toEqual([]);
  });

  it('never hands a body-clipping first leg from an off-centre start', () => {
    // A unit pressed off-centre against a wall (physics packs bodies into geometry) is the
    // only leg that starts somewhere other than a cell centre. The straight hop from there
    // to the first cell centre can clip a corner the grid path was routed around — the
    // "path through a wall" that leaves a guard grinding along it. The smoother must lead
    // with the unit's own cell centre in that case.
    const grid = gridFromAscii([
      '....',
      '##..',
      '.#.#',
      '#..#',
      '..#.',
    ]);
    const startCell = grid.index(2, 3);
    const { path } = findPath(grid, startCell, grid.index(0, 4));
    // Guard standing toward the bottom-left of its cell, body still clear of the walls.
    const start = { x: 142, y: 238 };

    // Precondition: the naive straight hop to the first cell centre is NOT body-clear.
    const firstCentre = center(grid, grid.cellX(path[1]), grid.cellY(path[1]));
    expect(isCorridorWalkable(grid, start, firstCentre, 19)).toBe(false);

    const smoothed = smoothPath(grid, path, 19, start);
    // It leads with the unit's own cell centre, which is reachable, and every leg from the
    // real start onward is clear for the whole body.
    expect(smoothed[0]).toEqual(center(grid, 2, 3));
    let from = start;
    for (const point of smoothed) {
      expect(isCorridorWalkable(grid, from, point, 19)).toBe(true);
      from = point;
    }
  });
});
