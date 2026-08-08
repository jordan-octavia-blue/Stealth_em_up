import { describe, expect, it } from 'vitest';
import { allGuns, allThrowables, gunDef, throwableDef } from '../../src/systems/weapons';

describe('weapons table (data/weapons.json)', () => {
  it('loads the migrated guns with damage + loudness stats', () => {
    const guns = allGuns();
    expect(guns.length).toBeGreaterThan(0);
    const pistol = gunDef('pistol');
    expect(pistol).toBeDefined();
    expect(pistol!.damage).toBeGreaterThan(0);
    // A silenced gun is quieter than an unsilenced one — the point of the loudness stat.
    expect(gunDef('pistol_silenced')!.loudness).toBeLessThan(gunDef('pistol')!.loudness);
  });

  it('exposes the three throwables with the fields the grenade system reads', () => {
    const ids = allThrowables().map((t) => t.id).sort();
    expect(ids).toEqual(['flash', 'frag', 'smoke']);

    const frag = throwableDef('frag')!;
    expect(frag.effects).toContain('damage');
    expect(frag.effects).toContain('breach');
    expect(frag.radius).toBeGreaterThan(0);
    expect(frag.fuseMs).toBeGreaterThan(0);

    expect(throwableDef('smoke')!.effects).toContain('vision_block');
    expect(throwableDef('smoke')!.durationMs).toBeGreaterThan(0);

    expect(throwableDef('flash')!.effects).toContain('blind');
    expect(throwableDef('flash')!.blindMs).toBeGreaterThan(0);
  });

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(gunDef('nope')).toBeUndefined();
    expect(throwableDef('nope')).toBeUndefined();
  });
});
