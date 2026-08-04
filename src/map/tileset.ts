/**
 * Tileset + material rules (roadmap §6.1).
 *
 * Two jobs, both pure and unit-testable:
 *
 *  1. Turn a map tile code (the numbers in a `.jomap`'s `data` array) into the
 *     `material` and `hp` a destructible cell needs. This table is the whole of the
 *     data-driven part of destruction — it lives in `data/tileset.json`, keyed by tile
 *     code, and is imported here so the game has it synchronously with no fetch.
 *  2. Decide, given a material and a *kind* of damage, whether that damage does anything
 *     at all — the rule that makes bullets chew drywall but bounce off brick, and makes
 *     steel and (via the caller) the map border indestructible.
 *
 * Nothing here touches the grid, Pixi, or the event bus. `grid.damageCell()` is the one
 * caller that turns these decisions into a destroyed cell.
 */

import tilesetData from '../../data/tileset.json';

/**
 * What a cell is made of. Walls and doors carry one of these; floors carry `null`
 * (nothing to damage). The four wall materials sit on a hardness ladder — drywall is the
 * only thing a bullet can break; steel is indestructible outright.
 */
export type TileMaterial = 'drywall' | 'brick' | 'concrete' | 'steel';

/** How a cell is being hit. Bullets are small and picky; the rest are heavy. */
export type DamageType = 'bullet' | 'bomb' | 'frag' | 'car';

/** One tile code's destruction data, as stored in `data/tileset.json`. */
export interface TileDef {
  material: TileMaterial;
  /** Starting hit points. `grid.damageCell` subtracts from this until it reaches 0. */
  hp: number;
  /** Whether the intact cell blocks vision (informational; the grid sets the live flag). */
  blocksVision: boolean;
  /** The tile code the cell shows once destroyed — a floor the breach leaves behind. */
  rubbleTile: number;
}

interface TilesetFile {
  version: number;
  tiles: Record<string, TileDef>;
}

const tileset = tilesetData as TilesetFile;

/**
 * The destruction data for a tile code, or `null` for codes with no entry — floors and
 * anything else that is not a solid, damageable cell.
 */
export function tileDef(tileCode: number): TileDef | null {
  return tileset.tiles[String(tileCode)] ?? null;
}

/**
 * Default damage a hit of each kind deals. Callers may pass their own amount (the car
 * scales it by impact impulse in Phase 7); these are the fixed values for bullets and the
 * bomb/grenade, tuned so one blast clears its whole radius and a bullet only slowly eats
 * drywall.
 */
export const DAMAGE_AMOUNT: Record<DamageType, number> = {
  bullet: 5,
  bomb: 500,
  frag: 500,
  car: 40,
};

/** Which materials each kind of damage can affect at all. Steel is in no list. */
const CAN_DAMAGE: Record<DamageType, ReadonlySet<TileMaterial>> = {
  // A stray bullet knocks holes in drywall (shootable cover) but does nothing to masonry.
  bullet: new Set<TileMaterial>(['drywall']),
  // A blast levels everything short of steel.
  bomb: new Set<TileMaterial>(['drywall', 'brick', 'concrete']),
  frag: new Set<TileMaterial>(['drywall', 'brick', 'concrete']),
  // A car crashes through light walls but stops dead against concrete.
  car: new Set<TileMaterial>(['drywall', 'brick']),
};

/**
 * True when `type` damage can hurt `material` at all. A `false` here means the hit is
 * simply absorbed — no hp is lost, so an indestructible wall never edges towards breaking.
 */
export function materialTakesDamage(material: TileMaterial, type: DamageType): boolean {
  return CAN_DAMAGE[type].has(material);
}
