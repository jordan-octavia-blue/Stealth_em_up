import { describe, expect, it } from 'vitest';
import { HEARING_K, isAudible, LOUDNESS, loudnessFor } from '../../src/ai/hearing';

describe('loudness table', () => {
  it('ranks a gunshot louder than a breach louder than a footstep', () => {
    expect(loudnessFor('gunshot')).toBeGreaterThan(loudnessFor('breach'));
    expect(loudnessFor('breach')).toBeGreaterThan(loudnessFor('footstep'));
  });

  it('a silenced-weapon-equivalent footstep barely carries', () => {
    expect(LOUDNESS.footstep).toBeLessThan(LOUDNESS.gunshot / 4);
  });
});

describe('isAudible', () => {
  it('hears a sound within its carry', () => {
    expect(isAudible(500, 1400)).toBe(true);
  });

  it('does not hear a sound past its carry', () => {
    expect(isAudible(1500, 1400)).toBe(false);
  });

  it('is audible exactly at the boundary', () => {
    expect(isAudible(1400, 1400)).toBe(true);
  });

  it('an unreachable listener (Infinity nav distance) never hears it', () => {
    expect(isAudible(Infinity, 1400)).toBe(false);
  });

  it('the tuning constant scales the carry', () => {
    expect(isAudible(1000, 800, 1)).toBe(false);
    expect(isAudible(1000, 800, 2)).toBe(true);
  });

  it('defaults k to HEARING_K', () => {
    expect(isAudible(HEARING_K * 200, 200)).toBe(true);
  });
});
