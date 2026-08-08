/**
 * Rebindable keyboard controls.
 *
 * The game used to hard-code every `keyCode` inline in `input.ts` (e.g. `code == 87`
 * for W). This module is the single indirection layer between a physical key and the
 * gameplay action it triggers, so the player can rebind keys from the menu's Settings
 * screen and have the game honour it.
 *
 * Persistence deliberately mirrors how the ported Some of You May Die menu stores its
 * settings: a JSON blob in `localStorage` under a stable key, read once at load and
 * re-applied on demand. Both pages read the same key, so a binding chosen on `menu.html`
 * is in effect the next time `game.html` boots.
 *
 * It is imported by BOTH the game (`input.ts`, which resolves each pressed key through
 * `codeFor` / `actionForCode`) and the menu (which renders the rebinding widget). It has
 * no dependency on either side's globals so it can live in both bundles unchanged.
 */

export type KeyGroup = 'Movement' | 'Actions' | 'Debug';

export interface KeyAction {
  /** Stable id used as the persistence key and the `input.ts` lookup. */
  id: string;
  /** Human-facing label shown in the controls list. */
  label: string;
  /** The `keyCode` this action defaults to. */
  defaultCode: number;
  /** Grouping for the settings UI. */
  group: KeyGroup;
}

/**
 * The rebindable keyboard actions, in the order they should appear in the UI.
 *
 * Every entry here corresponds to a `keyCode` comparison in `src/systems/input.ts`; when
 * a binding here changes, that handler picks it up through `codeFor()`. Mouse buttons
 * (shoot / pick-up-gun), the wheel zoom and Esc are intentionally NOT rebindable — they
 * are not keyboard keys — and the weapon-switch number keys are omitted because they are
 * currently disabled in `input.ts`.
 *
 * Keep this list and the handlers in `input.ts` in lock-step (see CLAUDE.md, "Controls").
 */
export const KEY_ACTIONS: KeyAction[] = [
  { id: 'move_up', label: 'Move Up', defaultCode: 87, group: 'Movement' }, // W
  { id: 'move_down', label: 'Move Down', defaultCode: 83, group: 'Movement' }, // S
  { id: 'move_left', label: 'Move Left', defaultCode: 65, group: 'Movement' }, // A
  { id: 'move_right', label: 'Move Right', defaultCode: 68, group: 'Movement' }, // D
  { id: 'sprint', label: 'Sprint (hold)', defaultCode: 16, group: 'Movement' }, // Shift
  { id: 'interact', label: 'Interact / Lockpick / Drag / Choke', defaultCode: 32, group: 'Actions' }, // Space
  { id: 'draw_weapon', label: 'Draw / Holster Weapon', defaultCode: 71, group: 'Actions' }, // G
  { id: 'reload', label: 'Reload', defaultCode: 82, group: 'Actions' }, // R
  { id: 'mask', label: 'Put On / Take Off Mask', defaultCode: 86, group: 'Actions' }, // V
  { id: 'bomb', label: 'Place / Detonate Explosive', defaultCode: 70, group: 'Actions' }, // F
  { id: 'spyglass', label: 'Spyglass / Binoculars', defaultCode: 80, group: 'Actions' }, // P
  { id: 'vehicle', label: 'Enter / Exit Van', defaultCode: 69, group: 'Actions' }, // E
  { id: 'nav_debug', label: 'Nav Overlay', defaultCode: 78, group: 'Debug' }, // N
  { id: 'physics_debug', label: 'Physics / Fog Overlay', defaultCode: 66, group: 'Debug' }, // B
  { id: 'wall_debug', label: 'Wall Destruction Overlay', defaultCode: 72, group: 'Debug' }, // H
];

/**
 * localStorage key. Named to sit alongside the other ported menu settings; the value is a
 * JSON object mapping action id -> keyCode.
 */
const STORAGE_KEY = 'stealthControls';

/** keyCode -> short display label, for the controls list and the rebind buttons. */
const KEY_LABELS: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
  19: 'Pause', 20: 'Caps', 27: 'Esc', 32: 'Space',
  33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home',
  37: '←', 38: '↑', 39: '→', 40: '↓',
  45: 'Insert', 46: 'Delete',
  48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
  65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I',
  74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R',
  83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
  96: 'Num 0', 97: 'Num 1', 98: 'Num 2', 99: 'Num 3', 100: 'Num 4', 101: 'Num 5',
  102: 'Num 6', 103: 'Num 7', 104: 'Num 8', 105: 'Num 9',
  106: 'Num *', 107: 'Num +', 109: 'Num -', 110: 'Num .', 111: 'Num /',
  112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
  120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
  186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`',
  219: '[', 220: '\\', 221: ']', 222: "'",
};

/** Human-readable label for a keyCode, e.g. `87` -> `"W"`. */
export function keyLabel(code: number): string {
  return KEY_LABELS[code] || `Key ${code}`;
}

/**
 * Cached resolved map (action id -> keyCode). Built lazily from storage merged over the
 * defaults so a stored file that predates a new action still resolves that action to its
 * default. Cleared by `setBinding` / `resetBindings` so it always reflects the latest.
 */
let cache: Record<string, number> | null = null;

function readStored(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch (e) {
    // localStorage access itself can throw under restrictive browser privacy settings;
    // bindings are a nice-to-have, so fall back to defaults rather than break input.
    console.warn('keybindings: unable to read stored controls', e);
    return {};
  }
}

/** The current action-id -> keyCode map, defaults filled in for anything unstored. */
export function getBindings(): Record<string, number> {
  if (cache) return cache;
  const stored = readStored();
  const map: Record<string, number> = {};
  for (const action of KEY_ACTIONS) {
    const stored_code = stored[action.id];
    map[action.id] = typeof stored_code === 'number' && Number.isFinite(stored_code)
      ? stored_code
      : action.defaultCode;
  }
  cache = map;
  return map;
}

/** The keyCode currently bound to `actionId` (its default if unbound/unknown). */
export function codeFor(actionId: string): number {
  return getBindings()[actionId];
}

/** The action id currently bound to `code`, or undefined if no action uses that key. */
export function actionForCode(code: number): string | undefined {
  const map = getBindings();
  for (const id in map) {
    if (map[id] === code) return id;
  }
  return undefined;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getBindings()));
  } catch (e) {
    console.warn('keybindings: unable to persist controls', e);
  }
}

/**
 * Bind `actionId` to `code`. If another action already uses that key it is swapped onto
 * the key `actionId` used to hold, so there is never a duplicate binding (two actions on
 * one key would both fire). Returns the id of the action that got swapped, if any.
 */
export function setBinding(actionId: string, code: number): string | undefined {
  const map = getBindings();
  if (!(actionId in map)) return undefined;
  const previousCode = map[actionId];
  let swapped: string | undefined;
  for (const id in map) {
    if (id !== actionId && map[id] === code) {
      map[id] = previousCode;
      swapped = id;
      break;
    }
  }
  map[actionId] = code;
  cache = map;
  persist();
  return swapped;
}

/** Restore every action to its default key. */
export function resetBindings(): void {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('keybindings: unable to clear stored controls', e);
  }
  getBindings();
}

/**
 * Force a re-read from storage on the next lookup. `input.ts` reads bindings once when its
 * handlers are installed at game start; this lets a caller invalidate the cache if the
 * stored value changed underneath it.
 */
export function reloadBindings(): void {
  cache = null;
}
