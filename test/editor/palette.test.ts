import { describe, expect, it } from 'vitest';
import { PALETTE, toolById } from '../../src/editor/palette';
import { TILE } from '../../src/map/tiles';

/**
 * The palette's tile-paint buttons (Walls, Floors) are generated from the shared tile catalog,
 * so every game tile — including glass, which used to be missing — is paintable, and a new tile
 * added to src/map/tiles.ts shows up here with no edit. These tests guard that wiring.
 */
describe('editor palette', () => {
  const groups = new Map(PALETTE.map((g) => [g.name, g]));

  it('paints glass (the tile that was missing before) under Walls', () => {
    const glass = toolById('glass');
    expect(glass).toBeDefined();
    expect(glass!.action).toEqual({ kind: 'tile', code: TILE.glass });
    expect(groups.get('Walls')?.tools.map((t) => t.id)).toContain('glass');
  });

  it('still offers every wall + floor paint tile', () => {
    expect(groups.get('Walls')?.tools.map((t) => t.id)).toEqual(['wall', 'desk', 'glass']);
    expect(groups.get('Floors')?.tools.map((t) => t.id)).toEqual(['floor', 'restricted']);
  });

  it('keeps the bespoke (non-tile) tool groups after the generated ones', () => {
    expect(PALETTE.map((g) => g.name)).toEqual([
      'Walls',
      'Floors',
      'Doors',
      'Spawns',
      'Objects',
      'Patrol',
      'Edit',
    ]);
  });

  it('does not turn doors into plain paint tiles (they keep their door tools)', () => {
    expect(toolById('doorVertical')).toBeUndefined();
    expect(groups.get('Doors')?.tools.map((t) => t.action.kind)).toEqual([
      'door',
      'door',
      'door',
      'vault',
    ]);
  });
});
