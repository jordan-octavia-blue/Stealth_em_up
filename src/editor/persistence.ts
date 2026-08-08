/**
 * Editor persistence (Phase 10 — map editor).
 *
 * A small named library of maps in localStorage. Each map is stored as its serialized
 * `.jomap` JSON under `stealth.editor.map.<name>`; an index lists the names and one key
 * remembers which map is open. Autosave (debounced in the controller) just calls `saveNamed`.
 * The Play button writes a separate, validated snapshot under `stealth.play.__draft__`, which
 * the game reads when launched as `game.html?level=__draft__`.
 */

import type { MapData } from '../map/loader';
import { deserialize, serialize } from './mapModel';

const MAP_PREFIX = 'stealth.editor.map.';
const INDEX_KEY = 'stealth.editor.index';
const CURRENT_KEY = 'stealth.editor.current';

/** The reserved level id the game loads from localStorage (see main.ts). */
export const PLAY_DRAFT_LEVEL = '__draft__';
export const PLAY_DRAFT_KEY = 'stealth.play.__draft__';

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(names: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(names));
}

/** All saved map names, in insertion order. */
export function listMaps(): string[] {
  return readIndex();
}

export function getCurrentName(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentName(name: string): void {
  localStorage.setItem(CURRENT_KEY, name);
}

/** Load a saved map by name, or null if missing/corrupt. */
export function loadNamed(name: string): MapData | null {
  const raw = localStorage.getItem(MAP_PREFIX + name);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

/** Save (create or overwrite) a named map. Adds it to the index if new. */
export function saveNamed(name: string, map: MapData): void {
  localStorage.setItem(MAP_PREFIX + name, serialize(map));
  const index = readIndex();
  if (!index.includes(name)) {
    index.push(name);
    writeIndex(index);
  }
}

export function deleteNamed(name: string): void {
  localStorage.removeItem(MAP_PREFIX + name);
  writeIndex(readIndex().filter((n) => n !== name));
}

/** Rename a map, preserving its position in the index. Returns false on a name clash. */
export function renameNamed(oldName: string, newName: string): boolean {
  const index = readIndex();
  if (!index.includes(oldName) || index.includes(newName)) return false;
  const raw = localStorage.getItem(MAP_PREFIX + oldName);
  if (raw !== null) localStorage.setItem(MAP_PREFIX + newName, raw);
  localStorage.removeItem(MAP_PREFIX + oldName);
  writeIndex(index.map((n) => (n === oldName ? newName : n)));
  if (getCurrentName() === oldName) setCurrentName(newName);
  return true;
}

/** A unique name derived from `base` (base, base-2, base-3, …). */
export function uniqueName(base: string): string {
  const index = readIndex();
  if (!index.includes(base)) return base;
  let n = 2;
  while (index.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Stash a validated map for the game's Play handoff and return the level id to open
 * (`game.html?level=__draft__`).
 */
export function writePlayDraft(map: MapData): string {
  localStorage.setItem(PLAY_DRAFT_KEY, serialize(map));
  return PLAY_DRAFT_LEVEL;
}
