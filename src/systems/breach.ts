/**
 * Breach response — FX + AI (roadmap §6.2, pipeline steps 6 and 7).
 *
 * The last two listeners on `cell:destroyed`. By the time they run the wall is already
 * gone (grid flags cleared, fixture queued for removal, nav/fog invalidated); this module
 * is the *reaction* to that:
 *
 *  - **FX (step 6):** a burst of debris shards and a puff of dust where the wall was, plus
 *    a loud break sound — so a breach is something the player sees and hears.
 *  - **AI (step 7):** a moderate danger deposit at the hole (guards route around a fresh
 *    breach the way they route around gunfire), and a `cell:breached` event carrying the
 *    breach location. That event is the seam Phase 6b's squad blackboard reads to treat a
 *    blown-open wall as a new candidate entry point; nothing consumes it yet.
 *
 * The FX read the same window globals the rest of the legacy render code does (the particle
 * container, the shard textures, `play_sound`). When those are absent — a headless unit
 * test, or before the map has finished loading — the FX are skipped and only the AI half
 * runs, so this module is safe to import anywhere.
 */

import { gameClock } from '../core/clock';
import { events } from '../core/events';
import { shardParticleSplatter } from './particles';

/** Danger left at a breach. Smaller than a gunshot's, but it lingers and spreads a little. */
const BREACH_DANGER_AMOUNT = 3;
const BREACH_DANGER_RADIUS = 2;

/** Break sounds stack ugly when a bomb clears 20 cells at once; rate-limit to one per window. */
const BREACH_SOUND_COOLDOWN_MS = 120;
let lastBreachSoundAt = -Infinity;

/** Pixel centre of a flat cell index, using the live grid's dimensions. */
function cellCenter(index: number): { x: number; y: number } {
  const g = (window as any).grid;
  const size = g.cell_size;
  return {
    x: (index % g.width) * size + size / 2,
    y: Math.floor(index / g.width) * size + size / 2,
  };
}

/** True when the render globals the FX need are present (i.e. we are in the real game). */
function fxAvailable(): boolean {
  const w = window as any;
  return !!(w.grid && w.particle_container && typeof w.play_sound === 'function');
}

function breachFX(index: number): void {
  if (!fxAvailable()) return;
  const w = window as any;
  const center = cellCenter(index);

  // Debris + dust: a couple of shard bursts thrown outward in different directions. The
  // shared shard-count/limit keeps a big multi-cell blast from flooding the particle pool.
  shardParticleSplatter(0, center);
  shardParticleSplatter(Math.PI, center);

  // A loud, throttled break — one thump even when a blast levels a whole row at once.
  const now = gameClock.now();
  if (now - lastBreachSoundAt >= BREACH_SOUND_COOLDOWN_MS) {
    lastBreachSoundAt = now;
    if (w.sound_explosion) w.play_sound(w.sound_explosion);
  }
}

function breachAI(index: number): void {
  const g = (window as any).grid;
  if (!g) return;
  const center = cellCenter(index);
  // A fresh hole is a dangerous place to be: nudge paths away from it for a few seconds.
  events.emit('nav:danger', { x: center.x, y: center.y, amount: BREACH_DANGER_AMOUNT, radius: BREACH_DANGER_RADIUS });
  // The Phase 6b seam: "there is a new way into this room here". No consumer yet.
  events.emit('cell:breached', { index, x: center.x, y: center.y });
}

// Register the two pipeline listeners. Importing this module once (from the game entry)
// wires them for the rest of the run.
events.on('cell:destroyed', (payload) => {
  const index = typeof payload === 'number' ? payload : (payload as { index: number }).index;
  if (typeof index !== 'number') return;
  breachFX(index);
  breachAI(index);
});
