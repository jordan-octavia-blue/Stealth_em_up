/**
 * Tool application + object hit-testing (Phase 10 — map editor).
 *
 * This is the "what does a click do" layer, kept free of the DOM so it can be reasoned about
 * (and tested) on its own. The controller (editor.ts) turns pointer events into calls here:
 * painting a tile/door, dropping or moving an object, selecting/erasing what's under the
 * cursor, and editing patrol routes. All coordinates in are WORLD PIXELS unless named a cell.
 */

import type { MapData } from '../map/loader';
import type { WeaponId, GuardBehavior } from '../map/guards';
import { CELL, TILE, flatIndex, setDoor, setTile, stampVaultDoor } from './mapModel';
import type { ToolAction } from './palette';

/** What is currently selected for the inspector panel / erasing. */
export type Selection =
  | { type: 'guard'; index: number }
  | { type: 'camera'; index: number }
  | { type: 'point'; key: string }
  | { type: 'patrolPoint'; routeIndex: number; pointIndex: number };

/** The full object form of a guard, as the editor stores and edits it. */
export interface GuardObject {
  pos: [number, number];
  weapon?: WeaponId;
  riotShield?: boolean;
  behavior?: GuardBehavior;
  isBankManager?: boolean;
}

export interface CameraObject {
  pos: [number, number];
  swivel_min: number;
  swivel_max: number;
}

function objects(map: MapData): Record<string, unknown> {
  return map.objects as Record<string, unknown>;
}

function ensureArray(map: MapData, key: string): unknown[] {
  const obj = objects(map);
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key] as unknown[];
}

function isWallCell(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.data[flatIndex(map.width, x, y)] === TILE.wall;
}

/**
 * Choose a door orientation from the surrounding walls: a gap in a horizontal wall run (walls
 * to the east and west) is a horizontal door; a gap in a vertical run is a vertical door.
 * Defaults to vertical when there's no clear run.
 */
export function pickDoorOrientation(map: MapData, x: number, y: number): 'vertical' | 'horizontal' {
  const n = isWallCell(map, x, y - 1);
  const s = isWallCell(map, x, y + 1);
  const e = isWallCell(map, x + 1, y);
  const w = isWallCell(map, x - 1, y);
  if (e && w && !(n && s)) return 'horizontal';
  if (n && s && !(e && w)) return 'vertical';
  if (e && w) return 'horizontal';
  return 'vertical';
}

/** Apply a tile/door/vault tool at a cell. Returns any warnings (e.g. a vault that won't fit). */
export function applyTileTool(map: MapData, action: ToolAction, x: number, y: number): string[] {
  switch (action.kind) {
    case 'tile':
      setTile(map, x, y, action.code);
      return [];
    case 'door':
      setDoor(map, x, y, pickDoorOrientation(map, x, y), action.door);
      return [];
    case 'vault':
      return stampVaultDoor(map, x, y, pickDoorOrientation(map, x, y));
    default:
      return [];
  }
}

// --- object placement ------------------------------------------------------

export function placePoint(map: MapData, key: string, px: number, py: number): void {
  objects(map)[key] = [px, py];
}

export function addGuard(map: MapData, px: number, py: number): number {
  const arr = ensureArray(map, 'guards');
  arr.push({ pos: [px, py] } satisfies GuardObject);
  return arr.length - 1;
}

export function addCamera(map: MapData, px: number, py: number): number {
  const arr = ensureArray(map, 'security_cams');
  arr.push({ pos: [px, py], swivel_min: 0, swivel_max: Math.PI } satisfies CameraObject);
  return arr.length - 1;
}

/** Read a guard as an editable object (converting a legacy tuple on the way). */
export function guardObject(map: MapData, index: number): GuardObject | null {
  const g = (objects(map).guards as unknown[])?.[index];
  if (!g) return null;
  if (Array.isArray(g)) return { pos: [g[0], g[1]] };
  return g as GuardObject;
}

/** Merge a patch into a guard, upgrading a legacy tuple to the object form. */
export function updateGuard(map: MapData, index: number, patch: Partial<GuardObject>): void {
  const arr = objects(map).guards as unknown[];
  const current = guardObject(map, index);
  if (!current) return;
  arr[index] = { ...current, ...patch };
}

export function updateCamera(map: MapData, index: number, patch: Partial<CameraObject>): void {
  const arr = objects(map).security_cams as CameraObject[];
  if (!arr?.[index]) return;
  arr[index] = { ...arr[index], ...patch };
}

/** Move whatever is selected to a new world pixel (used when dragging an object). */
export function moveSelection(map: MapData, sel: Selection, px: number, py: number): void {
  switch (sel.type) {
    case 'point':
      placePoint(map, sel.key, px, py);
      break;
    case 'guard':
      updateGuard(map, sel.index, { pos: [px, py] });
      break;
    case 'camera':
      updateCamera(map, sel.index, { pos: [px, py] });
      break;
    case 'patrolPoint': {
      const route = map.patrolRoutes[sel.routeIndex];
      if (route) route.points[sel.pointIndex] = [px, py];
      break;
    }
  }
}

/** Delete the selected object. Required point objects (hero, van, …) can't be deleted. */
export function deleteSelection(map: MapData, sel: Selection): boolean {
  switch (sel.type) {
    case 'guard':
      (objects(map).guards as unknown[]).splice(sel.index, 1);
      return true;
    case 'camera':
      (objects(map).security_cams as unknown[]).splice(sel.index, 1);
      return true;
    case 'patrolPoint': {
      const route = map.patrolRoutes[sel.routeIndex];
      if (!route) return false;
      route.points.splice(sel.pointIndex, 1);
      if (route.points.length === 0) map.patrolRoutes.splice(sel.routeIndex, 1);
      return true;
    }
    case 'point':
      return false; // required spawns are mandatory; they can be moved, not removed
  }
}

// --- hit testing (for selection + erase) -----------------------------------

const HIT_RADIUS = 30;

function near(px: number, py: number, tx: number, ty: number, r = HIT_RADIUS): boolean {
  return Math.hypot(px - tx, py - ty) <= r;
}

/**
 * Find the topmost object at a world pixel, for selecting or erasing. Priority runs from the
 * most specific/movable to the least: patrol points, guards, cameras, then point spawns.
 */
export function hitTestObject(map: MapData, px: number, py: number): Selection | null {
  for (let ri = 0; ri < map.patrolRoutes.length; ri++) {
    const pts = map.patrolRoutes[ri].points;
    for (let pi = 0; pi < pts.length; pi++) {
      if (near(px, py, pts[pi][0], pts[pi][1], 12)) return { type: 'patrolPoint', routeIndex: ri, pointIndex: pi };
    }
  }
  const guards = objects(map).guards;
  if (Array.isArray(guards)) {
    for (let i = 0; i < guards.length; i++) {
      const g = guards[i];
      const pos = Array.isArray(g) ? g : (g as { pos?: number[] }).pos;
      if (pos && near(px, py, pos[0], pos[1])) return { type: 'guard', index: i };
    }
  }
  const cams = objects(map).security_cams;
  if (Array.isArray(cams)) {
    for (let i = 0; i < cams.length; i++) {
      const c = cams[i] as { pos?: number[] };
      if (c.pos && near(px, py, c.pos[0], c.pos[1])) return { type: 'camera', index: i };
    }
  }
  for (const key of ['hero', 'van', 'loot', 'computer', 'guard_backup_spawn']) {
    const p = objects(map)[key];
    if (Array.isArray(p) && near(px, py, p[0] as number, p[1] as number)) return { type: 'point', key };
  }
  return null;
}

// --- patrol routes ---------------------------------------------------------

/** Append a waypoint to a route (creating the route array entry if needed). */
export function addPatrolPoint(map: MapData, routeIndex: number, px: number, py: number): void {
  const route = map.patrolRoutes[routeIndex];
  if (route) route.points.push([px, py]);
}

/** Create a new, empty patrol route with a generated name; returns its index. */
export function createRoute(map: MapData): number {
  const name = `route_${map.patrolRoutes.length + 1}`;
  map.patrolRoutes.push({ name, points: [] });
  return map.patrolRoutes.length - 1;
}

/** Snap a world pixel to the centre of its cell (used when dropping tiles-aligned objects). */
export function snapToCell(px: number, py: number): [number, number] {
  return [Math.floor(px / CELL) * CELL + CELL / 2, Math.floor(py / CELL) * CELL + CELL / 2];
}
