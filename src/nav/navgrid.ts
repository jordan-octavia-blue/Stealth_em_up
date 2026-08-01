/**
 * NavGrid — the navigation data layer (roadmap §4).
 *
 * One flat typed array per layer, indexed by `y * width + x`, which is the same flat
 * index the legacy `jo_grid.cells` array uses. Nothing here knows about Pixi, sprites
 * or the legacy grid object: `Nav` (index.ts) is what translates between them.
 *
 * Costs are summed at node expansion by every consumer (A*, Dijkstra/flow field):
 *
 *   baseCost   1 for plain floor, slightly higher for restricted tiles and rubble.
 *   doorCost   static chokepoint penalty per door, plus (Phase 6) temporary spikes
 *              when a squadmate claims an entry.
 *   dangerCost decaying heatmap of where allies died / shots were fired (danger.ts).
 *
 * The per-node search scratch (g/f scores, came-from, open/closed state) lives here
 * too, with a **generation stamp**: a search bumps `generation` and treats any node
 * whose stamp is stale as untouched. That one integer compare replaces the old
 * `astar.init` loop that reset all 1600 nodes on every single search.
 */

/** A point in world pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Neighbour offsets: 4 orthogonal first, then the 4 diagonals. */
export const DIR_X = [1, 0, -1, 0, 1, 1, -1, -1] as const;
export const DIR_Y = [0, 1, 0, -1, 1, -1, 1, -1] as const;
/** Step cost multiplier per direction (1 orthogonal, sqrt(2) diagonal). */
export const DIR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;
/** Index of the direction pointing the opposite way. */
export const OPPOSITE_DIR = [2, 3, 0, 1, 7, 6, 5, 4] as const;
export const ORTHOGONAL_DIRS = 4;
export const ALL_DIRS = 8;

export const DEFAULT_CELL_SIZE = 64;

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly cellSize: number;

  /** 1 = a unit may stand here, 0 = solid. Doors count as walkable (guards open them). */
  readonly walkable: Uint8Array;
  readonly baseCost: Float32Array;
  readonly doorCost: Float32Array;
  readonly dangerCost: Float32Array;

  /**
   * Bumped by every change to `walkable`. Regions, flow fields and in-flight path
   * requests compare against it to notice they were computed against stale geometry.
   */
  version = 0;

  // --- search scratch (shared by astar.ts; stamped, never bulk-reset) ---
  readonly gScore: Float32Array;
  readonly fScore: Float32Array;
  readonly cameFrom: Int32Array;
  /** 0 = untouched, 1 = open, 2 = closed. Only meaningful when `stamp[i] === generation`. */
  readonly state: Uint8Array;
  readonly stamp: Uint32Array;
  generation = 0;

  constructor(width: number, height: number, cellSize: number = DEFAULT_CELL_SIZE) {
    if (width <= 0 || height <= 0) throw new Error('NavGrid needs a positive width and height');
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cellSize = cellSize;

    this.walkable = new Uint8Array(this.size);
    this.baseCost = new Float32Array(this.size).fill(1);
    this.doorCost = new Float32Array(this.size);
    this.dangerCost = new Float32Array(this.size);

    this.gScore = new Float32Array(this.size);
    this.fScore = new Float32Array(this.size);
    this.cameFrom = new Int32Array(this.size);
    this.state = new Uint8Array(this.size);
    this.stamp = new Uint32Array(this.size);
  }

  // --- indexing -------------------------------------------------------------

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  index(cx: number, cy: number): number {
    return cy * this.width + cx;
  }

  cellX(index: number): number {
    return index % this.width;
  }

  cellY(index: number): number {
    return Math.floor(index / this.width);
  }

  /** Cell index containing a world point, or -1 if the point is off the map. */
  indexAtPoint(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    if (!this.inBounds(cx, cy)) return -1;
    return this.index(cx, cy);
  }

  /** World point at the centre of a cell — where paths put their waypoints. */
  pointAtIndex(index: number): Point {
    const half = this.cellSize / 2;
    return {
      x: this.cellX(index) * this.cellSize + half,
      y: this.cellY(index) * this.cellSize + half,
    };
  }

  isWalkable(index: number): boolean {
    return index >= 0 && index < this.size && this.walkable[index] === 1;
  }

  /** Total per-node cost multiplier used by every search. Never below a small epsilon. */
  costAt(index: number): number {
    const cost = this.baseCost[index] + this.doorCost[index] + this.dangerCost[index];
    return cost > 0.01 ? cost : 0.01;
  }

  setWalkable(index: number, walkable: boolean): boolean {
    const next = walkable ? 1 : 0;
    if (this.walkable[index] === next) return false;
    this.walkable[index] = next;
    this.version++;
    return true;
  }

  // --- neighbours -----------------------------------------------------------

  /**
   * True if a step in direction `dir` from `index` is legal.
   *
   * Diagonals additionally require **both** shared orthogonal neighbours to be
   * walkable, so a unit can never squeeze through the corner where two walls meet
   * (the "corner cutting" the old library happily did, which is why guards used to
   * clip wall corners).
   */
  canStep(index: number, dir: number): boolean {
    const cx = this.cellX(index);
    const cy = this.cellY(index);
    const nx = cx + DIR_X[dir];
    const ny = cy + DIR_Y[dir];
    if (!this.inBounds(nx, ny)) return false;
    if (this.walkable[this.index(nx, ny)] !== 1) return false;
    if (dir < ORTHOGONAL_DIRS) return true;
    return (
      this.walkable[this.index(nx, cy)] === 1 && this.walkable[this.index(cx, ny)] === 1
    );
  }

  /** Neighbour index in direction `dir`, or -1 if that step is not legal. */
  neighbor(index: number, dir: number): number {
    if (!this.canStep(index, dir)) return -1;
    return this.index(this.cellX(index) + DIR_X[dir], this.cellY(index) + DIR_Y[dir]);
  }

  // --- search scratch -------------------------------------------------------

  /** Start a new search: every node's stamp becomes stale in one integer bump. */
  beginSearch(): void {
    this.generation++;
    if (this.generation === 0xffffffff) {
      // Practically unreachable (a full search every frame would take ~2 years), but
      // wrapping would make stale stamps look fresh, so reset properly on the way past.
      this.stamp.fill(0);
      this.generation = 1;
    }
  }

  isTouched(index: number): boolean {
    return this.stamp[index] === this.generation;
  }

  touch(index: number): void {
    this.stamp[index] = this.generation;
  }

  /**
   * Nearest walkable cell to `index` by breadth-first ring search, or -1 if the whole
   * map is solid. Units can legitimately stand in a solid cell — the van and the
   * security computer make the ground under them solid after spawn — so both ends of
   * every request are snapped through here rather than failing.
   */
  nearestWalkable(index: number, maxRadius = 8): number {
    if (index < 0 || index >= this.size) return -1;
    if (this.walkable[index] === 1) return index;
    const cx = this.cellX(index);
    const cy = this.cellY(index);
    for (let r = 1; r <= maxRadius; r++) {
      let best = -1;
      let bestDistSq = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          // ring only: the interior was covered by a smaller r
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.index(nx, ny);
          if (this.walkable[ni] !== 1) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = ni;
          }
        }
      }
      if (best !== -1) return best;
    }
    return -1;
  }
}
