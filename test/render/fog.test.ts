import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events';
import { currentOccluders, occluderRebuilds, resetFog } from '../../src/render/fog';

/**
 * Occluder invalidation (roadmap §6.2, pipeline step 4).
 *
 * The fog's occluder set is derived from the *live* grid and cached. When a wall is
 * destroyed the pipeline emits `cell:destroyed`, and `src/render/fog.ts` subscribes to it
 * to drop the cache — so the very next frame rebuilds the occluders without the wall, and
 * the hole becomes see-through for both the player's fog and the guards' sight.
 *
 * The module reads the shared `grid` global (like the rest of the render layer), so these
 * tests install a minimal one on globalThis.
 */

/** A grid with a single vision-blocking cell in the centre; everything else see-through. */
function centreWallGrid() {
  const width = 3;
  const height = 3;
  const cells = Array.from({ length: width * height }, () => ({ blocks_vision: false }));
  cells[width * 1 + 1].blocks_vision = true; // centre
  return { width, height, cell_size: 64, cells };
}

describe('fog occluder cache invalidation', () => {
  beforeEach(() => resetFog());

  it('rebuilds the occluder set after a cell:destroyed event', () => {
    const grid = centreWallGrid();
    (globalThis as unknown as { grid: unknown }).grid = grid;

    const before = currentOccluders();
    const rebuildsBefore = occluderRebuilds();

    // Destroy the centre wall the way the pipeline does: clear its flag, then fire.
    grid.cells[3 * 1 + 1].blocks_vision = false;
    events.emit('cell:destroyed', 4);

    const after = currentOccluders();

    // The cache was thrown away and rebuilt once...
    expect(occluderRebuilds()).toBe(rebuildsBefore + 1);
    // ...and the rebuilt set no longer has the four edges the centre wall contributed.
    expect(after.length).toBeLessThan(before.length);
  });

  it('does not rebuild until something asks for the occluders again', () => {
    const grid = centreWallGrid();
    (globalThis as unknown as { grid: unknown }).grid = grid;

    currentOccluders();
    const rebuilds = occluderRebuilds();
    // Invalidating alone must not rebuild — the work is deferred to the next read.
    events.emit('cell:destroyed', 4);
    expect(occluderRebuilds()).toBe(rebuilds);
  });
});
