import { describe, expect, it } from 'vitest';
import { WEAPON_IDS, isWeaponId, normalizeGuardEntry } from '../../src/map/guards';

describe('weapon ids', () => {
  it('exposes the guns from data/weapons.json', () => {
    expect(WEAPON_IDS).toContain('pistol');
    expect(WEAPON_IDS).toContain('pistol_silenced');
    expect(WEAPON_IDS).toContain('shotgun');
    expect(WEAPON_IDS).toContain('shotgun_sawed_off');
    expect(WEAPON_IDS).toContain('machine_gun');
  });

  it('validates weapon ids', () => {
    expect(isWeaponId('machine_gun')).toBe(true);
    expect(isWeaponId('rocket_launcher')).toBe(false);
    expect(isWeaponId(undefined)).toBe(false);
  });
});

describe('normalizeGuardEntry — legacy tuple', () => {
  it('reads position and randomizes loadout, wanders randomly', () => {
    const g = normalizeGuardEntry([320, 640]);
    expect(g.pos).toEqual([320, 640]);
    expect(g.weapon).toBeUndefined();
    expect(g.riotShield).toBeUndefined();
    expect(g.behavior).toEqual({ kind: 'random' });
    expect(g.isBankManager).toBe(false);
  });
});

describe('normalizeGuardEntry — object form', () => {
  it('carries an explicit weapon, shield, behaviour and bank-manager flag', () => {
    const g = normalizeGuardEntry({
      pos: [128, 256],
      weapon: 'pistol_silenced',
      riotShield: true,
      behavior: { kind: 'route', route: 'lobby' },
      isBankManager: true,
    });
    expect(g.pos).toEqual([128, 256]);
    expect(g.weapon).toBe('pistol_silenced');
    expect(g.riotShield).toBe(true);
    expect(g.behavior).toEqual({ kind: 'route', route: 'lobby' });
    expect(g.isBankManager).toBe(true);
  });

  it('treats an unknown weapon as "randomize"', () => {
    const g = normalizeGuardEntry({ pos: [0, 0], weapon: 'bazooka' as never });
    expect(g.weapon).toBeUndefined();
  });

  it('treats a non-boolean riot shield as "randomize"', () => {
    const g = normalizeGuardEntry({ pos: [0, 0], riotShield: 'yes' as never });
    expect(g.riotShield).toBeUndefined();
  });

  it('defaults behaviour to random and only trusts isBankManager === true', () => {
    expect(normalizeGuardEntry({ pos: [0, 0] }).behavior).toEqual({ kind: 'random' });
    expect(normalizeGuardEntry({ pos: [0, 0], behavior: { kind: 'stay' } }).behavior).toEqual({
      kind: 'stay',
    });
    // a route behaviour missing its route name falls back to random
    expect(
      normalizeGuardEntry({ pos: [0, 0], behavior: { kind: 'route' } as never }).behavior,
    ).toEqual({ kind: 'random' });
    expect(normalizeGuardEntry({ pos: [0, 0], isBankManager: 1 as never }).isBankManager).toBe(
      false,
    );
  });
});
