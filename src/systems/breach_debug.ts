/**
 * Destructible-wall (breach) debug overlay (roadmap §10.4 — "debug overlays are part of
 * each system's deliverable, not an afterthought").
 *
 * Press **H** in game to cycle: off -> materials -> hp.
 *
 *   materials  every solid wall / door tinted by what it's made of, so you can see at a
 *              glance which walls a bomb or bullet can actually break:
 *                green  = drywall   (bullets, bombs, cars all break it)
 *                orange = brick     (bombs / frag / car only — bullets bounce off)
 *                grey   = concrete  (bombs / frag only)
 *                blue   = steel      (indestructible)
 *              A cell with no material entry falls back to brick, matching damageCell.
 *   hp         a health bar on every destructible cell, green when full and sliding to
 *              red as damage chips it down. This is the view that shows a wall taking
 *              hits before it finally breaks.
 *
 * Like the other debug overlays this reads shared world state (`grid`, `camera`,
 * `display_actors`) as window globals; the cell data (`material`, `hp`, `maxHp`) is
 * written by jo_grid from data/tileset.json, which knows nothing about rendering.
 */

export const BREACH_DEBUG_MODES = ['off', 'materials', 'hp'] as const;
export type BreachDebugMode = (typeof BREACH_DEBUG_MODES)[number];

let mode = 0;
let graphics: any = null;

// Fill colour per material for the 'materials' mode. Anything not listed (a floor, or a
// material we haven't added) simply isn't drawn.
const MATERIAL_COLORS: Record<string, number> = {
  drywall: 0x66bb6a, // green  — the weakest, breakable by anything
  brick: 0xff9800,   // orange
  concrete: 0x9e9e9e, // grey
  steel: 0x5c6bc0,   // blue   — indestructible
};

export function currentBreachDebugMode(): BreachDebugMode {
  return BREACH_DEBUG_MODES[mode];
}

/** Advance to the next overlay mode and return its name (for the on-screen message). */
export function cycleBreachDebug(): BreachDebugMode {
  mode = (mode + 1) % BREACH_DEBUG_MODES.length;
  if (graphics && mode === 0) graphics.clear();
  return currentBreachDebugMode();
}

/** Drop the overlay's Pixi objects — the display containers are rebuilt per run. */
export function resetBreachDebug(): void {
  graphics = null;
  mode = 0;
}

function ensureGraphics(): any {
  if (!graphics || !graphics.parent) {
    graphics = new PIXI.Graphics();
    display_actors.addChild(graphics);
  }
  return graphics;
}

/** True for a cell that a wall exists in — a solid wall or a closed door, not a floor. */
function isWallCell(cell: any): boolean {
  return !!cell && (cell.solid || cell.door);
}

/** Called once per fixed step from gameloop(). */
export function drawBreachDebug(): void {
  if (mode === 0 || typeof grid === 'undefined' || !grid || !grid.cells) return;
  const g = ensureGraphics();
  g.clear();

  const cs = grid.cell_size;

  if (currentBreachDebugMode() === 'materials') {
    for (let i = 0; i < grid.cells.length; i++) {
      const cell = grid.cells[i];
      if (!isWallCell(cell)) continue;
      const material = cell.material || 'brick';
      const color = MATERIAL_COLORS[material];
      if (color === undefined) continue;
      const p = camera.relativePoint({ x: cell.x, y: cell.y });
      g.beginFill(color, 0.35);
      g.drawRect(p.x, p.y, cs, cs);
      g.endFill();
    }
    return;
  }

  // hp: a health bar across the top of every destructible cell.
  const barH = 6;
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    if (!isWallCell(cell)) continue;
    const max = cell.maxHp || 0;
    if (max <= 0) continue; // no hp data — nothing to show
    const frac = Math.max(0, Math.min(1, cell.hp / max));
    const p = camera.relativePoint({ x: cell.x, y: cell.y });
    // Track (empty portion) in dark grey, then the fill green->red by remaining health.
    g.beginFill(0x000000, 0.5);
    g.drawRect(p.x + 2, p.y + 2, cs - 4, barH);
    g.endFill();
    // Green (full) through yellow to red (near death): interpolate red up, green down.
    const red = Math.round(255 * (1 - frac));
    const green = Math.round(255 * frac);
    const color = (red << 16) | (green << 8);
    g.beginFill(color, 0.9);
    g.drawRect(p.x + 2, p.y + 2, (cs - 4) * frac, barH);
    g.endFill();
  }
}
