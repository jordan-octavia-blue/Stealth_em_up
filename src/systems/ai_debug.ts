/**
 * Guard-AI debug overlay (roadmap §10.4 — "FSM state labels ... are part of each
 * system's deliverable, not an afterthought").
 *
 * Press **M** in game to cycle: off -> fsm -> vision.
 *
 *   fsm     each living guard's FSM state (coloured label) + awareness meter bar, and a
 *           screen-corner readout of the global alert level.
 *   vision  the above, plus each guard's max vision-range ring.
 *
 * Like the other overlays this reads shared world state (`guards`, `camera`, the display
 * containers) as window globals; the AI data it draws comes from `ai` and each guard's
 * `brain`, neither of which knows anything about rendering.
 */

import { ai } from '../ai';

export const AI_DEBUG_MODES = ['off', 'fsm', 'vision'] as const;
export type AiDebugMode = (typeof AI_DEBUG_MODES)[number];

let mode = 0;
let graphics: any = null;
let labels: any[] = [];
let alertText: any = null;

// Publish the AI facade here — in the debug module, not the game code — so the browser
// console and the headless probe can read the squad's alert level and each guard's brain
// without any shipping code depending on a global (mirrors nav_debug's `window.nav`).
window.ai = ai;

/** One colour per FSM state, for the label and the awareness bar. */
const STATE_COLOR: Record<string, number> = {
  PATROL: 0x9e9e9e,
  SUSPICIOUS: 0xfff176,
  INVESTIGATE: 0xffb74d,
  COMBAT: 0xe53935,
  SEARCH: 0xba68c8,
  FLEE: 0x4fc3f7,
  DEAD: 0x555555,
};

const ALERT_LABEL = ['CALM', 'SUSPICIOUS', 'ALARMED', 'LOCKDOWN'];

export function currentAiDebugMode(): AiDebugMode {
  return AI_DEBUG_MODES[mode];
}

export function cycleAiDebug(): AiDebugMode {
  mode = (mode + 1) % AI_DEBUG_MODES.length;
  if (mode === 0) hideAll();
  return currentAiDebugMode();
}

/** Drop the overlay's Pixi objects — the display containers are rebuilt per run. */
export function resetAiDebug(): void {
  graphics = null;
  labels = [];
  alertText = null;
  mode = 0;
}

function hideAll(): void {
  if (graphics) graphics.clear();
  for (const label of labels) label.visible = false;
  if (alertText) alertText.visible = false;
}

function ensureGraphics(): any {
  if (!graphics || !graphics.parent) {
    graphics = new PIXI.Graphics();
    display_actors.addChild(graphics);
  }
  return graphics;
}

/** A reusable label; grows the pool on demand. */
function labelAt(index: number): any {
  if (!labels[index] || !labels[index].parent) {
    const text = new PIXI.Text('', { font: '14px Arial', fill: '#ffffff', stroke: '#000000', strokeThickness: 3 });
    text.anchor.x = 0.5;
    display_actors.addChild(text);
    labels[index] = text;
  }
  return labels[index];
}

/** Called once per fixed step from gameloop(), after the guards have moved. */
export function drawAiDebug(): void {
  if (mode === 0) return;
  if (typeof guards === 'undefined' || !guards) return;
  const g = ensureGraphics();
  g.clear();

  let li = 0;
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i];
    if (!guard || !guard.alive || !guard.brain) continue;
    const state: string = guard.brain.state;
    const color = STATE_COLOR[state] ?? 0xffffff;
    const screen = camera.relativePoint({ x: guard.x, y: guard.y });

    if (currentAiDebugMode() === 'vision') {
      // Max vision-range ring (the cap the old unlimited cone never had).
      const edge = camera.relativePoint({ x: guard.x + guard.brain.maxVisionRange, y: guard.y });
      const r = Math.abs(edge.x - screen.x);
      g.lineStyle(1, color, 0.35);
      g.drawCircle(screen.x, screen.y, r);
    }

    // Awareness meter bar above the guard's head.
    const barW = 40;
    const barX = screen.x - barW / 2;
    const barY = screen.y - 40;
    g.lineStyle(0);
    g.beginFill(0x000000, 0.5);
    g.drawRect(barX - 1, barY - 1, barW + 2, 6);
    g.endFill();
    g.beginFill(color, 0.95);
    g.drawRect(barX, barY, barW * Math.max(0, Math.min(1, guard.brain.awareness)), 4);
    g.endFill();

    // FSM state label.
    const label = labelAt(li++);
    label.visible = true;
    label.text = state;
    label.style.fill = '#' + color.toString(16).padStart(6, '0');
    label.position.x = screen.x;
    label.position.y = barY - 18;
  }
  // Hide any labels left over from a frame with more guards.
  for (; li < labels.length; li++) labels[li].visible = false;

  // Global alert readout floats over the first living guard — a cheap, transform-safe
  // place to surface the squad temperature without a HUD layer.
  const anchor = firstLivingGuard();
  if (anchor) {
    if (!alertText || !alertText.parent) {
      alertText = new PIXI.Text('', { font: '16px Arial', fill: '#ffffff', stroke: '#000000', strokeThickness: 3 });
      alertText.anchor.x = 0.5;
      display_actors.addChild(alertText);
    }
    const level = ai.alertLevel();
    const p = camera.relativePoint({ x: anchor.x, y: anchor.y });
    alertText.visible = true;
    alertText.text = 'SQUAD: ' + ALERT_LABEL[level] + ' (' + ai.alertValue().toFixed(2) + ')';
    alertText.style.fill = level >= 2 ? '#e53935' : level >= 1 ? '#fff176' : '#9e9e9e';
    alertText.position.x = p.x;
    alertText.position.y = p.y - 64;
  } else if (alertText) {
    alertText.visible = false;
  }
}

function firstLivingGuard(): any {
  for (let i = 0; i < guards.length; i++) if (guards[i] && guards[i].alive) return guards[i];
  return null;
}
