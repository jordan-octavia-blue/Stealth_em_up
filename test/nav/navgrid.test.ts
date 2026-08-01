import { describe, expect, it } from 'vitest';
import { NavGrid } from '../../src/nav/navgrid';
import { gridFromAscii } from './helpers';

describe('NavGrid indexing', () => {
  const grid = new NavGrid(40, 40, 64);

  it('round-trips index <-> cell coords', () => {
    const i = grid.index(7, 12);
    expect(grid.cellX(i)).toBe(7);
    expect(grid.cellY(i)).toBe(12);
  });

  it('matches the legacy flat layout (y * width + x)', () => {
    // jo_grid.cells is indexed the same way; nav reads cell i as cell i.
    expect(grid.index(3, 5)).toBe(5 * 40 + 3);
  });

  it('maps world points to the containing cell', () => {
    expect(grid.indexAtPoint(0, 0)).toBe(grid.index(0, 0));
    expect(grid.indexAtPoint(63.9, 63.9)).toBe(grid.index(0, 0));
    expect(grid.indexAtPoint(64, 64)).toBe(grid.index(1, 1));
    expect(grid.indexAtPoint(-1, 10)).toBe(-1);
    expect(grid.indexAtPoint(40 * 64, 0)).toBe(-1);
  });

  it('puts waypoints at cell centres', () => {
    expect(grid.pointAtIndex(grid.index(2, 3))).toEqual({ x: 2 * 64 + 32, y: 3 * 64 + 32 });
  });
});

describe('NavGrid steps', () => {
  it('forbids a diagonal whose shared orthogonals are not both open', () => {
    const grid = gridFromAscii([
      '..',
      '#.',
    ]);
    // direction 4 is (+1, +1)
    expect(grid.canStep(grid.index(0, 0), 4)).toBe(false);
    expect(grid.neighbor(grid.index(0, 0), 4)).toBe(-1);
    // the orthogonal step is fine
    expect(grid.canStep(grid.index(0, 0), 0)).toBe(true);
  });

  it('will not step off the edge of the map', () => {
    const grid = gridFromAscii(['..', '..']);
    expect(grid.canStep(grid.index(0, 0), 2)).toBe(false); // (-1, 0)
    expect(grid.canStep(grid.index(0, 0), 3)).toBe(false); // (0, -1)
  });
});

describe('NavGrid cost layers', () => {
  it('sums base, door and danger', () => {
    const grid = gridFromAscii(['...']);
    const i = grid.index(1, 0);
    grid.baseCost[i] = 1;
    grid.doorCost[i] = 1.5;
    grid.dangerCost[i] = 2;
    expect(grid.costAt(i)).toBeCloseTo(4.5);
  });

  it('never returns a non-positive cost', () => {
    const grid = gridFromAscii(['.']);
    grid.baseCost[0] = -5;
    expect(grid.costAt(0)).toBeGreaterThan(0);
  });
});

describe('NavGrid mutation', () => {
  it('bumps version only when walkability actually changes', () => {
    const grid = gridFromAscii(['.#']);
    const before = grid.version;
    expect(grid.setWalkable(grid.index(0, 0), true)).toBe(false);
    expect(grid.version).toBe(before);
    expect(grid.setWalkable(grid.index(1, 0), true)).toBe(true);
    expect(grid.version).toBe(before + 1);
  });
});

describe('NavGrid.nearestWalkable', () => {
  it('returns the cell itself when it is already walkable', () => {
    const grid = gridFromAscii(['...']);
    expect(grid.nearestWalkable(grid.index(1, 0))).toBe(grid.index(1, 0));
  });

  it('finds the closest open cell around a solid one', () => {
    // Units legitimately stand in solid cells — the van seals the ground under itself.
    const grid = gridFromAscii([
      '###',
      '##.',
      '###',
    ]);
    expect(grid.nearestWalkable(grid.index(1, 1))).toBe(grid.index(2, 1));
  });

  it('gives up on a fully solid map', () => {
    const grid = gridFromAscii(['###', '###']);
    expect(grid.nearestWalkable(grid.index(1, 1))).toBe(-1);
  });

  it('rejects out-of-range indices', () => {
    const grid = gridFromAscii(['...']);
    expect(grid.nearestWalkable(-1)).toBe(-1);
    expect(grid.nearestWalkable(999)).toBe(-1);
  });
});

describe('NavGrid generation stamps', () => {
  it('invalidates every node with one bump instead of a reset loop', () => {
    const grid = gridFromAscii(['...']);
    grid.beginSearch();
    grid.touch(1);
    expect(grid.isTouched(1)).toBe(true);
    grid.beginSearch();
    expect(grid.isTouched(1)).toBe(false);
  });
});
