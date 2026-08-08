/**
 * The editor's tool palette (Phase 10 — map editor).
 *
 * Pure data: what buttons exist, grouped, and what each one does when you click on the map.
 * The controller (editor.ts) reads the active tool's `action` to decide whether a click
 * paints a tile, drops an object, stamps a door, and so on. Keeping this as data (not
 * behaviour) means the palette UI and the click handler stay in sync from one source.
 */

import type { DoorType } from '../map/doors';
import { TILE } from './mapModel';

/** What clicking the map does with a given tool selected. */
export type ToolAction =
  | { kind: 'tile'; code: number }
  | { kind: 'door'; door: DoorType }
  | { kind: 'vault' }
  | { kind: 'point'; objectKey: string }
  | { kind: 'guard' }
  | { kind: 'camera' }
  | { kind: 'escape' }
  | { kind: 'patrol' }
  | { kind: 'erase' };

export interface Tool {
  id: string;
  label: string;
  /** A colour swatch shown on the palette button (CSS colour). */
  swatch: string;
  action: ToolAction;
  /** Short hint shown in the status bar when the tool is active. */
  hint?: string;
}

export interface ToolGroup {
  name: string;
  tools: Tool[];
}

/** Colours used both on door-type palette swatches and on door badges in the map. */
export const DOOR_TYPE_COLORS: Record<DoorType, string> = {
  unlocked: '#37c871',
  locked: '#d9a520',
  reinforced: '#e8722e',
  vault: '#5b8dd9',
};

export const PALETTE: ToolGroup[] = [
  {
    name: 'Walls',
    tools: [
      { id: 'wall', label: 'Wall', swatch: '#1a1a1a', action: { kind: 'tile', code: TILE.wall }, hint: 'Drag to paint walls. Hold Shift for a straight line.' },
      { id: 'desk', label: 'Desk', swatch: '#8a5a2b', action: { kind: 'tile', code: TILE.desk }, hint: 'Desk / low cover — solid but you can see over it.' },
    ],
  },
  {
    name: 'Floors',
    tools: [
      { id: 'floor', label: 'Floor', swatch: '#e8e8e8', action: { kind: 'tile', code: TILE.floor }, hint: 'Walkable public floor.' },
      { id: 'restricted', label: 'Restricted', swatch: '#c0392b', action: { kind: 'tile', code: TILE.restricted }, hint: 'Staff-only floor — the hero is suspicious if seen here.' },
    ],
  },
  {
    name: 'Doors',
    tools: [
      { id: 'door-unlocked', label: 'Unlocked', swatch: DOOR_TYPE_COLORS.unlocked, action: { kind: 'door', door: 'unlocked' }, hint: 'Opens on approach, no lockpicking.' },
      { id: 'door-locked', label: 'Locked', swatch: DOOR_TYPE_COLORS.locked, action: { kind: 'door', door: 'locked' }, hint: 'Standard lockpickable door.' },
      { id: 'door-reinforced', label: 'Reinforced', swatch: DOOR_TYPE_COLORS.reinforced, action: { kind: 'door', door: 'reinforced' }, hint: 'Tougher, slower to lockpick.' },
      { id: 'door-vault', label: 'Vault (3-wide)', swatch: DOOR_TYPE_COLORS.vault, action: { kind: 'vault' }, hint: 'Steel, very slow to pick; opens instantly with the bank manager’s key.' },
    ],
  },
  {
    name: 'Spawns',
    tools: [
      { id: 'hero', label: 'Hero', swatch: '#2ec4b6', action: { kind: 'point', objectKey: 'hero' }, hint: 'Where the player starts.' },
      { id: 'guard', label: 'Guard', swatch: '#4b6cb7', action: { kind: 'guard' }, hint: 'Click to add a guard; click a guard to edit it.' },
      { id: 'guard-backup', label: 'Backup spawn', swatch: '#7b8cff', action: { kind: 'point', objectKey: 'guard_backup_spawn' }, hint: 'Where reinforcement waves appear.' },
      { id: 'van', label: 'Van', swatch: '#9b59b6', action: { kind: 'point', objectKey: 'van' }, hint: 'The getaway vehicle.' },
      { id: 'escape', label: 'Escape zone', swatch: '#00ff66', action: { kind: 'escape' }, hint: 'Drag a rectangle: reach it in the loot-laden van to win.' },
    ],
  },
  {
    name: 'Objects',
    tools: [
      { id: 'loot', label: 'Money', swatch: '#f1c40f', action: { kind: 'point', objectKey: 'loot' }, hint: 'The loot to steal.' },
      { id: 'computer', label: 'Computer', swatch: '#16a085', action: { kind: 'point', objectKey: 'computer' }, hint: 'Camera-hacking terminal.' },
      { id: 'camera', label: 'Camera', swatch: '#e67e22', action: { kind: 'camera' }, hint: 'Click to add a camera; click one to edit its sweep.' },
    ],
  },
  {
    name: 'Patrol',
    tools: [
      { id: 'patrol', label: 'Patrol route', swatch: '#3498db', action: { kind: 'patrol' }, hint: 'Click to drop route waypoints; assign a route to a guard in its panel.' },
    ],
  },
  {
    name: 'Edit',
    tools: [
      { id: 'erase', label: 'Erase', swatch: '#555', action: { kind: 'erase' }, hint: 'Click an object to delete it, or a tile to clear it to floor.' },
    ],
  },
];

/** Look a tool up by id (the id stored as the active tool). */
export function toolById(id: string): Tool | undefined {
  for (const group of PALETTE) {
    for (const tool of group.tools) if (tool.id === id) return tool;
  }
  return undefined;
}
