import { describe, expect, it } from 'vitest';
import type { MapData } from '../../src/map/loader';
import { autotileAdapter, cellFlagsForCode } from '../../src/editor/autotileAdapter';
import { findWallType } from '../../src/render/autotile';

/** A bare map carrying only what the adapter reads (width/height/data). */
function grid(width: number, height: number, data: number[]): MapData {
  return { width, height, data } as unknown as MapData;
}

describe('cellFlagsForCode', () => {
  it('marks only the black wall as a wall neighbour (solid, opaque, not a door)', () => {
    expect(cellFlagsForCode(1)).toEqual({ solid: true, door: false, blocks_vision: true });
  });

  it('treats a desk as solid but see-through (not a wall neighbour)', () => {
    expect(cellFlagsForCode(3)).toEqual({ solid: true, door: false, blocks_vision: false });
  });

  it('treats doors as solid+opaque but flagged door (not a wall neighbour)', () => {
    expect(cellFlagsForCode(5)).toEqual({ solid: true, door: true, blocks_vision: true });
    expect(cellFlagsForCode(6)).toEqual({ solid: true, door: true, blocks_vision: true });
  });

  it('treats floors as nothing', () => {
    expect(cellFlagsForCode(2)).toEqual({ solid: false, door: false, blocks_vision: false });
    expect(cellFlagsForCode(4)).toEqual({ solid: false, door: false, blocks_vision: false });
  });
});

describe('autotileAdapter + findWallType (parity with the game)', () => {
  it('returns undefined outside the grid', () => {
    const a = autotileAdapter(grid(3, 3, new Array(9).fill(1)));
    expect(a.getCellFromIndex(-1, 0)).toBeUndefined();
    expect(a.getCellFromIndex(3, 0)).toBeUndefined();
  });

  it('a wall boxed in on all four sides is the "four" tile', () => {
    const a = autotileAdapter(grid(3, 3, new Array(9).fill(1)));
    expect(findWallType(a, 1, 1).type).toBe('four');
  });

  it('a lone wall in open floor is the "single" tile', () => {
    // floor everywhere, one wall in the middle
    const a = autotileAdapter(grid(3, 3, [2, 2, 2, 2, 1, 2, 2, 2, 2]));
    expect(findWallType(a, 1, 1).type).toBe('single');
  });

  it('a horizontal wall run is the "long" tile, unrotated', () => {
    const a = autotileAdapter(grid(3, 3, [2, 2, 2, 1, 1, 1, 2, 2, 2]));
    const t = findWallType(a, 1, 1);
    expect(t.type).toBe('long');
    expect(t.rotation).toBe(0);
  });

  it('a neighbouring door does not pull an edge toward it', () => {
    // a door to the west should NOT count as a wall neighbour → lone wall stays "single"
    const a = autotileAdapter(grid(3, 3, [2, 2, 2, 5, 1, 2, 2, 2, 2]));
    expect(findWallType(a, 1, 1).type).toBe('single');
  });
});
