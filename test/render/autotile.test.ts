import { describe, expect, it } from 'vitest';
import { AutotileGridLike, findWallType, refreshAutotileAround } from '../../src/render/autotile';

/**
 * A grid of walls from ASCII: `#` is an intact black wall (solid + opaque), anything else
 * is open floor. Matches the neighbour test `findWallType` uses.
 */
function grid(rows: string[]): AutotileGridLike & { width: number } {
  const width = rows[0].length;
  const height = rows.length;
  const wall = (x: number, y: number) => rows[y]?.[x] === '#';
  return {
    width,
    getCellFromIndex(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
      return { solid: wall(x, y), door: false, blocks_vision: wall(x, y) };
    },
  };
}

describe('findWallType', () => {
  it('is a "single" tile with no wall neighbours', () => {
    const g = grid(['...', '.#.', '...']);
    expect(findWallType(g, 1, 1).type).toBe('single');
  });

  it('is a "four" tile surrounded on all sides', () => {
    const g = grid(['.#.', '###', '.#.']);
    expect(findWallType(g, 1, 1).type).toBe('four');
  });

  it('is an "edge" tile with a single neighbour', () => {
    const g = grid(['.#.', '.#.', '...']);
    expect(findWallType(g, 1, 1).type).toBe('edge');
  });

  it('is a "long" tile in a straight run', () => {
    const g = grid(['###']);
    expect(findWallType(g, 1, 0).type).toBe('long');
  });

  it('is a "corner" tile where two runs meet at a right angle', () => {
    // wall at (1,1) has neighbours to the south and east only
    const g = grid(['...', '.##', '.#.']);
    expect(findWallType(g, 1, 1).type).toBe('corner');
  });

  it('is a "T" tile at a three-way junction', () => {
    const g = grid(['.#.', '###', '...']);
    expect(findWallType(g, 1, 1).type).toBe('T');
  });

  it('gives a straight horizontal run zero rotation and a vertical run a quarter turn', () => {
    expect(findWallType(grid(['###']), 1, 0).rotation).toBe(0);
    expect(findWallType(grid(['#', '#', '#']), 0, 1).rotation).toBeCloseTo(Math.PI / 2);
  });

  it('does not count a doorway or a see-through cell as a wall neighbour', () => {
    const g: AutotileGridLike = {
      getCellFromIndex(x: number, y: number) {
        if (x === 1 && y === 1) return { solid: true, door: false, blocks_vision: true };
        // A door directly north: solid, but a door and thus not a wall for tiling.
        if (x === 1 && y === 0) return { solid: true, door: true, blocks_vision: true };
        return { solid: false, door: false, blocks_vision: false };
      },
    };
    expect(findWallType(g, 1, 1).type).toBe('single');
  });
});

describe('refreshAutotileAround', () => {
  it('re-tiles standing black walls in the 3x3 around a breach, and nothing else', () => {
    const redrawn: number[] = [];
    const width = 3;
    // A 3x3 patch: (1,1) has just been destroyed (now floor); its neighbours are walls.
    const cellAt = (x: number, y: number, index: number) => {
      const isFloor = x === 1 && y === 1; // the breach
      return {
        solid: !isFloor,
        door: false,
        blocks_vision: !isFloor,
        image_number: isFloor ? 1 : 0, // rubble shows white floor; walls are black (0)
        changeImage() {
          redrawn.push(index);
        },
      };
    };
    const g = {
      width,
      getCellFromIndex(x: number, y: number) {
        if (x < 0 || y < 0 || x >= width || y >= 3) return undefined;
        return cellAt(x, y, y * width + x);
      },
    };

    refreshAutotileAround(g, 1 * width + 1);

    // The breach cell (index 4) is floor now, so it is not re-tiled; the other eight are.
    expect(redrawn).not.toContain(4);
    expect(redrawn).toHaveLength(8);
  });
});
