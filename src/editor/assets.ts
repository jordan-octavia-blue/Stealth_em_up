/**
 * Editor asset loading (Phase 10 — map editor).
 *
 * The editor draws with a plain 2D canvas but reuses the game's own PNGs so a map looks the
 * same in the editor as it does in play. This module preloads every image the renderer needs
 * (the six autotiled black-wall variants, the floor/desk/restricted tiles, the door, and the
 * object icons) and hands back a struct of decoded `HTMLImageElement`s.
 */

import type { WallType } from '../render/autotile';

const IMG = (name: string): string => `/images/${name}.png`;

/** The six black-wall sprite variants, keyed by the name `findWallType` returns. */
const WALL_FILES: Record<WallType, string> = {
  single: 'wall_black_single',
  edge: 'wall_black_edge',
  long: 'wall_black_long',
  corner: 'wall_black_corner',
  T: 'wall_black_T',
  four: 'wall_black_four',
};

/** Object icons, keyed by a short editor name. */
const ICON_FILES: Record<string, string> = {
  hero: 'player_spawn_icon',
  guard: 'guard',
  guard_backup_spawn: 'guard_spawn_icon',
  van: 'van',
  loot: 'money',
  computer: 'computer',
  camera: 'camera',
};

export interface EditorAssets {
  wall: Record<WallType, HTMLImageElement>;
  tileFloor: HTMLImageElement;
  tileDesk: HTMLImageElement;
  tileRestricted: HTMLImageElement;
  tileWall: HTMLImageElement;
  doorClosed: HTMLImageElement;
  icons: Record<string, HTMLImageElement>;
  selector: HTMLImageElement;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** Preload every image the editor renderer needs. */
export async function loadEditorAssets(): Promise<EditorAssets> {
  const wall = {} as Record<WallType, HTMLImageElement>;
  await Promise.all(
    (Object.keys(WALL_FILES) as WallType[]).map(async (k) => {
      wall[k] = await loadImage(IMG(WALL_FILES[k]));
    }),
  );
  const icons: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.keys(ICON_FILES).map(async (k) => {
      icons[k] = await loadImage(IMG(ICON_FILES[k]));
    }),
  );
  const [tileFloor, tileDesk, tileRestricted, tileWall, doorClosed, selector] = await Promise.all([
    loadImage(IMG('tile_white')),
    loadImage(IMG('tile_brown')),
    loadImage(IMG('tile_red')),
    loadImage(IMG('tile_black')),
    loadImage(IMG('door_closed')),
    loadImage(IMG('selector')),
  ]);
  return { wall, tileFloor, tileDesk, tileRestricted, tileWall, doorClosed, icons, selector };
}
