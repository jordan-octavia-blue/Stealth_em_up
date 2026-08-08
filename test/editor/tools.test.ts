import { describe, expect, it } from 'vitest';
import type { MapData } from '../../src/map/loader';
import { CELL, TILE, cellCenterPx, createEmptyMap, flatIndex, setTile } from '../../src/editor/mapModel';
import {
  addCamera,
  addGuard,
  applyTileTool,
  deleteSelection,
  guardObject,
  hitTestObject,
  pickDoorOrientation,
  snapToCell,
  snapToCorner,
  updateGuard,
} from '../../src/editor/tools';

function blankMap(w = 8, h = 8): MapData {
  const m = createEmptyMap(w, h);
  m.objects = {
    hero: [cellCenterPx(1), cellCenterPx(1)],
    guards: [],
    security_cams: [],
    guard_backup_spawn: [cellCenterPx(1), cellCenterPx(h - 2)],
    computer: [cellCenterPx(w - 2), cellCenterPx(1)],
    van: [cellCenterPx(w - 2), cellCenterPx(h - 2)],
    loot: [cellCenterPx(3), cellCenterPx(3)],
  };
  m.patrolRoutes = [];
  return m;
}

describe('pickDoorOrientation', () => {
  it('reads a horizontal wall run as a horizontal door', () => {
    const m = blankMap();
    setTile(m, 2, 3, TILE.wall);
    setTile(m, 4, 3, TILE.wall);
    expect(pickDoorOrientation(m, 3, 3)).toBe('horizontal');
  });

  it('reads a vertical wall run as a vertical door', () => {
    const m = blankMap();
    setTile(m, 3, 2, TILE.wall);
    setTile(m, 3, 4, TILE.wall);
    expect(pickDoorOrientation(m, 3, 3)).toBe('vertical');
  });
});

describe('applyTileTool', () => {
  it('paints a plain tile', () => {
    const m = blankMap();
    applyTileTool(m, { kind: 'tile', code: TILE.desk }, 3, 3);
    expect(m.data[flatIndex(m.width, 3, 3)]).toBe(TILE.desk);
  });

  it('paints a door with its type recorded', () => {
    const m = blankMap();
    const warnings = applyTileTool(m, { kind: 'door', door: 'reinforced' }, 3, 3);
    expect(warnings).toEqual([]);
    expect(m.doorTypes[flatIndex(m.width, 3, 3)]).toEqual({ type: 'reinforced' });
  });

  it('warns when a vault door will not fit', () => {
    const m = blankMap(6, 6); // interior 1..4; a 3-cell run from (4,4) overflows the border
    const warnings = applyTileTool(m, { kind: 'vault' }, 4, 4);
    expect(warnings.length).toBe(1);
  });
});

describe('guards + cameras', () => {
  it('adds a guard in the editable object form', () => {
    const m = blankMap();
    const i = addGuard(m, cellCenterPx(4), cellCenterPx(4));
    expect(guardObject(m, i)).toEqual({ pos: [cellCenterPx(4), cellCenterPx(4)] });
  });

  it('upgrades a legacy tuple guard to an object when edited', () => {
    const m = blankMap();
    (m.objects.guards as unknown[]) = [[100, 200]];
    updateGuard(m, 0, { weapon: 'pistol_silenced' });
    expect((m.objects.guards as unknown[])[0]).toEqual({ pos: [100, 200], weapon: 'pistol_silenced' });
  });

  it('adds a camera with a default sweep', () => {
    const m = blankMap();
    const i = addCamera(m, cellCenterPx(2), cellCenterPx(2));
    const cam = (m.objects.security_cams as Array<{ swivel_min: number; swivel_max: number }>)[i];
    expect(cam.swivel_min).toBe(0);
    expect(cam.swivel_max).toBeCloseTo(Math.PI);
  });
});

describe('hitTestObject', () => {
  it('finds a guard under the cursor and nothing on empty floor', () => {
    const m = blankMap();
    addGuard(m, cellCenterPx(4), cellCenterPx(4));
    expect(hitTestObject(m, cellCenterPx(4), cellCenterPx(4))).toEqual({ type: 'guard', index: 0 });
    expect(hitTestObject(m, 5, 5)).toBeNull();
  });

  it('finds a required point spawn', () => {
    const m = blankMap();
    expect(hitTestObject(m, cellCenterPx(1), cellCenterPx(1))).toEqual({ type: 'point', key: 'hero' });
  });
});

describe('deleteSelection', () => {
  it('removes a guard but refuses to remove a required spawn', () => {
    const m = blankMap();
    addGuard(m, cellCenterPx(4), cellCenterPx(4));
    expect(deleteSelection(m, { type: 'guard', index: 0 })).toBe(true);
    expect((m.objects.guards as unknown[]).length).toBe(0);
    expect(deleteSelection(m, { type: 'point', key: 'hero' })).toBe(false);
    expect(m.objects.hero).toBeDefined();
  });
});

describe('snapToCell', () => {
  it('snaps a pixel to the centre of its cell', () => {
    expect(snapToCell(100, 200)).toEqual([cellCenterPx(1), cellCenterPx(3)]);
  });
});

describe('snapToCorner', () => {
  it('snaps a pixel to the nearest cell corner (grid intersection)', () => {
    // 100 → 128 (2 cells), 200 → 192 (3 cells); cameras mount on corners
    expect(snapToCorner(100, 200)).toEqual([2 * CELL, 3 * CELL]);
  });

  it('rounds to the closer corner on each axis', () => {
    expect(snapToCorner(20, 40)).toEqual([0, CELL]); // 20 → 0, 40 → 64
  });
});
