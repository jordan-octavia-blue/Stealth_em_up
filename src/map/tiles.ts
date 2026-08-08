/**
 * The tile catalog — the single source of truth for every tile the game and the map editor
 * understand (Phase 10 — map editor).
 *
 * A "tile" is one of the numbers in a map's `data[]` array (a wall, a floor, a door, glass, …).
 * Before this file that knowledge was copied by hand into seven places — the game's grid
 * `switch` (src/legacy/jo_grid.ts), the editor's `TILE` codes, its palette, its canvas
 * renderer, its image loader, its autotile adapter, and data/tileset.json — and they drifted:
 * glass (code 7) shipped in the game but was never added to the editor, so you couldn't paint
 * it. Everything now derives from `TILE_TYPES` below, so adding one entry here makes a new tile
 * show up in the game grid AND in the editor (palette button, canvas drawing, autotiling) with
 * no other edits.
 *
 * Pure data + tiny lookups: no DOM, no canvas, no Pixi, no globals — safe for both the game
 * runtime and the editor (which reuses this the same way it reuses loader.ts / doors.ts).
 *
 * Two concerns live together in each entry, on purpose, so a tile is defined in exactly one
 * place:
 *  - Gameplay: the flags `jo_grid` hands to `jo_wall` (solid / vision-blocking / restricted /
 *    door) and the `imageNumber` the game draws with.
 *  - Editor presentation: the palette button (label, group, colour swatch, hint) and how the
 *    editor's 2D canvas draws the tile (`editorDraw`).
 * Destruction data (material / hit points) stays in data/tileset.json — a separate concern on
 * a separate code path (grid.damageCell). It is keyed by the same tile codes.
 */

/** How the editor's 2D canvas draws a tile. The game draws via `imageNumber` instead. */
export type EditorDraw =
  /** Black base tile (`base` PNG) with the autotiled wall overlay on top. */
  | { kind: 'wall'; base: string }
  /** Floor base with the closed-door sprite and a type-coloured badge (drawn by render.ts). */
  | { kind: 'door' }
  /** A single PNG (basename under images/, no extension) drawn to fill the cell. */
  | { kind: 'image'; file: string }
  /**
   * A translucent square of `color` at `alpha` over the floor. Used for glass (which has no
   * art) and is the sensible default for any future tile added without dedicated art.
   */
  | { kind: 'swatch'; color: string; alpha: number };

/** Everything the game and editor need to know about one tile code. */
export interface TileType {
  /** The number stored in a map's `data[]` array. */
  code: number;
  /** Stable identifier; also the editor tool id for a paintable tile. */
  id: string;
  /** Human-readable name (editor palette + inspector). */
  label: string;

  // --- gameplay (consumed by src/legacy/jo_grid.ts when it builds the grid) ---
  /** Blocks the hero and guards from walking through. */
  solid: boolean;
  /** Blocks vision and gunfire (guards/cameras can't see or shoot through it). */
  blocksVision: boolean;
  /** The hero is suspicious when seen standing here (a staff-only tile). */
  restricted: boolean;
  /** This cell is a door: the grid makes a lockpickable door sprite for it. */
  door: boolean;
  /** For a door tile, true if the door sprite runs horizontally (code 6) vs vertically (5). */
  doorHorizontal?: boolean;
  /** The `image_number` the game's `jo_wall.changeImage` draws this tile with. */
  imageNumber: number;

  // --- editor presentation ---
  /**
   * Which palette group the paint button appears under in the editor. Omitted for tiles that
   * are NOT painted as plain tiles — doors, which have their own palette tools (unlocked /
   * locked / reinforced / vault) that also record door metadata.
   */
  paletteGroup?: string;
  /** CSS colour for the palette swatch (and the swatch-fill fallback if art is missing). */
  swatch: string;
  /** Status-bar hint shown while the tool is active. */
  hint?: string;
  /** How the editor's canvas draws this tile. */
  editorDraw: EditorDraw;
}

/**
 * Every tile, in the order paint buttons should appear in the editor palette (walls first,
 * then floors; doors are placed with their own tools and carry no palette group). The numeric
 * `code` values and gameplay flags reproduce the old `switch` in src/legacy/jo_grid.ts exactly
 * — see test/map/tiles.test.ts, which locks that parity.
 */
export const TILE_TYPES: TileType[] = [
  {
    code: 1,
    id: 'wall',
    label: 'Wall',
    solid: true,
    blocksVision: true,
    restricted: false,
    door: false,
    imageNumber: 0,
    paletteGroup: 'Walls',
    swatch: '#1a1a1a',
    hint: 'Drag to paint walls. Hold Shift for a straight line.',
    editorDraw: { kind: 'wall', base: 'tile_black' },
  },
  {
    code: 3,
    id: 'desk',
    label: 'Desk',
    solid: true,
    blocksVision: false,
    restricted: false,
    door: false,
    imageNumber: 2,
    paletteGroup: 'Walls',
    swatch: '#8a5a2b',
    hint: 'Desk / low cover — solid but you can see over it.',
    editorDraw: { kind: 'image', file: 'tile_brown' },
  },
  {
    code: 7,
    id: 'glass',
    label: 'Glass',
    solid: true,
    blocksVision: false,
    restricted: false,
    door: false,
    imageNumber: 5,
    paletteGroup: 'Walls',
    swatch: '#bfe4ff',
    hint: 'Glass wall — blocks movement but not sight; shatters when shot, bombed or rammed.',
    // Mirrors the game's translucent bluish-white square (jo_wall image 5: 0xBFE4FF @ 0.5).
    editorDraw: { kind: 'swatch', color: '#bfe4ff', alpha: 0.5 },
  },
  {
    code: 2,
    id: 'floor',
    label: 'Floor',
    solid: false,
    blocksVision: false,
    restricted: false,
    door: false,
    imageNumber: 1,
    paletteGroup: 'Floors',
    swatch: '#e8e8e8',
    hint: 'Walkable public floor.',
    editorDraw: { kind: 'image', file: 'tile_white' },
  },
  {
    code: 4,
    id: 'restricted',
    label: 'Restricted',
    solid: false,
    blocksVision: false,
    restricted: true,
    door: false,
    imageNumber: 3,
    paletteGroup: 'Floors',
    swatch: '#c0392b',
    hint: 'Staff-only floor — the hero is suspicious if seen here.',
    editorDraw: { kind: 'image', file: 'tile_red' },
  },
  // Doors (codes 5/6) are solid + opaque + flagged `restricted`, reproducing the original
  // `new jo_wall(4, true, true, true, …)`. They have no `paletteGroup`: the editor paints them
  // through the dedicated Door tools (which also record the door's type), not as plain tiles.
  {
    code: 5,
    id: 'doorVertical',
    label: 'Door (vertical)',
    solid: true,
    blocksVision: true,
    restricted: true,
    door: true,
    doorHorizontal: false,
    imageNumber: 4,
    swatch: '#caa64b',
    editorDraw: { kind: 'door' },
  },
  {
    code: 6,
    id: 'doorHorizontal',
    label: 'Door (horizontal)',
    solid: true,
    blocksVision: true,
    restricted: true,
    door: true,
    doorHorizontal: true,
    imageNumber: 4,
    swatch: '#caa64b',
    editorDraw: { kind: 'door' },
  },
];

const BY_CODE: Map<number, TileType> = new Map(TILE_TYPES.map((t) => [t.code, t]));

/** The tile for a code, or `undefined` for a code not in the catalog (an unknown/legacy tile). */
export function tileType(code: number): TileType | undefined {
  return BY_CODE.get(code);
}

function codeOf(id: string): number {
  const t = TILE_TYPES.find((x) => x.id === id);
  if (!t) throw new Error(`tiles.ts: no tile with id "${id}"`);
  return t.code;
}

/**
 * Named tile codes, derived from the catalog. Code referring to a specific tile by name (the
 * editor's map model, tools, tests) uses these instead of magic numbers. Re-exported from
 * src/editor/mapModel.ts as `TILE` for the editor's existing call sites.
 */
export const TILE = {
  wall: codeOf('wall'),
  floor: codeOf('floor'),
  desk: codeOf('desk'),
  restricted: codeOf('restricted'),
  doorVertical: codeOf('doorVertical'),
  doorHorizontal: codeOf('doorHorizontal'),
  glass: codeOf('glass'),
} as const;

/** The tiles that appear as plain paint buttons in the editor palette (those with a group). */
export function paintableTiles(): TileType[] {
  return TILE_TYPES.filter((t) => t.paletteGroup !== undefined);
}

/**
 * The PNG basename the editor draws a tile with, when it draws a single image (an `image` tile,
 * or the base of a `wall` tile). `undefined` for door/swatch tiles, which have no single image.
 * Used both to preload images and to find the floor image the editor draws under doors/glass.
 */
export function editorTileFile(code: number): string | undefined {
  const d = tileType(code)?.editorDraw;
  if (!d) return undefined;
  if (d.kind === 'image') return d.file;
  if (d.kind === 'wall') return d.base;
  return undefined;
}

/** Every PNG basename the editor must preload to draw the catalog's image/wall tiles. */
export function editorTileFiles(): string[] {
  const files = new Set<string>();
  for (const t of TILE_TYPES) {
    const d = t.editorDraw;
    if (d.kind === 'image') files.add(d.file);
    if (d.kind === 'wall') files.add(d.base);
  }
  return [...files];
}
