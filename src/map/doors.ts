/**
 * Door types (Phase 10 — map editor).
 *
 * A door is still just a tile code in the map's `data` array (5 = vertical, 6 = horizontal).
 * What *kind* of door it is — how much punishment it takes and how long it takes to pick —
 * is carried alongside in the map's new top-level `doorTypes` field, keyed by the same flat
 * cell index the grid already iterates, exactly like `hpOverrides`. A door cell with no
 * `doorTypes` entry defaults to `locked`, which is the behaviour every door had before this
 * field existed, so old maps (e.g. `bank_1.jomap`) are unchanged.
 *
 * This module is the single source of truth shared by the editor (which writes `doorTypes`)
 * and the game (`src/legacy/jo_grid.ts`, which reads it when building door cells). It is
 * pure: no grid, no Pixi, no globals — just the type, its per-type defaults, and validation.
 */

import type { TileMaterial } from './tileset';

/**
 * The four door kinds a map maker can place.
 *
 *  - `unlocked`   — opens on approach; no lockpicking. Starts open.
 *  - `locked`     — the classic door: closed, lockpicked with Space (uses the hero's own
 *                   lockpick speed, so it behaves exactly as doors did before door types).
 *  - `reinforced` — tougher (more hit points) and slower to pick than a locked door.
 *  - `vault`      — made of steel (so it cannot be shot or bombed open, only picked or
 *                   opened with the bank manager's key), the slowest to pick, and three
 *                   cells wide (the three cells share a `group` so one pick opens all three).
 */
export type DoorType = 'unlocked' | 'locked' | 'reinforced' | 'vault';

/** Every valid door type, in palette order. */
export const DOOR_TYPES: readonly DoorType[] = ['unlocked', 'locked', 'reinforced', 'vault'];

/**
 * A door's metadata as stored on disk under `doorTypes[flatIndex]`.
 *
 * Only `type` is required. `group` links the cells of a multi-cell door (the 3-wide vault):
 * every cell of one door carries the same `group`, which is the flat index of the door's
 * anchor cell. `hp` / `lockpickMs` are optional per-door overrides of the type's defaults.
 */
export interface DoorSpec {
  type: DoorType;
  /** Anchor flat-index shared by every cell of a multi-cell door. Absent ⇒ the cell's own index. */
  group?: number;
  /** Optional starting-hp override; absent ⇒ `DOOR_TYPE_DEFAULTS[type].hp`. */
  hp?: number;
  /** Optional lockpick-time override (ms); absent ⇒ `DOOR_TYPE_DEFAULTS[type].lockpickMs`. */
  lockpickMs?: number;
}

/** The fixed traits of each door type. */
export interface DoorTypeDef {
  /** What the door cell is made of — drives what damage (if any) can breach it. */
  material: TileMaterial;
  /** Starting hit points for the door cell. */
  hp: number;
  /**
   * Time in ms to lockpick the door. `0` is a sentinel meaning "use the hero's own
   * `lockpick_speed`" — this keeps `unlocked`/`locked` doors following the hero exactly as
   * before, while `reinforced`/`vault` pin an absolute, deliberately-long time.
   */
  lockpickMs: number;
  /** True for a door that begins the level already unlocked and open. */
  startsUnlocked: boolean;
  /** How many cells wide the door is when the editor stamps it (vault is 3). */
  width: number;
}

/**
 * The hero's default lockpick channel length (ms), mirrored from `hero.lockpick_speed` in
 * `src/legacy/sprite_hero.ts`. Used here only as the reference the reinforced/vault
 * multipliers scale off, so the numbers below read as "2.5×"/"7× a normal door".
 */
export const BASE_LOCKPICK_MS = 5000;

/**
 * Per-type defaults. Tunable — these are gameplay values, not load-bearing constants.
 * `lockpickMs: 0` means "fall back to the hero's lockpick_speed" (see `DoorTypeDef`).
 */
export const DOOR_TYPE_DEFAULTS: Record<DoorType, DoorTypeDef> = {
  unlocked: { material: 'brick', hp: 40, lockpickMs: 0, startsUnlocked: true, width: 1 },
  locked: { material: 'brick', hp: 40, lockpickMs: 0, startsUnlocked: false, width: 1 },
  reinforced: {
    material: 'brick',
    hp: 90,
    lockpickMs: Math.round(BASE_LOCKPICK_MS * 2.5),
    startsUnlocked: false,
    width: 1,
  },
  vault: {
    material: 'steel',
    hp: 2000,
    lockpickMs: Math.round(BASE_LOCKPICK_MS * 7),
    startsUnlocked: false,
    width: 3,
  },
};

/** True if `value` is one of the four door types. */
export function isDoorType(value: unknown): value is DoorType {
  return typeof value === 'string' && (DOOR_TYPES as readonly string[]).includes(value);
}

/**
 * The effective hp for a door of `type`, honouring a per-door override.
 * Door hp comes from the door type, not from `hpOverrides` (both key by flat index; the
 * door type wins for door cells).
 */
export function doorHp(spec: DoorSpec): number {
  return spec.hp ?? DOOR_TYPE_DEFAULTS[spec.type].hp;
}

/**
 * The effective lockpick time (ms) for a door, honouring a per-door override. A returned
 * `0` still means "use the hero's lockpick_speed" — the caller (the lockpick channel in
 * `src/systems/input.ts`) resolves that with `door.lockpickMs || hero.lockpick_speed`.
 */
export function doorLockpickMs(spec: DoorSpec): number {
  return spec.lockpickMs ?? DOOR_TYPE_DEFAULTS[spec.type].lockpickMs;
}

/**
 * The material a door cell of `type` should carry. Vault is steel (indestructible by
 * gunfire/bombs); the rest are brick.
 */
export function doorMaterial(type: DoorType): TileMaterial {
  return DOOR_TYPE_DEFAULTS[type].material;
}

/**
 * Validate and normalize one raw `doorTypes` entry into a `DoorSpec`, or return `null` if it
 * is not a usable door spec. Used by the map loader (which cannot trust file contents) and
 * anywhere else that ingests untrusted door metadata.
 */
export function normalizeDoorSpec(raw: unknown): DoorSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (!isDoorType(rec.type)) return null;
  const spec: DoorSpec = { type: rec.type };
  if (typeof rec.group === 'number' && Number.isInteger(rec.group)) spec.group = rec.group;
  if (typeof rec.hp === 'number' && rec.hp >= 0) spec.hp = rec.hp;
  if (typeof rec.lockpickMs === 'number' && rec.lockpickMs >= 0) spec.lockpickMs = rec.lockpickMs;
  return spec;
}
