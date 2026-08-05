import { describe, expect, it } from 'vitest';
import {
  assignEntriesRoundRobin,
  candidateEntries,
  EntryCandidate,
  labelRooms,
  octileDistance,
  roomOfPoint,
  witnessDangerAmount,
} from '../../src/ai/squad';
import { MAX_DANGER } from '../../src/nav/danger';
import { gridFromAscii } from '../nav/helpers';

/** Centre of cell (x, y) in world pixels (cell size 64, matching gridFromAscii). */
const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

describe('labelRooms', () => {
  // Two vertical corridors joined only by a door in the middle wall.
  const TWO_ROOMS = ['#####', '#.#.#', '#.D.#', '#.#.#', '#####'];

  it('splits the two rooms a door joins (a door is a barrier, not a corridor)', () => {
    const grid = gridFromAscii(TWO_ROOMS);
    const door = grid.index(2, 2);
    const rooms = labelRooms(grid, new Set([door]));

    const left = rooms.labels[grid.index(1, 1)];
    const right = rooms.labels[grid.index(3, 1)];
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(0);
    expect(left).not.toBe(right);
    // The whole left column is one room; the door cell itself belongs to no room.
    expect(rooms.labels[grid.index(1, 3)]).toBe(left);
    expect(rooms.labels[door]).toBe(-1);
  });

  it('a cell added to the entry set (a breach gap) separates the rooms on either side', () => {
    const grid = gridFromAscii(['#####', '#...#', '#####']);
    const mid = grid.index(2, 1);
    // Without the barrier the corridor is one room...
    expect(labelRooms(grid, new Set()).labels[grid.index(1, 1)]).toBe(
      labelRooms(grid, new Set()).labels[grid.index(3, 1)],
    );
    // ...treating the middle cell as an entry cuts it into two.
    const split = labelRooms(grid, new Set([mid]));
    expect(split.labels[grid.index(1, 1)]).not.toBe(split.labels[grid.index(3, 1)]);
    expect(split.labels[mid]).toBe(-1);
  });
});

describe('roomOfPoint', () => {
  const TWO_ROOMS = ['#####', '#.#.#', '#.D.#', '#.#.#', '#####'];

  it('returns the room label of a floor point', () => {
    const grid = gridFromAscii(TWO_ROOMS);
    const rooms = labelRooms(grid, new Set([grid.index(2, 2)]));
    expect(roomOfPoint(grid, rooms, at(1, 2).x, at(1, 2).y)).toBe(rooms.labels[grid.index(1, 2)]);
  });

  it('snaps a point standing in a doorway to an adjacent room', () => {
    const grid = gridFromAscii(TWO_ROOMS);
    const rooms = labelRooms(grid, new Set([grid.index(2, 2)]));
    const room = roomOfPoint(grid, rooms, at(2, 2).x, at(2, 2).y);
    const left = rooms.labels[grid.index(1, 2)];
    const right = rooms.labels[grid.index(3, 2)];
    expect([left, right]).toContain(room);
  });

  it('returns -1 for a point off the map', () => {
    const grid = gridFromAscii(TWO_ROOMS);
    const rooms = labelRooms(grid, new Set([grid.index(2, 2)]));
    expect(roomOfPoint(grid, rooms, -100, -100)).toBe(-1);
  });
});

describe('candidateEntries', () => {
  // A one-cell central room with a door on each of its four sides; the south door opens onto
  // solid wall (no outside floor), the other three onto isolated outside cells.
  const PLUS = ['#######', '###.###', '###D###', '#.D.D.#', '###D###', '#######'];

  it('finds only the entries that border the room AND have an outside approach', () => {
    const grid = gridFromAscii(PLUS);
    const doors = new Set([grid.index(3, 2), grid.index(2, 3), grid.index(4, 3), grid.index(3, 4)]);
    const rooms = labelRooms(grid, doors);
    const targetRoom = roomOfPoint(grid, rooms, at(3, 3).x, at(3, 3).y);

    const candidates = candidateEntries(grid, rooms, targetRoom, doors);
    // North, West, East qualify; the South door (onto wall) is dropped.
    expect(candidates.map((c) => c.cell)).toEqual([grid.index(3, 2), grid.index(2, 3), grid.index(4, 3)]);
    expect(candidates.map((c) => c.cell)).not.toContain(grid.index(3, 4));
    // Each approach cell is on the guards' side (outside the target room) and walkable.
    const approaches = candidates.map((c) => c.approachCell);
    expect(approaches).toEqual([grid.index(3, 1), grid.index(1, 3), grid.index(5, 3)]);
    for (const a of approaches) {
      expect(grid.walkable[a]).toBe(1);
      expect(rooms.labels[a]).not.toBe(targetRoom);
    }
  });
});

describe('assignEntriesRoundRobin', () => {
  // 1-D positions: a guard's "cell" and a candidate's approach cell are both coordinates on a
  // line, and distance is their gap. This isolates the assignment logic from any real grid.
  const entry = (cell: number, approachCell: number, danger = 0): EntryCandidate => ({ cell, approachCell, danger });
  const lineDistance = (guardCell: number, c: EntryCandidate) => Math.abs(guardCell - c.approachCell);

  it('fans guards out across distinct entrances when the claim spike is on', () => {
    const guards = [0, 0, 0]; // all nearest the first door
    const candidates = [entry(100, 0), entry(101, 10), entry(102, 20)];
    const assignment = assignEntriesRoundRobin(guards, candidates, {
      distanceFn: lineDistance,
      dangerWeight: 1,
      spikePerClaim: 100,
    });
    expect(new Set(assignment.values()).size).toBe(3);
  });

  it('collapses everyone onto the nearest entrance when the spike is off (the spike is the spread)', () => {
    const guards = [0, 0, 0];
    const candidates = [entry(100, 0), entry(101, 10), entry(102, 20)];
    const assignment = assignEntriesRoundRobin(guards, candidates, {
      distanceFn: lineDistance,
      dangerWeight: 1,
      spikePerClaim: 0,
    });
    expect([...assignment.values()]).toEqual([100, 100, 100]);
  });

  it('avoids a dangerous entrance when there are safer ones to spare', () => {
    const guards = [0, 0]; // fewer guards than doors
    const candidates = [entry(100, 0, 10 /* dangerous */), entry(101, 5), entry(102, 10)];
    const assignment = assignEntriesRoundRobin(guards, candidates, {
      distanceFn: lineDistance,
      dangerWeight: 2,
      spikePerClaim: 100,
    });
    expect([...assignment.values()]).not.toContain(100);
  });
});

describe('witnessDangerAmount', () => {
  it('matches the old flat deposit for a lone, unwitnessed death', () => {
    expect(witnessDangerAmount(false, 0)).toEqual({ amount: 6, radius: 2 });
  });

  it('grows with witnesses and is heavier at a chokepoint, clamped under the ceiling', () => {
    expect(witnessDangerAmount(false, 1).amount).toBeGreaterThan(witnessDangerAmount(false, 0).amount);
    expect(witnessDangerAmount(false, 2).amount).toBeGreaterThan(witnessDangerAmount(false, 1).amount);
    expect(witnessDangerAmount(true, 1).amount).toBeGreaterThan(witnessDangerAmount(false, 1).amount);
    expect(witnessDangerAmount(true, 1).radius).toBe(3);
    expect(witnessDangerAmount(true, 9).amount).toBeLessThanOrEqual(MAX_DANGER);
  });
});

describe('octileDistance', () => {
  it('is cheaper on the diagonal than two orthogonal steps', () => {
    const grid = gridFromAscii(['....', '....', '....', '....']);
    const diag = octileDistance(grid, grid.index(0, 0), grid.index(1, 1));
    const straight = octileDistance(grid, grid.index(0, 0), grid.index(2, 0));
    expect(diag).toBeCloseTo(Math.SQRT2);
    expect(straight).toBeCloseTo(2);
  });
});
