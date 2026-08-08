/**
 * Per-guard configuration (Phase 10 — map editor).
 *
 * Before this, every guard was spawned identically: a random gun (from `jo_sprite`) and a
 * coin-flip riot shield (in `main.ts`), always patrolling by random wander. A map maker
 * could only choose *where* a guard stood, never *what* it carried or *how* it moved.
 *
 * The editor now writes richer guard entries in the map's `objects.guards` list. Because
 * `objects` is passed through the loader untyped, no loader change is needed — a guard entry
 * may be either the legacy `[x, y]` tuple (meaning "randomize the loadout, wander randomly",
 * so old maps are unchanged) or an object carrying an explicit weapon, riot shield, patrol
 * behaviour, and a "bank manager" flag (the guard who carries the vault key).
 *
 * This module is pure and shared by the editor and the game (`main.ts` reads it when
 * spawning guards). `normalizeGuardEntry` collapses the two shapes into one.
 */

import weaponsData from '../../data/weapons.json';

/** A weapon id from `data/weapons.json`'s gun table. */
export type WeaponId =
  | 'shotgun'
  | 'shotgun_sawed_off'
  | 'pistol'
  | 'pistol_silenced'
  | 'machine_gun';

/**
 * Every gun id available to place, taken straight from `data/weapons.json` so the editor's
 * weapon dropdown can never offer a gun the game doesn't have (an unknown id falls back to a
 * random gun at spawn anyway).
 */
export const WEAPON_IDS: readonly string[] = weaponsData.guns.map((g) => g.id);

/** True if `value` is a gun id the game knows about. */
export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && WEAPON_IDS.includes(value);
}

/**
 * How a guard moves while unalarmed.
 *  - `random` — wander to random reachable spots near its post (the original behaviour).
 *  - `stay`   — hold its post and don't patrol (it still reacts and gives chase when it sees
 *               something — behaviour governs patrol, not combat).
 *  - `route`  — walk a named patrol route (an ordered waypoint loop authored in the map's
 *               `patrolRoutes`).
 */
export type GuardBehavior =
  | { kind: 'random' }
  | { kind: 'stay' }
  | { kind: 'route'; route: string };

/** The three behaviour kinds, for the editor's behaviour picker. */
export const GUARD_BEHAVIOR_KINDS = ['random', 'stay', 'route'] as const;

/**
 * A guard as stored in `objects.guards`: either the legacy position-only tuple or the full
 * object form.
 */
export type GuardEntry =
  | [number, number]
  | {
      pos: [number, number];
      /** Explicit gun id; omit to randomize (legacy behaviour). */
      weapon?: WeaponId;
      /** Explicit riot shield; omit to randomize (legacy behaviour). */
      riotShield?: boolean;
      /** Patrol behaviour; omit for random wander. */
      behavior?: GuardBehavior;
      /** True for the one guard who carries the vault key. */
      isBankManager?: boolean;
    };

/** A guard entry after normalization — one shape the spawn code can consume directly. */
export interface NormalizedGuard {
  pos: [number, number];
  /** `undefined` means "randomize at spawn" (preserves the old variety for legacy maps). */
  weapon?: WeaponId;
  /** `undefined` means "randomize at spawn". */
  riotShield?: boolean;
  behavior: GuardBehavior;
  isBankManager: boolean;
}

function readPos(entry: unknown): [number, number] {
  const arr = Array.isArray(entry)
    ? entry
    : typeof entry === 'object' && entry !== null && Array.isArray((entry as { pos?: unknown }).pos)
      ? (entry as { pos: unknown[] }).pos
      : null;
  if (arr && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
    return [arr[0], arr[1]];
  }
  return [0, 0];
}

function readBehavior(raw: unknown): GuardBehavior {
  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    if (rec.kind === 'stay') return { kind: 'stay' };
    if (rec.kind === 'route' && typeof rec.route === 'string') {
      return { kind: 'route', route: rec.route };
    }
  }
  return { kind: 'random' };
}

/**
 * Collapse a raw guard entry (legacy tuple or object form) into a `NormalizedGuard`.
 *
 * A tuple normalizes to "randomize loadout, wander randomly, not the bank manager". In the
 * object form, an unknown/absent `weapon` or a non-boolean `riotShield` normalizes to
 * `undefined` — the sentinel the spawn code reads as "randomize this one", so a partially
 * specified guard still spawns sensibly.
 */
export function normalizeGuardEntry(entry: GuardEntry | unknown): NormalizedGuard {
  const pos = readPos(entry);
  if (Array.isArray(entry)) {
    return { pos, behavior: { kind: 'random' }, isBankManager: false };
  }
  const rec = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
  return {
    pos,
    weapon: isWeaponId(rec.weapon) ? rec.weapon : undefined,
    riotShield: typeof rec.riotShield === 'boolean' ? rec.riotShield : undefined,
    behavior: readBehavior(rec.behavior),
    isBankManager: rec.isBankManager === true,
  };
}
