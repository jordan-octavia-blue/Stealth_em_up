/**
 * Path-request scheduler (roadmap §4).
 *
 * Nothing outside `src/nav/` calls a search directly. Callers post a request and keep
 * walking their existing path until a new one arrives, which is what turns the old
 * "empty path -> full A* this frame, every frame, per guard" storm into a bounded
 * amount of work no matter how many guards want a path at once.
 *
 * Two mechanisms do the bounding:
 *   - a per-frame **budget** (a maximum number of searches, and a wall-time ceiling);
 *   - **coalescing** on the requester: a second request from the same guard cancels
 *     its pending one instead of queueing behind it.
 *
 * Priority is combat > investigate > patrol, ties broken by arrival order, so a guard
 * chasing the hero is never stuck behind a queue of idle patrol requests.
 */

import { Point } from './navgrid';

export const PathPriority = {
  Patrol: 0,
  Investigate: 1,
  Combat: 2,
} as const;
export type PathPriority = (typeof PathPriority)[keyof typeof PathPriority];

export type PathState = 'pending' | 'ready' | 'failed' | 'cancelled';

export interface PathRequest {
  /** Coalescing key — one pending request per owner. */
  owner: unknown;
  from: Point;
  to: Point;
  priority?: PathPriority;
  /** Body radius, for the clearance test used when smoothing. */
  radius?: number;
  onReady?: (path: Point[]) => void;
  onFail?: () => void;
}

/** What the caller gets back immediately; it fills in when the search actually runs. */
export class PathHandle {
  state: PathState = 'pending';
  path: Point[] | null = null;

  constructor(readonly request: PathRequest) {}

  get pending(): boolean {
    return this.state === 'pending';
  }

  cancel(): void {
    if (this.state === 'pending') this.state = 'cancelled';
  }
}

/** Runs one search. Returns null when no path exists. */
export type PathSolver = (request: PathRequest) => Point[] | null;

export interface SchedulerOptions {
  /** Max searches per `update()`. */
  maxSearches?: number;
  /** Wall-time ceiling per `update()`, in milliseconds. */
  maxMillis?: number;
  /** Injectable clock, so the budget is testable without real timing. */
  now?: () => number;
}

export interface SchedulerStats {
  /** Searches run by the last `update()`. */
  searches: number;
  /** Requests still waiting after the last `update()`. */
  queued: number;
  /** Running total of requests dropped because their owner re-requested first. */
  coalesced: number;
}

interface Entry {
  handle: PathHandle;
  priority: number;
  /** Arrival order, for FIFO within a priority. */
  seq: number;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export class PathScheduler {
  private queue: Entry[] = [];
  private byOwner = new Map<unknown, Entry>();
  private seq = 0;

  readonly maxSearches: number;
  readonly maxMillis: number;
  private readonly now: () => number;

  readonly stats: SchedulerStats = { searches: 0, queued: 0, coalesced: 0 };

  constructor(
    private readonly solve: PathSolver,
    { maxSearches = 4, maxMillis = 0.5, now = defaultNow }: SchedulerOptions = {},
  ) {
    this.maxSearches = maxSearches;
    this.maxMillis = maxMillis;
    this.now = now;
  }

  get queued(): number {
    return this.queue.length;
  }

  /** Post a request. Any pending request from the same owner is cancelled. */
  request(request: PathRequest): PathHandle {
    if (this.removePending(request.owner)) this.stats.coalesced++;
    const entry: Entry = {
      handle: new PathHandle(request),
      priority: request.priority ?? PathPriority.Patrol,
      seq: this.seq++,
    };
    this.queue.push(entry);
    this.byOwner.set(request.owner, entry);
    return entry.handle;
  }

  /** The owner's in-flight request, if it has one. */
  pendingFor(owner: unknown): PathHandle | undefined {
    return this.byOwner.get(owner)?.handle;
  }

  hasPending(owner: unknown): boolean {
    return this.byOwner.has(owner);
  }

  cancel(owner: unknown): void {
    this.removePending(owner);
  }

  private removePending(owner: unknown): boolean {
    const existing = this.byOwner.get(owner);
    if (!existing) return false;
    existing.handle.cancel();
    this.byOwner.delete(owner);
    const i = this.queue.indexOf(existing);
    if (i !== -1) this.queue.splice(i, 1);
    return true;
  }

  /** Drop everything — called when a run is torn down. */
  clear(): void {
    for (const entry of this.queue) entry.handle.cancel();
    this.queue.length = 0;
    this.byOwner.clear();
    this.seq = 0;
  }

  /** Run queued searches until the budget runs out. Called once per fixed step. */
  update(): SchedulerStats {
    const start = this.now();
    let searches = 0;

    while (this.queue.length > 0 && searches < this.maxSearches) {
      // The wall-time ceiling is checked *between* searches: one search always runs, so
      // a slow frame can never starve the queue completely.
      if (searches > 0 && this.now() - start >= this.maxMillis) break;

      const entry = this.takeNext();
      const { handle } = entry;
      if (handle.state === 'cancelled') continue;

      searches++;
      const path = this.solve(handle.request);
      if (path && path.length > 0) {
        handle.state = 'ready';
        handle.path = path;
        handle.request.onReady?.(path);
      } else {
        handle.state = 'failed';
        handle.request.onFail?.();
      }
    }

    this.stats.searches = searches;
    this.stats.queued = this.queue.length;
    return this.stats;
  }

  /** Highest priority, then oldest. The queue is a handful of entries, so a scan wins. */
  private takeNext(): Entry {
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const entry = this.queue.splice(best, 1)[0];
    this.byOwner.delete(entry.handle.request.owner);
    return entry;
  }
}
