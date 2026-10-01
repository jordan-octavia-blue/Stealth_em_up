import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyMap } from '../../src/editor/mapModel';
import {
  PLAY_DRAFT_KEY,
  deleteNamed,
  listMaps,
  loadNamed,
  renameNamed,
  saveNamed,
  uniqueName,
  writePlayDraft,
} from '../../src/editor/persistence';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();
});

describe('named map library', () => {
  it('saves, lists and loads maps by name', () => {
    const m = createEmptyMap(6, 6);
    saveNamed('bank', m);
    expect(listMaps()).toEqual(['bank']);
    const back = loadNamed('bank');
    expect(back?.width).toBe(6);
    expect(loadNamed('missing')).toBeNull();
  });

  it('makes unique names to avoid clobbering', () => {
    saveNamed('heist', createEmptyMap());
    expect(uniqueName('heist')).toBe('heist-2');
    saveNamed('heist-2', createEmptyMap());
    expect(uniqueName('heist')).toBe('heist-3');
  });

  it('renames a map, refusing a clash', () => {
    saveNamed('a', createEmptyMap());
    saveNamed('b', createEmptyMap());
    expect(renameNamed('a', 'b')).toBe(false); // clash
    expect(renameNamed('a', 'c')).toBe(true);
    expect(listMaps()).toEqual(['c', 'b']);
    expect(loadNamed('c')).not.toBeNull();
    expect(loadNamed('a')).toBeNull();
  });

  it('deletes a map', () => {
    saveNamed('x', createEmptyMap());
    deleteNamed('x');
    expect(listMaps()).toEqual([]);
    expect(loadNamed('x')).toBeNull();
  });
});

describe('play handoff', () => {
  it('writes a loadable draft snapshot under the reserved key', () => {
    const level = writePlayDraft(createEmptyMap(5, 5));
    expect(level).toBe('__draft__');
    const raw = (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage.getItem(
      PLAY_DRAFT_KEY,
    );
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).width).toBe(5);
  });
});
