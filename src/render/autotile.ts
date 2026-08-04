/**
 * Wall autotiling (roadmap §6.2, step 5).
 *
 * A black wall's sprite depends on which of its four orthogonal neighbours are also walls:
 * a wall with neighbours on all sides uses the "four"-way tile, a lone wall the "single"
 * tile, and so on, each rotated to face the right way. This is the logic that used to live
 * inline in `jo_wall.findWallType`; it is extracted here so that when a wall is destroyed
 * the breach's edges can be re-tiled — the neighbours of the hole need to switch from,
 * say, a T-junction sprite to a corner sprite — without duplicating the rule.
 *
 * `findWallType` is pure: given the grid and a cell's coordinates it returns the sprite
 * variant name and the rotation to draw it at. `refreshAutotileAround` is the impure part
 * that actually re-draws a cell and its eight neighbours after a change; it reads the
 * shared `grid` global and calls each affected wall's `changeImage`, so it lives with the
 * other render code rather than in the pure grid layer.
 */

/** The six black-wall sprite variants in `walls.black`. */
export type WallType = 'single' | 'edge' | 'long' | 'corner' | 'T' | 'four';

/** A wall's chosen sprite and the rotation (radians) to draw it at. */
export interface WallTile {
  type: WallType;
  rotation: number;
}

/** A wall cell as `findWallType` reads it: just the three flags that decide the shape. */
export interface WallCellLike {
  solid: boolean;
  door: boolean;
  blocks_vision: boolean;
}

/** The minimal grid shape autotiling reads. Structural on purpose. */
export interface AutotileGridLike {
  getCellFromIndex(x: number, y: number): WallCellLike | undefined;
}

/**
 * Which sprite (and rotation) a wall at `(x, y)` should use, from its neighbours.
 *
 * A neighbour counts as "wall" only when it is solid, not a door, and vision-blocking —
 * the same test the original inline code used, so a doorway or a blown-open cell does not
 * pull an edge towards it. The rotation choices reproduce the original logic exactly,
 * including its quirk that a north+west corner ends up rotated by π; keeping it identical
 * means existing maps render pixel-for-pixel as before.
 */
export function findWallType(grid: AutotileGridLike, x: number, y: number): WallTile {
  const isWall = (cx: number, cy: number): boolean => {
    const cell = grid.getCellFromIndex(cx, cy);
    return !!(cell && cell.solid && !cell.door && cell.blocks_vision);
  };
  const north = isWall(x, y - 1);
  const south = isWall(x, y + 1);
  const east = isWall(x + 1, y);
  const west = isWall(x - 1, y);
  const count = (north ? 1 : 0) + (south ? 1 : 0) + (east ? 1 : 0) + (west ? 1 : 0);

  switch (count) {
    case 0:
      return { type: 'single', rotation: 0 };
    case 1: {
      let rotation = 0;
      if (west) rotation = Math.PI;
      if (south) rotation = Math.PI / 2;
      if (north) rotation = -Math.PI / 2;
      return { type: 'edge', rotation };
    }
    case 2: {
      if (north && south) return { type: 'long', rotation: Math.PI / 2 };
      if (east && west) return { type: 'long', rotation: 0 };
      let rotation = 0;
      if (north && west) rotation = Math.PI / 2;
      if (north && east) rotation = -Math.PI / 2;
      if (north && west) rotation = Math.PI; // preserved from the original (second write wins)
      if (south && west) rotation = Math.PI / 2;
      return { type: 'corner', rotation };
    }
    case 3: {
      let rotation = 0;
      if (north && south && east) rotation = -Math.PI / 2;
      if (north && south && west) rotation = Math.PI / 2;
      if (north && east && west) rotation = Math.PI;
      return { type: 'T', rotation };
    }
    default:
      return { type: 'four', rotation: 0 };
  }
}

/** A cell as `refreshAutotileAround` drives it: the wall flags plus its sprite controls. */
export interface RenderCellLike extends WallCellLike {
  image_number: number;
  changeImage(n: number): void;
}

/** The grid shape `refreshAutotileAround` needs: coordinate lookup returning full cells. */
export interface RefreshGridLike {
  width: number;
  getCellFromIndex(x: number, y: number): RenderCellLike | undefined;
}

/**
 * Re-tile a changed cell and its eight neighbours.
 *
 * Only black-wall cells that are still standing (`image_number === 0`, solid, opaque) are
 * re-drawn — `changeImage(0)` re-runs `findWallType` and rebuilds the sprite. The destroyed
 * cell itself is already showing its rubble tile by the time this runs, so it is skipped.
 * Called from the `cell:destroyed` pipeline after the grid flags have been updated.
 */
export function refreshAutotileAround(grid: RefreshGridLike, index: number): void {
  const originX = index % grid.width;
  const originY = Math.floor(index / grid.width);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = grid.getCellFromIndex(originX + dx, originY + dy);
      if (!cell) continue;
      // Only intact black walls need re-tiling; floors and rubble keep their sprite.
      if (cell.image_number === 0 && cell.solid && !cell.door && cell.blocks_vision) {
        cell.changeImage(0);
      }
    }
  }
}
