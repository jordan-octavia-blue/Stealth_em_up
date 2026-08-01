import { describe, expect, it } from 'vitest';
import { labelRegions } from '../../src/nav/regions';
import { gridFromAscii } from './helpers';

describe('labelRegions', () => {
  it('labels one open map as a single region', () => {
    const grid = gridFromAscii([
      '...',
      '...',
    ]);
    const regions = labelRegions(grid);
    expect(regions.count).toBe(1);
    expect(regions.regionSize(0)).toBe(6);
  });

  it('leaves solid cells unlabelled', () => {
    const grid = gridFromAscii(['.#.']);
    const regions = labelRegions(grid);
    expect(regions.labelAt(grid.index(1, 0))).toBe(-1);
  });

  it('separates a sealed room from the rest of the map', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const regions = labelRegions(grid);
    expect(regions.count).toBe(2);
    expect(regions.connected(grid.index(0, 0), grid.index(2, 2))).toBe(false);
    expect(regions.connected(grid.index(0, 0), grid.index(4, 4))).toBe(true);
  });

  it('uses the same corner rule as the search, so labels mean "reachable"', () => {
    // Two open cells touching only at a corner pinched between two walls: the search
    // cannot make that step, so they must not share a label.
    const grid = gridFromAscii([
      '.#',
      '#.',
    ]);
    const regions = labelRegions(grid);
    expect(regions.count).toBe(2);
    expect(regions.connected(grid.index(0, 0), grid.index(1, 1))).toBe(false);
  });

  it('merges regions when a wall opens up', () => {
    const grid = gridFromAscii([
      '.#.',
      '.#.',
      '.#.',
    ]);
    const regions = labelRegions(grid);
    expect(regions.count).toBe(2);

    grid.setWalkable(grid.index(1, 1), true);
    const after = labelRegions(grid, regions);
    expect(after.count).toBe(1);
    expect(after.connected(grid.index(0, 0), grid.index(2, 2))).toBe(true);
    expect(after.version).toBe(grid.version);
  });

  it('samples random destinations only from the requester own region', () => {
    const grid = gridFromAscii([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const regions = labelRegions(grid);
    const inside = grid.index(2, 2);
    // the sealed room holds exactly one cell, so every sample is that cell
    for (let i = 0; i < 10; i++) {
      expect(regions.randomCellInRegionOf(inside)).toBe(inside);
    }
    // ...and no sample from outside ever lands in it
    const outside = grid.index(0, 0);
    for (let i = 0; i < 50; i++) {
      expect(regions.randomCellInRegionOf(outside)).not.toBe(inside);
    }
  });

  it('reports no region for an unwalkable cell', () => {
    const grid = gridFromAscii(['.#.']);
    const regions = labelRegions(grid);
    expect(regions.randomCellInRegionOf(grid.index(1, 0))).toBe(-1);
    expect(regions.regionSize(grid.index(1, 0))).toBe(0);
  });

  it('stays correct when a random source returns its exclusive upper bound', () => {
    const grid = gridFromAscii(['...']);
    const regions = labelRegions(grid);
    // Math.random() is [0, 1), but a stubbed source returning exactly 1 must not
    // index off the end of the member list.
    expect(regions.randomCellInRegionOf(0, () => 1)).toBeGreaterThanOrEqual(0);
  });
});
