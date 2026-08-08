/**
 * Settings persistence for the menu.
 *
 * Ported from Some of You May Die's `src/storage.ts` and trimmed to what a static,
 * browser-only build needs (no Electron/Steam disk mirror, no localization coupling).
 * The contract is the same as the game it came from:
 *
 *   - Most settings live together in one JSON blob under the `OPTIONS` key.
 *   - `assign(OPTIONS, { foo: bar })` merges a change in, re-reads, and re-applies.
 *   - `runBindings(options)` lights up the `.btn[data-bind]` that matches each option's
 *     stored value, so a toggle button shows the persisted choice with no per-button code.
 *   - `getSavedData()` on load parses the blob over the defaults, publishes it to
 *     `globalThis.options`, applies it, and runs the bindings.
 *
 * Rebindable keyboard controls persist separately through `src/systems/keybindings.ts`
 * (their own `stealthControls` key), exactly as SoYMD keeps controls out of the OPTIONS
 * blob under its own `controls` key.
 */

export const STORAGE_OPTIONS = 'OPTIONS';

export interface MenuOptions {
  /** Master volume 0..1, threaded into the game launch URL as `?volume=`. */
  volume: number;
}

const defaultOptions: MenuOptions = {
  volume: 1,
};

export function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    // localStorage access itself can throw under restrictive browser privacy settings.
    console.warn('storage: unable to read from localStorage', key, e);
    return null;
  }
}

export function set(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    // Persistence is a nice-to-have — never let a storage failure break the menu.
    console.warn('storage: unable to write to localStorage', key, e);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('storage: unable to remove from localStorage', key, e);
  }
}

/** Merge `value` into the JSON object stored at `key`, then re-apply all saved data. */
export function assign(key: string, value: object): MenuOptions {
  const existing = get(key);
  let json: Record<string, unknown> = {};
  if (existing) {
    try {
      json = JSON.parse(existing);
    } catch (e) {
      console.warn('storage: stored value was not valid JSON, overwriting', key, e);
    }
  }
  set(key, JSON.stringify(Object.assign(json, value)));
  return getSavedData();
}

/**
 * For each `[key, value]`, toggle `.active` on every `.btn[data-bind="key"]` whose
 * `data-value` equals the stored value. This is the read-to-DOM mechanism that keeps
 * option buttons showing the persisted choice.
 */
export function runBindings(value: object): void {
  for (const [k, v] of Object.entries(value)) {
    const matchingEls = document.querySelectorAll(`[data-bind="${k}"]`);
    for (const el of Array.from(matchingEls)) {
      if (el.classList.contains('btn')) {
        el.classList.toggle('active', (el as HTMLElement).dataset.value === String(v));
      }
    }
  }
}

/**
 * Parse the OPTIONS blob over the defaults, publish it to `globalThis.options`, apply the
 * settings that have a runtime effect, and light up the matching option buttons. Returns
 * the resolved options so callers (e.g. the Play button) can read them synchronously.
 */
export function getSavedData(): MenuOptions {
  const stored = get(STORAGE_OPTIONS);
  let parsed: Partial<MenuOptions> = {};
  if (stored) {
    try {
      parsed = JSON.parse(stored);
    } catch (e) {
      console.warn('storage: unable to parse OPTIONS, using defaults', e);
    }
  }
  const options: MenuOptions = { ...defaultOptions, ...parsed };
  (globalThis as any).options = options;
  runBindings(options as unknown as object);
  return options;
}
