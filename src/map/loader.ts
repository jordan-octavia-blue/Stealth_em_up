/**
 * Versioned `.jomap` loader (roadmap §6.3).
 *
 * Every map now carries a `version`. This loader takes the raw parsed JSON of a map file
 * and returns a normalized `MapData` at the current version, migrating older files on the
 * way. The current `bank_1.jomap` is a v1 file (it has no `version` field at all); it is
 * recognised by its shape and upgraded transparently, so nothing on disk has to change
 * for the game to keep loading it.
 *
 * Beyond versioning, v2 adds three optional fields the rest of Phase 5 (and the future map
 * editor, §8.3) reads: `tilesetRef` (which tileset the map's tile codes belong to),
 * `patrolRoutes` (named guard routes), and `hpOverrides` (per-cell starting hit points, so
 * a single wall can be made flimsier or tougher than its material's default).
 *
 * Pure: no fetch, no globals, no Pixi. The caller hands it a parsed object; it hands back
 * a validated one.
 */

import { type DoorSpec, normalizeDoorSpec } from './doors';

/** The current on-disk map format version this loader produces. */
export const CURRENT_MAP_VERSION = 2;

/** Objects placed on the map. Structural and permissive — the game reads these by name. */
export interface MapObjects {
  hero: [number, number];
  guards?: Array<[number, number]>;
  [key: string]: unknown;
}

/** A named guard patrol route: an ordered list of `[x, y]` waypoints in world pixels. */
export interface PatrolRoute {
  name: string;
  points: Array<[number, number]>;
}

/** A fully-loaded, current-version map. */
export interface MapData {
  version: number;
  width: number;
  height: number;
  /** Row-major tile codes, `width * height` of them. */
  data: number[];
  objects: MapObjects;
  /** Path to the tileset the tile codes are keyed against. */
  tilesetRef: string;
  /** Optional named patrol routes (consumed by Phase 6 AI). */
  patrolRoutes: PatrolRoute[];
  /** Optional per-cell starting hp, keyed by flat cell index — overrides material defaults. */
  hpOverrides: Record<number, number>;
  /**
   * Optional per-door metadata (type, multi-cell group, hp/lockpick overrides), keyed by the
   * door cell's flat index. A door cell (tile code 5/6) with no entry defaults to `locked`.
   */
  doorTypes: Record<number, DoorSpec>;
}

/** The default tileset a v1 map (which predates `tilesetRef`) is assumed to use. */
const DEFAULT_TILESET_REF = 'data/tileset.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalize a parsed map object to the current version.
 *
 * A file with no `version` is treated as v1 (the original format: `data`, `width`,
 * `height`, `objects`) and migrated. A file already at `CURRENT_MAP_VERSION` is validated
 * and passed through. Anything in between is migrated step by step; anything newer than
 * this loader understands is an error rather than a silent guess.
 */
export function loadMap(raw: unknown): MapData {
  if (!isRecord(raw)) throw new Error('Map is not an object');

  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version > CURRENT_MAP_VERSION) {
    throw new Error(
      `Map version ${version} is newer than this build supports (max ${CURRENT_MAP_VERSION})`,
    );
  }

  const width = raw.width;
  const height = raw.height;
  const data = raw.data;
  const objects = raw.objects;
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('Map is missing numeric width/height');
  }
  if (!Array.isArray(data)) throw new Error('Map is missing its tile data array');
  if (data.length !== width * height) {
    throw new Error(`Map data length ${data.length} does not match ${width}x${height}`);
  }
  if (!isRecord(objects) || !Array.isArray((objects as MapObjects).hero)) {
    throw new Error('Map is missing its objects.hero spawn');
  }

  return {
    version: CURRENT_MAP_VERSION,
    width,
    height,
    data: data as number[],
    objects: objects as MapObjects,
    // v1 had no tilesetRef; assume the default. v2+ may override it.
    tilesetRef: typeof raw.tilesetRef === 'string' ? raw.tilesetRef : DEFAULT_TILESET_REF,
    patrolRoutes: normalizePatrolRoutes(raw.patrolRoutes),
    hpOverrides: normalizeHpOverrides(raw.hpOverrides),
    doorTypes: normalizeDoorTypes(raw.doorTypes),
  };
}

function normalizePatrolRoutes(value: unknown): PatrolRoute[] {
  if (!Array.isArray(value)) return [];
  const routes: PatrolRoute[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !Array.isArray(entry.points)) continue;
    routes.push({
      name: typeof entry.name === 'string' ? entry.name : `route_${routes.length}`,
      points: entry.points as Array<[number, number]>,
    });
  }
  return routes;
}

function normalizeHpOverrides(value: unknown): Record<number, number> {
  if (!isRecord(value)) return {};
  const out: Record<number, number> = {};
  for (const [key, hp] of Object.entries(value)) {
    const index = Number(key);
    if (Number.isInteger(index) && typeof hp === 'number') out[index] = hp;
  }
  return out;
}

function normalizeDoorTypes(value: unknown): Record<number, DoorSpec> {
  if (!isRecord(value)) return {};
  const out: Record<number, DoorSpec> = {};
  for (const [key, raw] of Object.entries(value)) {
    const index = Number(key);
    if (!Number.isInteger(index)) continue;
    const spec = normalizeDoorSpec(raw);
    if (spec) out[index] = spec;
  }
  return out;
}
