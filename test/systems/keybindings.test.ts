import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_ACTIONS,
  keyLabel,
  getBindings,
  codeFor,
  actionForCode,
  setBinding,
  resetBindings,
  reloadBindings,
} from '../../src/systems/keybindings';

// Minimal in-memory localStorage so the module's persistence path is exercised under the
// node test environment (which has no real localStorage).
class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(k: string): string | null {
    return k in this.store ? this.store[k] : null;
  }
  setItem(k: string, v: string): void {
    this.store[k] = String(v);
  }
  removeItem(k: string): void {
    delete this.store[k];
  }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  resetBindings();
});

describe('keybindings', () => {
  it('resolves every action to its default when nothing is stored', () => {
    const bindings = getBindings();
    for (const action of KEY_ACTIONS) {
      expect(bindings[action.id]).toBe(action.defaultCode);
      expect(codeFor(action.id)).toBe(action.defaultCode);
    }
  });

  it('maps a keyCode back to the action that owns it', () => {
    // Defaults: 87 = W = move_up, 32 = Space = interact
    expect(actionForCode(87)).toBe('move_up');
    expect(actionForCode(32)).toBe('interact');
    expect(actionForCode(999)).toBeUndefined();
  });

  it('rebinds an action and persists it across a cache reload', () => {
    // Rebind reload (R/82) to K (75), which no other action uses.
    const swapped = setBinding('reload', 75);
    expect(swapped).toBeUndefined();
    expect(codeFor('reload')).toBe(75);

    // Drop the in-memory cache; the value must survive via localStorage.
    reloadBindings();
    expect(codeFor('reload')).toBe(75);
    expect(actionForCode(75)).toBe('reload');
  });

  it('swaps keys when a rebind collides with another action to avoid duplicates', () => {
    // move_up = W(87), move_down = S(83). Bind move_up to S: move_down should inherit W.
    const swapped = setBinding('move_up', 83);
    expect(swapped).toBe('move_down');
    expect(codeFor('move_up')).toBe(83);
    expect(codeFor('move_down')).toBe(87);
    // No key is bound to two actions.
    const seen = new Set<number>();
    for (const action of KEY_ACTIONS) {
      const code = codeFor(action.id);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it('resetBindings restores defaults', () => {
    setBinding('reload', 75);
    expect(codeFor('reload')).toBe(75);
    resetBindings();
    expect(codeFor('reload')).toBe(82);
  });

  it('keyLabel gives readable names with a fallback', () => {
    expect(keyLabel(87)).toBe('W');
    expect(keyLabel(32)).toBe('Space');
    expect(keyLabel(16)).toBe('Shift');
    expect(keyLabel(4242)).toBe('Key 4242');
  });
});
