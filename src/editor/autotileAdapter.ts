/**
 * Adapt an editor `MapData` to the shape the game's wall autotiler reads.
 *
 * `findWallType` (src/render/autotile.ts) decides which of the six black-wall sprites a wall
 * cell uses from its four orthogonal neighbours. It asks a grid for `getCellFromIndex(x,y)`
 * and treats a neighbour as "wall" only when it is `solid && !door && blocks_vision`. The game
 * reads those three flags for each tile code from the shared tile catalog (src/map/tiles.ts)
 * when it builds the grid; the editor has only the raw `data[]` array, so this adapter looks the
 * flags up in that same catalog. Feeding `findWallType` through this adapter makes the editor
 * draw walls pixel-for-pixel like the game — the whole reason the editor reuses the game's
 * autotiler instead of its own.
 */

import type { MapData } from '../map/loader';
import { tileType } from '../map/tiles';
import type { AutotileGridLike, WallCellLike } from '../render/autotile';

/**
 * The three autotile flags for a tile code, read straight from the shared tile catalog
 * (src/map/tiles.ts) — the same flags the game grid hands to `jo_wall`, so the editor autotiles
 * identically to the game. `findWallType` counts a neighbour as a wall only when it is
 * solid + vision-blocking + not-a-door, so of today's tiles only the black wall (code 1) pulls
 * an edge toward it; a desk, glass, door or floor does not. A code missing from the catalog
 * (an unknown/legacy tile) is treated as empty floor.
 */
export function cellFlagsForCode(code: number): WallCellLike {
  const t = tileType(code);
  if (!t) return { solid: false, door: false, blocks_vision: false };
  return { solid: t.solid, door: t.door, blocks_vision: t.blocksVision };
}

/** Wrap a `MapData` (read-only) as the grid `findWallType` expects. */
export function autotileAdapter(map: MapData): AutotileGridLike {
  return {
    getCellFromIndex(x: number, y: number): WallCellLike | undefined {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
      return cellFlagsForCode(map.data[map.width * y + x]);
    },
  };
}
