import { describe, expect, it } from 'vitest';
import {
  BASE_LOCKPICK_MS,
  DOOR_TYPE_DEFAULTS,
  DOOR_TYPES,
  doorHp,
  doorLockpickMs,
  doorMaterial,
  isDoorType,
  normalizeDoorSpec,
} from '../../src/map/doors';

describe('door types', () => {
  it('lists the four door types', () => {
    expect(DOOR_TYPES).toEqual(['unlocked', 'locked', 'reinforced', 'vault']);
  });

  it('has a default for every type', () => {
    for (const type of DOOR_TYPES) {
      expect(DOOR_TYPE_DEFAULTS[type]).toBeDefined();
    }
  });

  it('makes the vault steel (indestructible) and three cells wide', () => {
    expect(DOOR_TYPE_DEFAULTS.vault.material).toBe('steel');
    expect(DOOR_TYPE_DEFAULTS.vault.width).toBe(3);
  });

  it('starts only the unlocked door open', () => {
    expect(DOOR_TYPE_DEFAULTS.unlocked.startsUnlocked).toBe(true);
    expect(DOOR_TYPE_DEFAULTS.locked.startsUnlocked).toBe(false);
    expect(DOOR_TYPE_DEFAULTS.reinforced.startsUnlocked).toBe(false);
    expect(DOOR_TYPE_DEFAULTS.vault.startsUnlocked).toBe(false);
  });

  it('escalates lockpick time from locked to reinforced to vault', () => {
    // locked uses the hero default (0 sentinel); the tough doors pin absolute, longer times.
    expect(doorLockpickMs({ type: 'locked' })).toBe(0);
    expect(doorLockpickMs({ type: 'reinforced' })).toBeGreaterThan(BASE_LOCKPICK_MS);
    expect(doorLockpickMs({ type: 'vault' })).toBeGreaterThan(
      doorLockpickMs({ type: 'reinforced' }),
    );
  });
});

describe('doorHp / doorLockpickMs / doorMaterial', () => {
  it('honours a per-door hp override, else the type default', () => {
    expect(doorHp({ type: 'locked' })).toBe(DOOR_TYPE_DEFAULTS.locked.hp);
    expect(doorHp({ type: 'locked', hp: 7 })).toBe(7);
  });

  it('honours a per-door lockpick override, else the type default', () => {
    expect(doorLockpickMs({ type: 'vault' })).toBe(DOOR_TYPE_DEFAULTS.vault.lockpickMs);
    expect(doorLockpickMs({ type: 'vault', lockpickMs: 123 })).toBe(123);
  });

  it('reports vault as steel and the rest as brick', () => {
    expect(doorMaterial('vault')).toBe('steel');
    expect(doorMaterial('locked')).toBe('brick');
    expect(doorMaterial('reinforced')).toBe('brick');
    expect(doorMaterial('unlocked')).toBe('brick');
  });
});

describe('isDoorType', () => {
  it('accepts the four types and rejects anything else', () => {
    expect(isDoorType('vault')).toBe(true);
    expect(isDoorType('locked')).toBe(true);
    expect(isDoorType('skeleton')).toBe(false);
    expect(isDoorType(5)).toBe(false);
    expect(isDoorType(undefined)).toBe(false);
  });
});

describe('normalizeDoorSpec', () => {
  it('keeps a valid type plus optional group/hp/lockpickMs', () => {
    expect(normalizeDoorSpec({ type: 'vault', group: 42, hp: 999, lockpickMs: 30000 })).toEqual({
      type: 'vault',
      group: 42,
      hp: 999,
      lockpickMs: 30000,
    });
  });

  it('drops unknown fields and keeps just the type when nothing else is valid', () => {
    expect(normalizeDoorSpec({ type: 'locked', color: 'red', group: 1.5 })).toEqual({
      type: 'locked',
    });
  });

  it('rejects a spec with a bad or missing type', () => {
    expect(normalizeDoorSpec({ type: 'nope' })).toBeNull();
    expect(normalizeDoorSpec({ group: 1 })).toBeNull();
    expect(normalizeDoorSpec(null)).toBeNull();
    expect(normalizeDoorSpec('vault')).toBeNull();
  });

  it('rejects negative hp / lockpick overrides but keeps the type', () => {
    expect(normalizeDoorSpec({ type: 'locked', hp: -5, lockpickMs: -1 })).toEqual({
      type: 'locked',
    });
  });
});
