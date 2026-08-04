import { describe, expect, it } from 'vitest';
import { CURRENT_MAP_VERSION, loadMap } from '../../src/map/loader';

/** A minimal v1 map: the original format, with no `version` field. */
function v1Map(overrides: Record<string, unknown> = {}) {
  return {
    width: 2,
    height: 2,
    data: [1, 1, 1, 1],
    objects: { hero: [64, 64] },
    ...overrides,
  };
}

describe('loadMap — v1 migration', () => {
  it('upgrades a versionless v1 map to the current version', () => {
    const map = loadMap(v1Map());
    expect(map.version).toBe(CURRENT_MAP_VERSION);
  });

  it('preserves the tile data, size and objects untouched', () => {
    const map = loadMap(v1Map());
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.data).toEqual([1, 1, 1, 1]);
    expect(map.objects.hero).toEqual([64, 64]);
  });

  it('fills in the v2 defaults a v1 map lacks', () => {
    const map = loadMap(v1Map());
    expect(map.tilesetRef).toBe('data/tileset.json');
    expect(map.patrolRoutes).toEqual([]);
    expect(map.hpOverrides).toEqual({});
  });
});

describe('loadMap — v2 fields', () => {
  it('keeps an explicit tilesetRef', () => {
    const map = loadMap(v1Map({ version: 2, tilesetRef: 'data/other.json' }));
    expect(map.tilesetRef).toBe('data/other.json');
  });

  it('normalizes patrol routes and names unnamed ones', () => {
    const map = loadMap(
      v1Map({
        version: 2,
        patrolRoutes: [{ points: [[0, 0], [64, 0]] }, { name: 'lobby', points: [[1, 1]] }],
      }),
    );
    expect(map.patrolRoutes).toHaveLength(2);
    expect(map.patrolRoutes[0].name).toBe('route_0');
    expect(map.patrolRoutes[1].name).toBe('lobby');
  });

  it('keeps per-cell hp overrides keyed by cell index', () => {
    const map = loadMap(v1Map({ version: 2, hpOverrides: { '3': 5 } }));
    expect(map.hpOverrides[3]).toBe(5);
  });
});

describe('loadMap — validation', () => {
  it('rejects a map whose data length does not match its size', () => {
    expect(() => loadMap(v1Map({ data: [1, 1, 1] }))).toThrow(/does not match/);
  });

  it('rejects a map with no hero spawn', () => {
    expect(() => loadMap(v1Map({ objects: {} }))).toThrow(/hero/);
  });

  it('refuses a map newer than this build understands', () => {
    expect(() => loadMap(v1Map({ version: CURRENT_MAP_VERSION + 1 }))).toThrow(/newer/);
  });

  it('rejects non-object input', () => {
    expect(() => loadMap(null)).toThrow();
    expect(() => loadMap('not a map')).toThrow();
  });
});
