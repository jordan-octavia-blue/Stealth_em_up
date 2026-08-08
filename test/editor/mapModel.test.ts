import { describe, expect, it } from 'vitest';
import type { MapData } from '../../src/map/loader';
import {
  CELL,
  EditError,
  TILE,
  cellCenterPx,
  cellOf,
  contractMap,
  createEmptyMap,
  deserialize,
  expandMap,
  flatIndex,
  serialize,
  setDoor,
  setTile,
  stampVaultDoor,
  validateComplete,
} from '../../src/editor/mapModel';

function heroXY(map: MapData): [number, number] {
  return map.objects.hero as [number, number];
}

describe('createEmptyMap', () => {
  it('has the requested size and a wall border around a floor interior', () => {
    const m = createEmptyMap(8, 6);
    expect(m.width).toBe(8);
    expect(m.height).toBe(6);
    expect(m.data.length).toBe(48);
    // corners + edges are wall
    expect(m.data[flatIndex(8, 0, 0)]).toBe(TILE.wall);
    expect(m.data[flatIndex(8, 7, 5)]).toBe(TILE.wall);
    expect(m.data[flatIndex(8, 3, 0)]).toBe(TILE.wall);
    // an interior cell is floor
    expect(m.data[flatIndex(8, 3, 3)]).toBe(TILE.floor);
  });

  it('is immediately complete (all required objects present and in bounds)', () => {
    expect(validateComplete(createEmptyMap()).ok).toBe(true);
  });

  it('round-trips through serialize → loadMap unchanged', () => {
    const m = createEmptyMap(10, 8);
    const back = deserialize(serialize(m));
    expect(back.width).toBe(10);
    expect(back.height).toBe(8);
    expect(back.data).toEqual(m.data);
    expect(back.objects.hero).toEqual(m.objects.hero);
  });
});

describe('setTile', () => {
  it('paints an interior cell', () => {
    const m = createEmptyMap(8, 8);
    setTile(m, 3, 3, TILE.desk);
    expect(m.data[flatIndex(8, 3, 3)]).toBe(TILE.desk);
  });

  it('refuses to paint the indestructible border', () => {
    const m = createEmptyMap(8, 8);
    setTile(m, 0, 3, TILE.floor);
    expect(m.data[flatIndex(8, 0, 3)]).toBe(TILE.wall);
  });

  it('clears a door type when the cell is painted to a non-door', () => {
    const m = createEmptyMap(8, 8);
    setDoor(m, 3, 3, 'vertical', 'locked');
    expect(m.doorTypes[flatIndex(8, 3, 3)]).toBeDefined();
    setTile(m, 3, 3, TILE.floor);
    expect(m.doorTypes[flatIndex(8, 3, 3)]).toBeUndefined();
  });
});

describe('doors', () => {
  it('setDoor writes the oriented tile code + a door type', () => {
    const m = createEmptyMap(8, 8);
    setDoor(m, 2, 4, 'horizontal', 'reinforced');
    expect(m.data[flatIndex(8, 2, 4)]).toBe(TILE.doorHorizontal);
    expect(m.doorTypes[flatIndex(8, 2, 4)]).toEqual({ type: 'reinforced' });
  });

  it('stampVaultDoor lays 3 grouped cells running east', () => {
    const m = createEmptyMap(10, 8);
    const warnings = stampVaultDoor(m, 3, 4, 'horizontal');
    expect(warnings).toEqual([]);
    const anchor = flatIndex(10, 3, 4);
    for (let i = 0; i < 3; i++) {
      const idx = flatIndex(10, 3 + i, 4);
      expect(m.data[idx]).toBe(TILE.doorHorizontal);
      expect(m.doorTypes[idx]).toEqual({ type: 'vault', group: anchor });
    }
  });

  it('stampVaultDoor refuses a run that would hit the border', () => {
    const m = createEmptyMap(6, 6); // interior x runs 1..4; a 3-wide run from x=4 overflows
    const warnings = stampVaultDoor(m, 4, 2, 'horizontal');
    expect(warnings.length).toBe(1);
  });
});

describe('expandMap — E/S leave the origin put', () => {
  it('E grows width, keeps objects and existing tiles, adds a wall column', () => {
    const m = createEmptyMap(8, 8);
    setTile(m, 3, 3, TILE.desk);
    const before = heroXY(m);
    const { map } = expandMap(m, 'E');
    expect(map.width).toBe(9);
    expect(map.data.length).toBe(9 * 8);
    expect(heroXY(map)).toEqual(before); // origin unchanged
    expect(map.data[flatIndex(9, 3, 3)]).toBe(TILE.desk); // tile stayed at same coords
    expect(map.data[flatIndex(9, 8, 4)]).toBe(TILE.wall); // new column is wall
  });

  it('S grows height without shifting objects or re-indexing existing cells', () => {
    const m = createEmptyMap(8, 8);
    m.hpOverrides[flatIndex(8, 3, 3)] = 99;
    const before = heroXY(m);
    const { map } = expandMap(m, 'S');
    expect(map.height).toBe(9);
    expect(map.data.length).toBe(8 * 9);
    expect(heroXY(map)).toEqual(before);
    expect(map.hpOverrides[flatIndex(8, 3, 3)]).toBe(99); // index unchanged
  });
});

describe('expandMap — N/W shift the origin', () => {
  it('W grows width, shifts every object +64px, and re-indexes dicts', () => {
    const m = createEmptyMap(8, 8);
    m.hpOverrides[flatIndex(8, 3, 3)] = 99;
    setDoor(m, 2, 5, 'vertical', 'locked');
    const [hx, hy] = heroXY(m);
    const { map } = expandMap(m, 'W');
    expect(map.width).toBe(9);
    expect(heroXY(map)).toEqual([hx + CELL, hy]); // shifted right one cell
    // (3,3) → (4,3)
    expect(map.hpOverrides[flatIndex(9, 4, 3)]).toBe(99);
    expect(map.hpOverrides[flatIndex(8, 3, 3)]).toBeUndefined();
    // door (2,5) → (3,5)
    expect(map.doorTypes[flatIndex(9, 3, 5)]).toEqual({ type: 'locked' });
  });

  it('N grows height, shifts every object +64px on y, and re-indexes dicts', () => {
    const m = createEmptyMap(8, 8);
    m.hpOverrides[flatIndex(8, 3, 3)] = 42;
    const [hx, hy] = heroXY(m);
    const { map } = expandMap(m, 'N');
    expect(map.height).toBe(9);
    expect(heroXY(map)).toEqual([hx, hy + CELL]);
    expect(map.hpOverrides[flatIndex(8, 3, 4)]).toBe(42); // (3,3) → (3,4)
  });
});

describe('expandMap preserves a vault group', () => {
  it('keeps 3 grouped vault cells contiguous after a W grow', () => {
    const m = createEmptyMap(10, 8);
    stampVaultDoor(m, 3, 4, 'horizontal'); // cells (3,4)(4,4)(5,4)
    const { map, warnings } = expandMap(m, 'W');
    expect(warnings.filter((w) => w.includes('vault'))).toEqual([]);
    const anchor = flatIndex(11, 4, 4); // width is 11 now; (3,4)→(4,4)
    for (let i = 0; i < 3; i++) {
      const spec = map.doorTypes[flatIndex(11, 4 + i, 4)];
      expect(spec.type).toBe('vault');
      expect(spec.group).toBe(anchor);
    }
  });
});

describe('contractMap', () => {
  it('S removal that clips a vault run demotes the survivors to reinforced', () => {
    const m = createEmptyMap(6, 6); // interior 1..4
    stampVaultDoor(m, 2, 2, 'vertical'); // cells (2,2)(2,3)(2,4)
    const { map, warnings } = contractMap(m, 'S'); // new border at y=4 swallows (2,4)
    expect(map.height).toBe(5);
    expect(map.doorTypes[flatIndex(6, 2, 2)]).toEqual({ type: 'reinforced' });
    expect(map.doorTypes[flatIndex(6, 2, 3)]).toEqual({ type: 'reinforced' });
    expect(warnings.some((w) => w.toLowerCase().includes('vault'))).toBe(true);
  });

  it('refuses to remove an edge holding a required object', () => {
    const m = createEmptyMap(8, 8);
    // move the hero onto the east interior edge column (x = width-2)
    m.objects.hero = [cellCenterPx(6), cellCenterPx(3)];
    expect(() => contractMap(m, 'E')).not.toThrow(); // hero at x=6, deleted line x=7 → ok
    // now put it ON the deleted line
    m.objects.hero = [cellCenterPx(7), cellCenterPx(3)];
    expect(() => contractMap(m, 'E')).toThrow(EditError);
  });

  it('refuses to shrink below the minimum size', () => {
    const tiny: MapData = {
      version: 2,
      width: 3,
      height: 3,
      data: [1, 1, 1, 1, 2, 1, 1, 1, 1],
      objects: {
        hero: [cellCenterPx(1), cellCenterPx(1)],
        guards: [],
        guard_backup_spawn: [cellCenterPx(1), cellCenterPx(1)],
        security_cams: [],
        computer: [cellCenterPx(1), cellCenterPx(1)],
        van: [cellCenterPx(1), cellCenterPx(1)],
        loot: [cellCenterPx(1), cellCenterPx(1)],
      },
      tilesetRef: 'data/tileset.json',
      patrolRoutes: [],
      hpOverrides: {},
      doorTypes: {},
    };
    expect(() => contractMap(tiny, 'E')).toThrow(/smaller/);
  });
});

describe('validateComplete', () => {
  it('reports each missing required object', () => {
    const m = createEmptyMap(8, 8);
    delete (m.objects as Record<string, unknown>).van;
    const result = validateComplete(m);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('van');
  });
});

describe('coordinate helpers', () => {
  it('map pixels to cells and back to cell centres', () => {
    expect(cellOf(0)).toBe(0);
    expect(cellOf(63)).toBe(0);
    expect(cellOf(64)).toBe(1);
    expect(cellCenterPx(2)).toBe(2 * CELL + CELL / 2);
  });
});
