import { describe, expect, it } from 'vitest';
import { DAMAGE_AMOUNT, materialTakesDamage, tileDef } from '../../src/map/tileset';

describe('tileDef', () => {
  it('gives walls a material and hp from data/tileset.json', () => {
    const brick = tileDef(1);
    expect(brick).not.toBeNull();
    expect(brick?.material).toBe('brick');
    expect(brick?.hp).toBeGreaterThan(0);
  });

  it('treats furniture as weak drywall', () => {
    expect(tileDef(3)?.material).toBe('drywall');
  });

  it('returns null for a floor tile code (nothing to destroy)', () => {
    expect(tileDef(2)).toBeNull();
    expect(tileDef(4)).toBeNull();
  });
});

describe('materialTakesDamage — bullets are small and picky', () => {
  it('lets a bullet break drywall', () => {
    expect(materialTakesDamage('drywall', 'bullet')).toBe(true);
  });

  it('has a bullet bounce off brick and concrete', () => {
    expect(materialTakesDamage('brick', 'bullet')).toBe(false);
    expect(materialTakesDamage('concrete', 'bullet')).toBe(false);
  });
});

describe('materialTakesDamage — blasts and cars', () => {
  it('has the bomb level everything short of steel', () => {
    expect(materialTakesDamage('drywall', 'bomb')).toBe(true);
    expect(materialTakesDamage('brick', 'bomb')).toBe(true);
    expect(materialTakesDamage('concrete', 'bomb')).toBe(true);
    expect(materialTakesDamage('steel', 'bomb')).toBe(false);
  });

  it('treats a frag grenade exactly like the bomb', () => {
    for (const m of ['drywall', 'brick', 'concrete', 'steel'] as const) {
      expect(materialTakesDamage(m, 'frag')).toBe(materialTakesDamage(m, 'bomb'));
    }
  });

  it('has a car crash through light walls but stop against concrete', () => {
    expect(materialTakesDamage('drywall', 'car')).toBe(true);
    expect(materialTakesDamage('brick', 'car')).toBe(true);
    expect(materialTakesDamage('concrete', 'car')).toBe(false);
  });

  it('makes steel indestructible to every damage type', () => {
    for (const type of ['bullet', 'bomb', 'frag', 'car'] as const) {
      expect(materialTakesDamage('steel', type)).toBe(false);
    }
  });
});

describe('DAMAGE_AMOUNT', () => {
  it('makes a single bomb hit large enough to break any wall in one blast', () => {
    // The toughest wall in the tileset must fall to one bomb tick.
    const toughest = Math.max(tileDef(1)?.hp ?? 0, tileDef(3)?.hp ?? 0, tileDef(5)?.hp ?? 0);
    expect(DAMAGE_AMOUNT.bomb).toBeGreaterThanOrEqual(toughest);
  });

  it('makes a bullet chip away at drywall rather than one-shot it', () => {
    expect(DAMAGE_AMOUNT.bullet).toBeLessThan(tileDef(3)?.hp ?? 0);
  });
});

describe('doors are weak wood a shotgun can open', () => {
  it('gives the two door tile codes the wood material', () => {
    expect(tileDef(5)?.material).toBe('wood');
    expect(tileDef(6)?.material).toBe('wood');
  });

  it('makes a door significantly weaker than a brick wall', () => {
    expect(tileDef(5)?.hp ?? Infinity).toBeLessThan(tileDef(1)?.hp ?? 0);
  });

  it('lets gunfire splinter wood, unlike masonry', () => {
    expect(materialTakesDamage('wood', 'bullet')).toBe(true);
    expect(materialTakesDamage('brick', 'bullet')).toBe(false);
  });

  it('opens the door with a single near point-blank shotgun blast', () => {
    // gun_shotgun fires 8 pellets; near point-blank most connect. The door must fall to a
    // blast of only ~6 pellets so a close shot reliably breaches it.
    const doorHp = tileDef(5)?.hp ?? Infinity;
    const pelletsThatConnect = 6;
    expect(pelletsThatConnect * DAMAGE_AMOUNT.bullet).toBeGreaterThanOrEqual(doorHp);
  });
});

describe('glass walls: shootable, not walkable, breakable', () => {
  it('is a glass-material cell with hit points', () => {
    expect(tileDef(7)?.material).toBe('glass');
    expect(tileDef(7)?.hp ?? 0).toBeGreaterThan(0);
  });

  it('does not block vision (so it can be seen and shot through)', () => {
    expect(tileDef(7)?.blocksVision).toBe(false);
  });

  it('takes damage from every source short of being indestructible', () => {
    expect(materialTakesDamage('glass', 'bullet')).toBe(true);
    expect(materialTakesDamage('glass', 'bomb')).toBe(true);
    expect(materialTakesDamage('glass', 'frag')).toBe(true);
    expect(materialTakesDamage('glass', 'car')).toBe(true);
  });

  it('breaks into a plain floor (rubbleTile) once shattered', () => {
    // rubbleTile 2 is the white floor code the destroy pipeline swaps in.
    expect(tileDef(7)?.rubbleTile).toBe(2);
  });
});
