/**
 * Canvas rendering for the editor (Phase 10 — map editor).
 *
 * Draws a `MapData` to a 2D canvas: tiles (black walls run through the game's own
 * `findWallType` so they autotile identically), doors with a type-coloured badge, every
 * placed object, the escape rectangle, patrol routes, and editing overlays (hover cell,
 * selection). A `View` (pan + zoom) maps world pixels to the canvas.
 */

import type { MapData } from '../map/loader';
import { findWallType } from '../render/autotile';
import { TILE, editorTileFile, tileType } from '../map/tiles';
import { autotileAdapter } from './autotileAdapter';
import { CELL, flatIndex } from './mapModel';
import type { EditorAssets } from './assets';
import { DOOR_TYPE_COLORS } from './palette';
import type { Selection } from './tools';

/** The floor PNG basename — drawn as the base under doors and translucent (glass) tiles. */
const FLOOR_FILE = editorTileFile(TILE.floor) ?? 'tile_white';

/** Pan + zoom: a world pixel (wx, wy) draws at (wx*scale + offsetX, wy*scale + offsetY). */
export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface RenderUi {
  hover: { x: number; y: number } | null;
  selection: Selection | null;
  /** Route index currently being edited (its waypoints are highlighted). */
  activeRoute: number | null;
}

const ICON_SIZE = 46;

export function screenToWorld(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

export function worldToScreen(view: View, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * view.scale + view.offsetX, y: wy * view.scale + view.offsetY };
}

/** Fit the whole map into a canvas of the given size, centred, with a small margin. */
export function fitView(map: MapData, canvasW: number, canvasH: number): View {
  const worldW = map.width * CELL;
  const worldH = map.height * CELL;
  const scale = Math.min(canvasW / worldW, canvasH / worldH) * 0.92;
  return {
    scale,
    offsetX: (canvasW - worldW * scale) / 2,
    offsetY: (canvasH - worldH * scale) / 2,
  };
}

export function renderMap(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  map: MapData,
  assets: EditorAssets,
  view: View,
  ui: RenderUi,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0e0f14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ctx.imageSmoothingEnabled = false;

  const grid = autotileAdapter(map);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      drawCell(ctx, assets, grid, map, x, y);
    }
  }
  drawGridLines(ctx, map, view);
  drawEscape(ctx, map);
  drawPatrolRoutes(ctx, map, ui);
  drawObjects(ctx, assets, map);
  drawSelection(ctx, map, ui);
  drawHover(ctx, assets, ui);
  drawBorderOutline(ctx, map);
}

/**
 * Draw one map cell. Every tile is drawn from its entry in the shared catalog
 * (src/map/tiles.ts), so a new tile added there renders here with no edit: an `image` tile
 * draws its PNG, a `wall` tile gets the autotiled overlay, a `door` gets the door sprite + type
 * badge, and anything else (glass today, any art-less future tile) draws as a translucent
 * colour over the floor. A code missing from the catalog falls back to a plain floor.
 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  assets: EditorAssets,
  grid: ReturnType<typeof autotileAdapter>,
  map: MapData,
  x: number,
  y: number,
): void {
  const px = x * CELL;
  const py = y * CELL;
  const code = map.data[flatIndex(map.width, x, y)];
  const t = tileType(code);
  if (!t) {
    ctx.drawImage(assets.tiles[FLOOR_FILE], px, py, CELL, CELL);
    return;
  }
  const draw = t.editorDraw;
  switch (draw.kind) {
    case 'image':
      ctx.drawImage(assets.tiles[draw.file], px, py, CELL, CELL);
      break;
    case 'wall': {
      ctx.drawImage(assets.tiles[draw.base], px, py, CELL, CELL);
      const wt = findWallType(grid, x, y);
      ctx.save();
      ctx.translate(px + CELL / 2, py + CELL / 2);
      ctx.rotate(wt.rotation);
      ctx.drawImage(assets.wall[wt.type], -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
      break;
    }
    case 'door': {
      ctx.drawImage(assets.tiles[FLOOR_FILE], px, py, CELL, CELL);
      ctx.save();
      ctx.translate(px + CELL / 2, py + CELL / 2);
      if (t.doorHorizontal) ctx.rotate(Math.PI / 2);
      ctx.drawImage(assets.doorClosed, -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
      const spec = map.doorTypes[flatIndex(map.width, x, y)];
      ctx.fillStyle = DOOR_TYPE_COLORS[spec?.type ?? 'locked'];
      ctx.fillRect(px + 3, py + 3, 13, 13);
      break;
    }
    case 'swatch': {
      ctx.drawImage(assets.tiles[FLOOR_FILE], px, py, CELL, CELL);
      ctx.globalAlpha = draw.alpha;
      ctx.fillStyle = draw.color;
      ctx.fillRect(px, py, CELL, CELL);
      ctx.globalAlpha = 1;
      // A thin outline so a translucent tile (e.g. glass) reads as a distinct filled cell.
      ctx.strokeStyle = draw.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
      break;
    }
  }
}

function drawGridLines(ctx: CanvasRenderingContext2D, map: MapData, view: View): void {
  if (view.scale < 0.25) return; // too dense to be useful when zoomed far out
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let x = 0; x <= map.width; x++) {
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, map.height * CELL);
  }
  for (let y = 0; y <= map.height; y++) {
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(map.width * CELL, y * CELL);
  }
  ctx.stroke();
}

function drawBorderOutline(ctx: CanvasRenderingContext2D, map: MapData): void {
  ctx.strokeStyle = 'rgba(120,180,255,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, map.width * CELL, map.height * CELL);
}

function drawEscape(ctx: CanvasRenderingContext2D, map: MapData): void {
  const e = (map.objects as Record<string, unknown>).escape;
  if (!Array.isArray(e) || e.length < 4) return;
  const [x, y, w, h] = e as number[];
  ctx.fillStyle = 'rgba(0,255,102,0.14)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,255,102,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,255,102,0.9)';
  ctx.font = '16px sans-serif';
  ctx.fillText('ESCAPE', x + 6, y + 20);
}

function drawPatrolRoutes(ctx: CanvasRenderingContext2D, map: MapData, ui: RenderUi): void {
  map.patrolRoutes.forEach((route, ri) => {
    const active = ri === ui.activeRoute;
    ctx.strokeStyle = active ? '#5ad1ff' : 'rgba(90,180,255,0.5)';
    ctx.lineWidth = active ? 3 : 2;
    ctx.beginPath();
    route.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    route.points.forEach(([x, y], i) => {
      ctx.fillStyle = active ? '#5ad1ff' : 'rgba(90,180,255,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#04121f';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(String(i + 1), x - 3, y + 4);
    });
  });
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  px: number,
  py: number,
  size = ICON_SIZE,
): void {
  ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
}

function drawObjects(ctx: CanvasRenderingContext2D, assets: EditorAssets, map: MapData): void {
  const obj = map.objects as Record<string, unknown>;
  const point = (key: string): [number, number] | null => {
    const p = obj[key];
    return Array.isArray(p) && typeof p[0] === 'number' ? [p[0], p[1]] : null;
  };
  // cameras (draw sweep wedge first, under icons)
  if (Array.isArray(obj.security_cams)) {
    for (const cam of obj.security_cams as Array<{ pos?: number[]; swivel_min?: number; swivel_max?: number }>) {
      if (!cam.pos) continue;
      const [cx, cy] = cam.pos;
      const min = cam.swivel_min ?? 0;
      const max = cam.swivel_max ?? Math.PI * 2;
      ctx.fillStyle = 'rgba(230,126,34,0.18)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, CELL * 2.5, min, max);
      ctx.closePath();
      ctx.fill();
      drawIcon(ctx, assets.icons.camera, cx, cy, 34);
    }
  }
  for (const key of ['van', 'loot', 'computer', 'guard_backup_spawn', 'hero']) {
    const p = point(key);
    if (p && assets.icons[key]) drawIcon(ctx, assets.icons[key], p[0], p[1]);
  }
  if (Array.isArray(obj.guards)) {
    for (const g of obj.guards as unknown[]) {
      const pos = Array.isArray(g) ? g : (g as { pos?: number[] }).pos;
      if (!pos) continue;
      const [gx, gy] = pos as number[];
      drawIcon(ctx, assets.icons.guard, gx, gy, 40);
      const info = Array.isArray(g) ? {} : (g as { riotShield?: boolean; isBankManager?: boolean });
      if (info.riotShield) {
        ctx.strokeStyle = '#4fd1ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(gx, gy, 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (info.isBankManager) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.arc(gx + 16, gy - 16, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('K', gx + 12, gy - 12);
      }
    }
  }
}

function objectPixel(map: MapData, sel: Selection): [number, number] | null {
  const obj = map.objects as Record<string, unknown>;
  switch (sel.type) {
    case 'point': {
      const p = obj[sel.key];
      return Array.isArray(p) ? [p[0] as number, p[1] as number] : null;
    }
    case 'guard': {
      const g = (obj.guards as unknown[])?.[sel.index];
      const pos = Array.isArray(g) ? g : (g as { pos?: number[] })?.pos;
      return pos ? [pos[0] as number, pos[1] as number] : null;
    }
    case 'camera': {
      const c = (obj.security_cams as Array<{ pos?: number[] }>)?.[sel.index];
      return c?.pos ? [c.pos[0], c.pos[1]] : null;
    }
    case 'patrolPoint': {
      const pt = map.patrolRoutes[sel.routeIndex]?.points[sel.pointIndex];
      return pt ? [pt[0], pt[1]] : null;
    }
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, map: MapData, ui: RenderUi): void {
  if (!ui.selection) return;
  const p = objectPixel(map, ui.selection);
  if (!p) return;
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 28, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHover(ctx: CanvasRenderingContext2D, assets: EditorAssets, ui: RenderUi): void {
  if (!ui.hover) return;
  const px = ui.hover.x * CELL;
  const py = ui.hover.y * CELL;
  ctx.globalAlpha = 0.7;
  ctx.drawImage(assets.selector, px, py, CELL, CELL);
  ctx.globalAlpha = 1;
}
