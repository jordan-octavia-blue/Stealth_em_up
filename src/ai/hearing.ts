/**
 * Hearing (roadmap §5.2). Sounds are bus events `{pos, loudness, type}`. A listener
 * hears one when its *nav* distance from the source — cost-weighted distance through the
 * pathfinding graph, so it bends around walls — is within the sound's carry. Occlusion
 * therefore falls out of pathfinding for free, replacing the old flat 500 px
 * through-wall alert radius.
 *
 * These functions are pure: the nav distance is measured by the caller (`nav`) and
 * passed in. Only the loudness table and the audibility comparison live here.
 */

import { SoundType } from './types';

/**
 * Default carry per sound type, in px of nav distance. Silenced weapons emit a
 * `footstep`-level sound rather than a `gunshot`; that mapping lives at the call site.
 */
export const LOUDNESS: Record<SoundType, number> = {
  gunshot: 1400,
  breach: 1100,
  glass: 650,
  engine: 900,
  body: 320,
  footstep: 180,
};

/** Global tuning knob on every sound's carry. */
export const HEARING_K = 1;

export function loudnessFor(type: SoundType): number {
  return LOUDNESS[type];
}

/**
 * Is a sound of `loudness` audible to a listener `navDistance` (cost-weighted, through
 * walls) away? An unreachable listener (Infinity) never hears it.
 */
export function isAudible(navDistance: number, loudness: number, k: number = HEARING_K): boolean {
  if (!Number.isFinite(navDistance)) return false;
  return navDistance <= loudness * k;
}
