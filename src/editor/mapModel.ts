/**
 * The editor's pure map model (Phase 10 — map editor).
 *
 * Everything here is pure data manipulation on a `MapData` (the same shape the game loads),
 * with no canvas, DOM, or globals — so it is all unit-testable. The UI layer (tools.ts,
 * render.ts) calls these to build a new map, paint tiles, place objects, grow/shrink the map
 * in any direction, and serialize to/from the `.jomap` JSON the game reads.
 *
 * Coordinate model (repeated everywhere, so stated once):
 *  - `data[]` is row-major; a cell (x, y) is at flat index `width * y + x`.
 *  - Object coordinates in `objects{}` and `patrolRoutes` are WORLD PIXELS; cell = 64 px, so
 *    the cell under a pixel is `floor(px / 64)`.
 *  - The outer ring of cells is always indestructible wall in the game, so the editor keeps
 *    it as wall (code 1) and refuses to paint over it.
 */

import { CURRENT_MAP_VERSION, type MapData, loadMap } from '../map/loader';
import { DOOR_TYPE_DEFAULTS, type DoorSpec, type DoorType } from '../map/doors';
import { TILE } from '../map/tiles';

/** Pixels per cell — the game's fixed grid size. */
export const CELL = 64;

// Tile codes come from the shared tile catalog (src/map/tiles.ts), the single source of truth
// the game grid and the whole editor derive from. Re-exported so the editor's existing
// `import { TILE } from './mapModel'` call sites keep working.
export { TILE };

/** Smallest allowed map: a 1-cell indestructible border on each side needs ≥1 interior cell. */
export const MIN_DIM = 3;

/** Default size for a brand-new map — small, since growing outward is easy. */
export const DEFAULT_WIDTH = 20;
export const DEFAULT_HEIGHT = 15;

/** Which map edge a grow/shrink acts on. */
export type Edge = 'N' | 'S' | 'E' | 'W';

/** Thrown when an edit is refused (too small, would delete a required object, …). */
export class EditError extends Error {}

/** The five point-objects the game dereferences without a null check — all required. */
const REQUIRED_POINT_OBJECTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hero', label: 'hero spawn' },
  { key: 'guard_backup_spawn', label: 'guard backup spawn' },
  { key: 'computer', label: 'computer' },
  { key: 'van', label: 'van' },
  { key: 'loot', label: 'money' },
];

/** Convert a pixel coordinate to its cell index on one axis. */
export function cellOf(px: number): number {
  return Math.floor(px / CELL);
}

/** The pixel at the centre of cell `c` (where the editor drops objects). */
export function cellCenterPx(c: number): number {
  return c * CELL + CELL / 2;
}

/** Flat index of cell (x, y) in a map of the given width. */
export function flatIndex(width: number, x: number, y: number): number {
  return width * y + x;
}

function isBorder(x: number, y: number, w: number, h: number): boolean {
  return x === 0 || y === 0 || x === w - 1 || y === h - 1;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * A fresh map: a wall border, a floor interior, and the five required objects pre-placed on
 * interior floor so the map is immediately valid and Play-able (the game crashes on a missing
 * required object). Guards and cameras start empty.
 */
export function createEmptyMap(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): MapData {
  const w = Math.max(MIN_DIM, Math.floor(width));
  const h = Math.max(MIN_DIM, Math.floor(height));
  const data: number[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[flatIndex(w, x, y)] = isBorder(x, y, w, h) ? TILE.wall : TILE.floor;
    }
  }
  // Spread the required objects around the interior so a new map plays without edits.
  const left = 2;
  const right = w - 3;
  const top = 2;
  const bottom = h - 3;
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const at = (cx: number, cy: number): [number, number] => [cellCenterPx(cx), cellCenterPx(cy)];
  return {
    version: CURRENT_MAP_VERSION,
    width: w,
    height: h,
    data,
    objects: {
      hero: at(left, bottom),
      guards: [],
      guard_backup_spawn: at(right, bottom),
      security_cams: [],
      computer: at(right, top),
      van: at(left, top),
      loot: at(midX, midY),
    },
    tilesetRef: 'data/tileset.json',
    patrolRoutes: [],
    hpOverrides: {},
    doorTypes: {},
  };
}

// ---------------------------------------------------------------------------
// Tile painting
// ---------------------------------------------------------------------------

/**
 * Paint a single cell. Cells on the outer ring are left as wall (the game forces the border
 * indestructible), so a paint there is ignored. Painting anything other than a door over a
 * door cell also clears that cell's door metadata.
 */
export function setTile(map: MapData, x: number, y: number, code: number): void {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
  if (isBorder(x, y, map.width, map.height)) return; // border stays indestructible wall
  const idx = flatIndex(map.width, x, y);
  map.data[idx] = code;
  const isDoor = code === TILE.doorVertical || code === TILE.doorHorizontal;
  if (!isDoor && map.doorTypes[idx]) delete map.doorTypes[idx];
  if (code !== TILE.wall && code !== TILE.desk && map.hpOverrides[idx]) delete map.hpOverrides[idx];
}

/**
 * Paint a door cell (orientation-selected tile code) and record its type. A single-cell door;
 * the 3-wide vault is stamped by {@link stampVaultDoor}.
 */
export function setDoor(
  map: MapData,
  x: number,
  y: number,
  orientation: 'vertical' | 'horizontal',
  type: DoorType,
): void {
  if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) return;
  const code = orientation === 'vertical' ? TILE.doorVertical : TILE.doorHorizontal;
  const idx = flatIndex(map.width, x, y);
  map.data[idx] = code;
  map.doorTypes[idx] = { type };
}

/**
 * Stamp a 3-cell-wide vault door starting at (x, y) and running east (horizontal orientation)
 * or south (vertical). All three cells share a `group` (the anchor's flat index) so one
 * lockpick opens the whole door. Returns warnings if the run doesn't fit.
 */
export function stampVaultDoor(
  map: MapData,
  x: number,
  y: number,
  orientation: 'vertical' | 'horizontal',
): string[] {
  const width = DOOR_TYPE_DEFAULTS.vault.width;
  const code = orientation === 'vertical' ? TILE.doorVertical : TILE.doorHorizontal;
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < width; i++) {
    const cx = orientation === 'horizontal' ? x + i : x;
    const cy = orientation === 'vertical' ? y + i : y;
    if (cx <= 0 || cy <= 0 || cx >= map.width - 1 || cy >= map.height - 1) {
      return [`Vault door doesn't fit here — needs ${width} interior cells in a row.`];
    }
    cells.push([cx, cy]);
  }
  const anchor = flatIndex(map.width, cells[0][0], cells[0][1]);
  for (const [cx, cy] of cells) {
    const idx = flatIndex(map.width, cx, cy);
    map.data[idx] = code;
    map.doorTypes[idx] = { type: 'vault', group: anchor };
  }
  return [];
}

// ---------------------------------------------------------------------------
// Object coordinate walking (used by shift + clamp during bounds ops)
// ---------------------------------------------------------------------------

type CoordFn = (x: number, y: number) => [number, number];

function isNumPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** Apply `fn` to every world-pixel coordinate stored in the map's objects and patrol routes. */
function transformAllCoords(map: MapData, fn: CoordFn): void {
  const obj = map.objects as Record<string, unknown>;
  for (const { key } of REQUIRED_POINT_OBJECTS) {
    if (isNumPair(obj[key])) obj[key] = fn((obj[key] as number[])[0], (obj[key] as number[])[1]);
  }
  if (Array.isArray(obj.guards)) {
    obj.guards = (obj.guards as unknown[]).map((g) => {
      if (isNumPair(g)) return fn(g[0], g[1]);
      if (g && typeof g === 'object' && isNumPair((g as { pos?: unknown }).pos)) {
        const pos = (g as { pos: number[] }).pos;
        return { ...(g as object), pos: fn(pos[0], pos[1]) };
      }
      return g;
    });
  }
  if (Array.isArray(obj.security_cams)) {
    for (const cam of obj.security_cams as Array<{ pos?: unknown }>) {
      if (cam && isNumPair(cam.pos)) cam.pos = fn(cam.pos[0], cam.pos[1]);
    }
  }
  // escape is [x, y, w, h]; only the origin (x, y) moves with the grid.
  if (Array.isArray(obj.escape) && (obj.escape as number[]).length >= 2) {
    const e = obj.escape as number[];
    const [nx, ny] = fn(e[0], e[1]);
    e[0] = nx;
    e[1] = ny;
  }
  for (const route of map.patrolRoutes) {
    route.points = route.points.map(([x, y]) => fn(x, y));
  }
}

function clampObjectsToBounds(map: MapData, warnings: string[]): void {
  const maxX = map.width * CELL - 1;
  const maxY = map.height * CELL - 1;
  let clamped = false;
  transformAllCoords(map, (x, y) => {
    const nx = Math.min(Math.max(x, 0), maxX);
    const ny = Math.min(Math.max(y, 0), maxY);
    if (nx !== x || ny !== y) clamped = true;
    return [nx, ny];
  });
  if (clamped) warnings.push('Some objects were nudged back inside the new map bounds.');
}

// ---------------------------------------------------------------------------
// Bounds expansion / contraction
// ---------------------------------------------------------------------------

interface BoundsSpec {
  newWidth: number;
  newHeight: number;
  /** Old cell (ox, oy) → new cell, or null if this old cell is dropped. */
  remap: (ox: number, oy: number) => [number, number] | null;
  dxPx: number;
  dyPx: number;
}

function remapIndexDict(
  dict: Record<number, number>,
  indexRemap: Map<number, number>,
  onBorder: (idx: number) => boolean,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(dict)) {
    const ni = indexRemap.get(Number(key));
    if (ni === undefined || onBorder(ni)) continue; // cell deleted or now indestructible wall
    out[ni] = value;
  }
  return out;
}

function remapDoorTypes(
  dict: Record<number, DoorSpec>,
  indexRemap: Map<number, number>,
  onBorder: (idx: number) => boolean,
): Record<number, DoorSpec> {
  const out: Record<number, DoorSpec> = {};
  for (const [key, spec] of Object.entries(dict)) {
    const ni = indexRemap.get(Number(key));
    if (ni === undefined || onBorder(ni)) continue;
    const next: DoorSpec = { ...spec };
    if (next.group !== undefined) {
      next.group = indexRemap.get(next.group) ?? ni; // fall back to standalone if anchor gone
    }
    out[ni] = next;
  }
  return out;
}

/**
 * Re-check every multi-cell (vault) door group after a structural edit. A vault must be a
 * contiguous, collinear run of the expected width; if a row/column insert or remove cut
 * through it, demote the survivors to reinforced doors and warn rather than leave a broken
 * group behind.
 */
function revalidateVaultGroups(map: MapData, warnings: string[]): void {
  const byGroup = new Map<number, number[]>(); // group id → flat indices
  for (const [key, spec] of Object.entries(map.doorTypes)) {
    if (spec.type !== 'vault') continue;
    const group = spec.group ?? Number(key);
    (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(Number(key));
  }
  const expected = DOOR_TYPE_DEFAULTS.vault.width;
  for (const indices of byGroup.values()) {
    const cells = indices.map((i) => ({ x: i % map.width, y: Math.floor(i / map.width) }));
    const xs = new Set(cells.map((c) => c.x));
    const ys = new Set(cells.map((c) => c.y));
    const collinear = xs.size === 1 || ys.size === 1;
    const span = xs.size === 1 ? ys.size === cells.length : xs.size === cells.length;
    const contiguous =
      xs.size === 1
        ? Math.max(...cells.map((c) => c.y)) - Math.min(...cells.map((c) => c.y)) === cells.length - 1
        : Math.max(...cells.map((c) => c.x)) - Math.min(...cells.map((c) => c.x)) === cells.length - 1;
    const intact = cells.length === expected && collinear && span && contiguous;
    if (!intact) {
      for (const i of indices) map.doorTypes[i] = { type: 'reinforced' };
      warnings.push('A vault door was split by the resize and became reinforced doors.');
    }
  }
}

function applyBounds(src: MapData, spec: BoundsSpec): { map: MapData; warnings: string[] } {
  const { newWidth, newHeight, remap, dxPx, dyPx } = spec;
  if (newWidth < MIN_DIM || newHeight < MIN_DIM) {
    throw new EditError(`A map can't be smaller than ${MIN_DIM}×${MIN_DIM} cells.`);
  }
  const warnings: string[] = [];
  const map = structuredClone(src) as MapData;
  const { width: oldW, height: oldH } = src;

  const indexRemap = new Map<number, number>();
  const newData: number[] = new Array(newWidth * newHeight).fill(TILE.wall);
  for (let oy = 0; oy < oldH; oy++) {
    for (let ox = 0; ox < oldW; ox++) {
      const nn = remap(ox, oy);
      if (!nn) continue;
      const [nx, ny] = nn;
      if (nx < 0 || ny < 0 || nx >= newWidth || ny >= newHeight) continue;
      const newIdx = flatIndex(newWidth, nx, ny);
      newData[newIdx] = src.data[flatIndex(oldW, ox, oy)];
      indexRemap.set(flatIndex(oldW, ox, oy), newIdx);
    }
  }

  // The outer ring must be indestructible wall. New cells are already wall; a surviving
  // non-wall cell that lands on the new border is overwritten (and counted as a warning).
  const onBorder = (idx: number): boolean =>
    isBorder(idx % newWidth, Math.floor(idx / newWidth), newWidth, newHeight);
  let borderOverwrites = 0;
  for (let idx = 0; idx < newData.length; idx++) {
    if (onBorder(idx) && newData[idx] !== TILE.wall) {
      newData[idx] = TILE.wall;
      borderOverwrites++;
    }
  }
  if (borderOverwrites > 0) {
    warnings.push(`${borderOverwrites} edge cell(s) became indestructible wall.`);
  }

  map.width = newWidth;
  map.height = newHeight;
  map.data = newData;
  map.hpOverrides = remapIndexDict(src.hpOverrides, indexRemap, onBorder);
  map.doorTypes = remapDoorTypes(src.doorTypes, indexRemap, onBorder);

  if (dxPx !== 0 || dyPx !== 0) transformAllCoords(map, (x, y) => [x + dxPx, y + dyPx]);
  clampObjectsToBounds(map, warnings);
  revalidateVaultGroups(map, warnings);
  return { map, warnings };
}

function deletedLineHasRequiredObject(map: MapData, edge: Edge): void {
  const { width: w, height: h } = map;
  const inLine = (cx: number, cy: number): boolean => {
    switch (edge) {
      case 'W':
        return cx === 0;
      case 'E':
        return cx === w - 1;
      case 'N':
        return cy === 0;
      case 'S':
        return cy === h - 1;
    }
  };
  const obj = map.objects as Record<string, unknown>;
  for (const { key, label } of REQUIRED_POINT_OBJECTS) {
    const p = obj[key];
    if (isNumPair(p) && inLine(cellOf(p[0]), cellOf(p[1]))) {
      throw new EditError(`Can't remove that edge — the ${label} is on it. Move it first.`);
    }
  }
}

/** Grow the map by one row/column on the given edge. Returns a new map + any warnings. */
export function expandMap(map: MapData, edge: Edge): { map: MapData; warnings: string[] } {
  const { width: w, height: h } = map;
  switch (edge) {
    case 'W':
      return applyBounds(map, { newWidth: w + 1, newHeight: h, remap: (x, y) => [x + 1, y], dxPx: CELL, dyPx: 0 });
    case 'E':
      return applyBounds(map, { newWidth: w + 1, newHeight: h, remap: (x, y) => [x, y], dxPx: 0, dyPx: 0 });
    case 'N':
      return applyBounds(map, { newWidth: w, newHeight: h + 1, remap: (x, y) => [x, y + 1], dxPx: 0, dyPx: CELL });
    case 'S':
      return applyBounds(map, { newWidth: w, newHeight: h + 1, remap: (x, y) => [x, y], dxPx: 0, dyPx: 0 });
  }
}

/** Shrink the map by one row/column on the given edge. Refuses if a required object is on it. */
export function contractMap(map: MapData, edge: Edge): { map: MapData; warnings: string[] } {
  const { width: w, height: h } = map;
  deletedLineHasRequiredObject(map, edge);
  switch (edge) {
    case 'W':
      return applyBounds(map, { newWidth: w - 1, newHeight: h, remap: (x, y) => (x === 0 ? null : [x - 1, y]), dxPx: -CELL, dyPx: 0 });
    case 'E':
      return applyBounds(map, { newWidth: w - 1, newHeight: h, remap: (x, y) => (x === w - 1 ? null : [x, y]), dxPx: 0, dyPx: 0 });
    case 'N':
      return applyBounds(map, { newWidth: w, newHeight: h - 1, remap: (x, y) => (y === 0 ? null : [x, y - 1]), dxPx: 0, dyPx: -CELL });
    case 'S':
      return applyBounds(map, { newWidth: w, newHeight: h - 1, remap: (x, y) => (y === h - 1 ? null : [x, y]), dxPx: 0, dyPx: 0 });
  }
}

// ---------------------------------------------------------------------------
// Serialization + completeness
// ---------------------------------------------------------------------------

/**
 * Serialize a map to the `.jomap` JSON the game loads (pretty-printed for a human-readable
 * export). Empty optional fields are omitted to keep files close to the hand-authored style.
 */
export function serialize(map: MapData): string {
  const out: Record<string, unknown> = {
    version: CURRENT_MAP_VERSION,
    width: map.width,
    height: map.height,
    data: map.data,
    objects: map.objects,
    tilesetRef: map.tilesetRef,
  };
  if (map.patrolRoutes.length > 0) out.patrolRoutes = map.patrolRoutes;
  if (Object.keys(map.hpOverrides).length > 0) out.hpOverrides = map.hpOverrides;
  if (Object.keys(map.doorTypes).length > 0) out.doorTypes = map.doorTypes;
  return JSON.stringify(out, null, 2);
}

/** Parse `.jomap` JSON back into a validated `MapData` (throws on an invalid file). */
export function deserialize(json: string): MapData {
  return loadMap(JSON.parse(json));
}

/**
 * Check the map has everything the game dereferences without a null check. Returns the list
 * of missing pieces (empty ⇒ safe to Play/export). This is the crash gate.
 */
export function validateComplete(map: MapData): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const obj = map.objects as Record<string, unknown>;
  const inBounds = (p: number[]): boolean =>
    cellOf(p[0]) >= 0 && cellOf(p[0]) < map.width && cellOf(p[1]) >= 0 && cellOf(p[1]) < map.height;
  for (const { key, label } of REQUIRED_POINT_OBJECTS) {
    const p = obj[key];
    if (!isNumPair(p)) missing.push(label);
    else if (!inBounds(p)) missing.push(`${label} (outside the map)`);
  }
  if (!Array.isArray(obj.guards)) missing.push('guards list');
  if (!Array.isArray(obj.security_cams)) missing.push('cameras list');
  return { ok: missing.length === 0, missing };
}
