/**
 * Data-driven weapon + throwable table (roadmap §8.2, Phase 8).
 *
 * One table, loaded from `data/weapons.json`, describes both the guns and the three
 * throwables. Before this, guns were hard-coded `new jo_gun(...)` calls with no damage
 * stat at all (kills were implicitly one-shot); the grenades did not exist. Moving the
 * numbers into JSON is what lets `jo_gun` and the grenade system read the same stats and
 * a designer tune them without touching code.
 *
 * A note on `damage`: guards still die in one shot (Phase 6a's hitpoint/`takeDamage`
 * model was deliberately skipped), so `damage` is carried as data — it is *not* yet
 * subtracted from a hp pool. It exists so the health model, if it is ever added, has a
 * number to read, and so the frag grenade and the guns describe their lethality the same
 * way. `loudness` is a 0-10 hint used the same way.
 *
 * Pure data + typed lookups: no Pixi, no globals, no physics — safe to import anywhere,
 * including headless tests.
 */

import weaponsData from '../../data/weapons.json';

/** A gun's stats as stored in `data/weapons.json` under `guns`. */
export interface GunDef {
  id: string;
  name: string;
  /** Nominal damage. Carried as data; kills are still one-shot (see file header). */
  damage: number;
  /** 0-10 hint for how alarming firing it is. Silenced guns are low. */
  loudness: number;
  clip: number;
  silenced: boolean;
  automatic: boolean;
  bulletsPerShot: number;
  spread: number;
}

/** Which detonation behaviours a throwable runs. */
export type ThrowableEffect = 'damage' | 'breach' | 'loud' | 'vision_block' | 'blind';

/** A grenade's stats as stored in `data/weapons.json` under `throwables`. */
export interface ThrowableDef {
  id: string;
  name: string;
  damage: number;
  loudness: number;
  /** Delay from the grenade landing to its effect firing, in ms. */
  fuseMs: number;
  /** Effect radius in pixels. */
  radius: number;
  /** Smoke only: how long the cloud lingers, in ms. */
  durationMs?: number;
  /** Flash only: how long caught guards/cameras stay blind, in ms. */
  blindMs?: number;
  effects: ThrowableEffect[];
}

const GUNS: readonly GunDef[] = (weaponsData.guns as GunDef[]) ?? [];
const THROWABLES: readonly ThrowableDef[] = (weaponsData.throwables as ThrowableDef[]) ?? [];

const GUNS_BY_ID = new Map<string, GunDef>(GUNS.map((g) => [g.id, g]));
const THROWABLES_BY_ID = new Map<string, ThrowableDef>(THROWABLES.map((t) => [t.id, t]));

export function allGuns(): readonly GunDef[] {
  return GUNS;
}

export function allThrowables(): readonly ThrowableDef[] {
  return THROWABLES;
}

/** A gun's stats by id, or undefined if the table has no such id. */
export function gunDef(id: string): GunDef | undefined {
  return GUNS_BY_ID.get(id);
}

/** A throwable's stats by id, or undefined if the table has no such id. */
export function throwableDef(id: string): ThrowableDef | undefined {
  return THROWABLES_BY_ID.get(id);
}
