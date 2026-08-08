import { describe, expect, it } from 'vitest';
import {
  TILE,
  TILE_TYPES,
  editorTileFile,
  editorTileFiles,
  paintableTiles,
  tileType,
} from '../../src/map/tiles';

/**
 * The tile catalog is the single source of truth the game grid (src/legacy/jo_grid.ts) and the
 * whole editor now derive from. jo_grid can't be unit-tested (it constructs Pixi containers), so
 * this locks the gameplay values the catalog feeds it against the exact `new jo_wall(...)` calls
 * the old hand-written `switch` made — the parity that keeps existing maps playing identically.
 */
describe('tile catalog parity with the old jo_grid switch', () => {
  // [code, imageNumber, solid, blocksVision, restricted, door, doorHorizontal?]
  const expected: Array<[number, number, boolean, boolean, boolean, boolean, boolean?]> = [
    [1, 0, true, true, false, false], // black wall
    [2, 1, false, false, false, false], // white floor
    [3, 2, true, false, false, false], // brown desk
    [4, 3, false, false, true, false], // red restricted floor
    [5, 4, true, true, true, true, false], // door vertical
    [6, 4, true, true, true, true, true], // door horizontal
    [7, 5, true, false, false, false], // glass wall
  ];

  for (const [code, imageNumber, solid, blocksVision, restricted, door, doorHorizontal] of expected) {
    it(`code ${code} matches the original jo_wall args`, () => {
      const t = tileType(code);
      expect(t, `code ${code} missing from catalog`).toBeDefined();
      expect(t!.imageNumber).toBe(imageNumber);
      expect(t!.solid).toBe(solid);
      expect(t!.blocksVision).toBe(blocksVision);
      expect(t!.restricted).toBe(restricted);
      expect(t!.door).toBe(door);
      if (door) expect(!!t!.doorHorizontal).toBe(doorHorizontal);
    });
  }

  it('has no tiles beyond the ones the game knows', () => {
    expect(TILE_TYPES.map((t) => t.code).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('named tile codes (TILE)', () => {
  it('maps each name to its catalog code', () => {
    expect(TILE.wall).toBe(1);
    expect(TILE.floor).toBe(2);
    expect(TILE.desk).toBe(3);
    expect(TILE.restricted).toBe(4);
    expect(TILE.doorVertical).toBe(5);
    expect(TILE.doorHorizontal).toBe(6);
    expect(TILE.glass).toBe(7);
  });
});

describe('paintableTiles (what the editor palette generates)', () => {
  it('includes wall, desk, glass, floor and restricted', () => {
    const ids = paintableTiles().map((t) => t.id);
    expect(ids).toContain('wall');
    expect(ids).toContain('desk');
    expect(ids).toContain('glass'); // the tile that was missing from the editor before
    expect(ids).toContain('floor');
    expect(ids).toContain('restricted');
  });

  it('excludes doors (they have their own palette tools, not a plain paint button)', () => {
    const ids = paintableTiles().map((t) => t.id);
    expect(ids).not.toContain('doorVertical');
    expect(ids).not.toContain('doorHorizontal');
  });

  it('groups walls before floors', () => {
    const groups = paintableTiles().map((t) => t.paletteGroup);
    expect(groups.indexOf('Walls')).toBeLessThan(groups.indexOf('Floors'));
  });
});

describe('editor image discovery', () => {
  it('names the floor PNG the editor draws under doors and glass', () => {
    expect(editorTileFile(TILE.floor)).toBe('tile_white');
  });

  it('has no single image for glass (it is a translucent swatch) or doors', () => {
    expect(editorTileFile(TILE.glass)).toBeUndefined();
    expect(editorTileFile(TILE.doorVertical)).toBeUndefined();
  });

  it('lists every PNG the editor must preload, de-duplicated', () => {
    const files = editorTileFiles();
    expect(files).toContain('tile_black'); // wall base
    expect(files).toContain('tile_white'); // floor
    expect(files).toContain('tile_brown'); // desk
    expect(files).toContain('tile_red'); // restricted
    expect(new Set(files).size).toBe(files.length); // no duplicates
  });
});
