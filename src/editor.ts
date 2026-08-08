/**
 * Map editor entry + controller (Phase 10 — map editor).
 *
 * This is the `editor.html` entry. It owns the editor's live state (the open map, the view,
 * the active tool, selection, undo/redo) and wires the DOM and canvas to the pure helpers in
 * `src/editor/*`. It intentionally imports none of the game/Pixi runtime — it reuses only the
 * game's pure map modules (loader, tileset, autotiler) so authored maps load and play
 * identically.
 */

import type { MapData } from './map/loader';
import { WEAPON_IDS } from './map/guards';
import type { GuardBehavior } from './map/guards';
import { type EditorAssets, loadEditorAssets } from './editor/assets';
import {
  CELL,
  type Edge,
  EditError,
  contractMap,
  createEmptyMap,
  deserialize,
  expandMap,
  serialize,
  validateComplete,
} from './editor/mapModel';
import { type RenderUi, type View, fitView, renderMap, screenToWorld, worldToScreen } from './editor/render';
import { PALETTE, type ToolAction, toolById } from './editor/palette';
import {
  type CameraObject,
  type GuardObject,
  type Selection,
  addCamera,
  addGuard,
  addPatrolPoint,
  applyTileTool,
  createRoute,
  deleteSelection,
  guardObject,
  hitTestObject,
  moveSelection,
  placePoint,
  snapToCell,
  updateCamera,
  updateGuard,
} from './editor/tools';
import {
  PLAY_DRAFT_LEVEL,
  deleteNamed,
  getCurrentName,
  listMaps,
  loadNamed,
  renameNamed,
  saveNamed,
  setCurrentName,
  uniqueName,
  writePlayDraft,
} from './editor/persistence';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const UNDO_LIMIT = 60;
const AUTOSAVE_MS = 400;

class Editor {
  private map!: MapData;
  private view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  private activeToolId = 'wall';
  private selection: Selection | null = null;
  private activeRoute: number | null = null;
  private undoStack: MapData[] = [];
  private redoStack: MapData[] = [];
  private currentName = 'untitled';
  private hover: { x: number; y: number } | null = null;
  private warning = '';

  // interaction state
  private painting = false;
  private lineMode = false;
  private lineStart: { x: number; y: number } | null = null;
  private lastPaintCell: { x: number; y: number } | null = null;
  private dragging: Selection | null = null;
  private dragMoved = false;
  private panning = false;
  private panFrom = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
  private escapeFrom: { wx: number; wy: number } | null = null;
  private pointerWorld = { wx: 0, wy: 0 };
  private spaceDown = false;
  private autosaveTimer = 0;

  private readonly canvas = el<HTMLCanvasElement>('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  constructor(private readonly assets: EditorAssets) {}

  start(): void {
    this.loadInitialMap();
    this.buildPalette();
    this.buildBounds();
    this.wireToolbar();
    this.wireCanvas();
    this.wireKeyboard();
    this.refreshMapSelect();
    this.resizeCanvas();
    this.view = fitView(this.map, this.canvas.width, this.canvas.height);
    new ResizeObserver(() => this.resizeCanvas()).observe(el('stage'));
    this.commit();
  }

  // --- map lifecycle -------------------------------------------------------

  private loadInitialMap(): void {
    const names = listMaps();
    const current = getCurrentName();
    if (current && names.includes(current)) {
      this.currentName = current;
      this.map = loadNamed(current) ?? createEmptyMap();
    } else if (names.length > 0) {
      this.currentName = names[0];
      this.map = loadNamed(names[0]) ?? createEmptyMap();
    } else {
      this.currentName = uniqueName('untitled');
      this.map = createEmptyMap();
      saveNamed(this.currentName, this.map);
    }
    setCurrentName(this.currentName);
  }

  private activeAction(): ToolAction {
    return (toolById(this.activeToolId) ?? PALETTE[0].tools[0]).action;
  }

  // --- undo / autosave -----------------------------------------------------

  private pushUndo(): void {
    this.undoStack.push(structuredClone(this.map));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.map));
    this.map = prev;
    this.selection = null;
    this.commit();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.map));
    this.map = next;
    this.selection = null;
    this.commit();
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => saveNamed(this.currentName, this.map), AUTOSAVE_MS);
  }

  /** Called after any change: redraw, autosave, refresh the surrounding UI. */
  private commit(): void {
    this.draw();
    this.scheduleAutosave();
    this.renderInspector();
    el('mapSize').textContent = `${this.map.width} × ${this.map.height}`;
    (el('undo') as HTMLButtonElement).disabled = this.undoStack.length === 0;
    (el('redo') as HTMLButtonElement).disabled = this.redoStack.length === 0;
    el<HTMLElement>('warn').textContent = this.warning;
  }

  // --- rendering -----------------------------------------------------------

  private resizeCanvas(): void {
    const stage = el('stage');
    this.canvas.width = stage.clientWidth;
    this.canvas.height = stage.clientHeight;
    this.draw();
  }

  private draw(): void {
    const ui: RenderUi = { hover: this.hover, selection: this.selection, activeRoute: this.activeRoute };
    renderMap(this.ctx, this.canvas, this.map, this.assets, this.view, ui);
    this.drawPreview();
  }

  /** Screen-space overlays for in-progress gestures (line paint, escape rectangle). */
  private drawPreview(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.lineMode && this.lineStart) {
      const a = worldToScreen(this.view, this.lineStart.x * CELL + CELL / 2, this.lineStart.y * CELL + CELL / 2);
      const b = worldToScreen(this.view, this.pointerWorld.wx, this.pointerWorld.wy);
      ctx.strokeStyle = 'rgba(46,196,182,0.9)';
      ctx.lineWidth = Math.max(2, this.view.scale * 6);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    if (this.escapeFrom) {
      const a = worldToScreen(this.view, this.escapeFrom.wx, this.escapeFrom.wy);
      const b = worldToScreen(this.view, this.pointerWorld.wx, this.pointerWorld.wy);
      ctx.strokeStyle = 'rgba(0,255,102,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  }

  // --- palette + bounds UI -------------------------------------------------

  private buildPalette(): void {
    const root = el('palette');
    root.innerHTML = '';
    for (const group of PALETTE) {
      const h = document.createElement('h3');
      h.textContent = group.name;
      root.appendChild(h);
      for (const tool of group.tools) {
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.dataset.tool = tool.id;
        btn.innerHTML = `<span class="swatch" style="background:${tool.swatch}"></span>${tool.label}`;
        btn.addEventListener('click', () => this.setTool(tool.id));
        root.appendChild(btn);
      }
    }
    this.highlightTool();
  }

  private setTool(id: string): void {
    this.activeToolId = id;
    this.selection = null;
    this.highlightTool();
    const tool = toolById(id);
    el('hint').textContent = tool?.hint ?? '';
    this.commit();
  }

  private highlightTool(): void {
    el('palette')
      .querySelectorAll<HTMLButtonElement>('.tool-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset.tool === this.activeToolId));
  }

  private buildBounds(): void {
    const grid = el('boundsGrid');
    // 3×3 layout: grow buttons on the edges, shrink buttons just inside.
    const layout: Array<{ label?: string; edge?: Edge; grow?: boolean; spacer?: boolean }> = [
      { spacer: true }, { label: '+ N', edge: 'N', grow: true }, { spacer: true },
      { label: '+ W', edge: 'W', grow: true }, { label: '– N', edge: 'N', grow: false }, { label: '+ E', edge: 'E', grow: true },
      { label: '– W', edge: 'W', grow: false }, { label: '– S', edge: 'S', grow: false }, { label: '– E', edge: 'E', grow: false },
      { spacer: true }, { label: '+ S', edge: 'S', grow: true }, { spacer: true },
    ];
    grid.innerHTML = '';
    for (const cell of layout) {
      if (cell.spacer || !cell.edge) {
        grid.appendChild(document.createElement('span'));
        continue;
      }
      const btn = document.createElement('button');
      btn.textContent = cell.label ?? '';
      const edge = cell.edge;
      const grow = cell.grow!;
      btn.addEventListener('click', () => this.doBounds(edge, grow));
      grid.appendChild(btn);
    }
  }

  private doBounds(edge: Edge, grow: boolean): void {
    try {
      const result = grow ? expandMap(this.map, edge) : contractMap(this.map, edge);
      this.pushUndo();
      this.map = result.map;
      this.selection = null;
      this.warning = result.warnings.join(' ');
      this.view = fitView(this.map, this.canvas.width, this.canvas.height);
      this.commit();
    } catch (err) {
      this.warning = err instanceof EditError ? err.message : String(err);
      this.commit();
    }
  }

  // --- toolbar (library, undo, io) -----------------------------------------

  private wireToolbar(): void {
    el<HTMLSelectElement>('mapSelect').addEventListener('change', (e) =>
      this.switchMap((e.target as HTMLSelectElement).value),
    );
    el('newMap').addEventListener('click', () => this.newMap());
    el('dupMap').addEventListener('click', () => this.dupMap());
    el('renameMap').addEventListener('click', () => this.renameMap());
    el('deleteMap').addEventListener('click', () => this.deleteMap());
    el('undo').addEventListener('click', () => this.undo());
    el('redo').addEventListener('click', () => this.redo());
    el('exportBtn').addEventListener('click', () => this.exportMap());
    el('importBtn').addEventListener('click', () => el<HTMLInputElement>('importFile').click());
    el<HTMLInputElement>('importFile').addEventListener('change', (e) => this.importMap(e));
    el('playBtn').addEventListener('click', () => this.play());
  }

  private refreshMapSelect(): void {
    const sel = el<HTMLSelectElement>('mapSelect');
    sel.innerHTML = '';
    for (const name of listMaps()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === this.currentName) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  private saveNow(): void {
    saveNamed(this.currentName, this.map);
  }

  private switchMap(name: string): void {
    this.saveNow();
    const loaded = loadNamed(name);
    if (!loaded) return;
    this.currentName = name;
    setCurrentName(name);
    this.map = loaded;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.activeRoute = null;
    this.warning = '';
    this.view = fitView(this.map, this.canvas.width, this.canvas.height);
    this.refreshMapSelect();
    this.commit();
  }

  private newMap(): void {
    const base = (window.prompt('Name for the new map:', 'untitled') ?? '').trim();
    if (!base) return;
    this.saveNow();
    this.currentName = uniqueName(base);
    this.map = createEmptyMap();
    saveNamed(this.currentName, this.map);
    setCurrentName(this.currentName);
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.view = fitView(this.map, this.canvas.width, this.canvas.height);
    this.refreshMapSelect();
    this.commit();
  }

  private dupMap(): void {
    this.saveNow();
    const copy = uniqueName(this.currentName);
    saveNamed(copy, this.map);
    this.currentName = copy;
    setCurrentName(copy);
    this.refreshMapSelect();
    this.commit();
  }

  private renameMap(): void {
    const next = (window.prompt('Rename map to:', this.currentName) ?? '').trim();
    if (!next || next === this.currentName) return;
    if (!renameNamed(this.currentName, next)) {
      this.warning = `A map named "${next}" already exists.`;
      this.commit();
      return;
    }
    this.currentName = next;
    this.refreshMapSelect();
    this.commit();
  }

  private deleteMap(): void {
    if (!window.confirm(`Delete map "${this.currentName}"? This can't be undone.`)) return;
    deleteNamed(this.currentName);
    const remaining = listMaps();
    if (remaining.length > 0) {
      this.switchMap(remaining[0]);
    } else {
      this.currentName = uniqueName('untitled');
      this.map = createEmptyMap();
      saveNamed(this.currentName, this.map);
      setCurrentName(this.currentName);
    }
    this.refreshMapSelect();
    this.commit();
  }

  private exportMap(): void {
    const blob = new Blob([serialize(this.map)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.currentName}.jomap`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importMap(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const map = deserialize(String(reader.result));
        this.saveNow();
        this.currentName = uniqueName(file.name.replace(/\.(jomap|json)$/i, '') || 'imported');
        this.map = map;
        saveNamed(this.currentName, this.map);
        setCurrentName(this.currentName);
        this.undoStack = [];
        this.redoStack = [];
        this.selection = null;
        this.view = fitView(this.map, this.canvas.width, this.canvas.height);
        this.refreshMapSelect();
        this.warning = '';
        this.commit();
      } catch (err) {
        this.warning = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
        this.commit();
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private play(): void {
    const check = validateComplete(this.map);
    if (!check.ok) {
      this.warning = `Can't play yet — missing: ${check.missing.join(', ')}.`;
      this.commit();
      return;
    }
    this.saveNow();
    writePlayDraft(this.map);
    window.open(`game.html?level=${PLAY_DRAFT_LEVEL}`, '_blank');
  }

  // --- canvas interaction --------------------------------------------------

  private wireCanvas(): void {
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private eventCell(e: PointerEvent): { x: number; y: number; wx: number; wy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const world = screenToWorld(this.view, e.clientX - rect.left, e.clientY - rect.top);
    return { x: Math.floor(world.x / CELL), y: Math.floor(world.y / CELL), wx: world.x, wy: world.y };
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const c = this.eventCell(e);
    this.pointerWorld = { wx: c.wx, wy: c.wy };

    if (e.button === 1 || this.spaceDown) {
      this.panning = true;
      this.panFrom = { x: e.clientX, y: e.clientY, offsetX: this.view.offsetX, offsetY: this.view.offsetY };
      return;
    }
    if (e.button !== 0) return;

    const action = this.activeAction();
    if (action.kind === 'tile' || action.kind === 'door' || action.kind === 'vault') {
      this.pushUndo();
      if (e.shiftKey) {
        this.lineMode = true;
        this.lineStart = { x: c.x, y: c.y };
      } else {
        this.painting = true;
        this.warning = applyTileTool(this.map, action, c.x, c.y).join(' ');
        this.lastPaintCell = { x: c.x, y: c.y };
      }
      this.commit();
      return;
    }

    // object tools: grab an existing object first, else place/act
    const hit = hitTestObject(this.map, c.wx, c.wy);
    if (action.kind === 'erase') {
      this.pushUndo();
      if (hit) {
        deleteSelection(this.map, hit);
        this.selection = null;
      } else {
        applyTileTool(this.map, { kind: 'tile', code: 2 }, c.x, c.y);
      }
      this.commit();
      return;
    }
    if (hit) {
      this.selection = hit;
      this.dragging = hit;
      this.dragMoved = false;
      this.commit();
      return;
    }
    this.placeWithTool(action, c);
  }

  private placeWithTool(action: ToolAction, c: { x: number; y: number; wx: number; wy: number }): void {
    const [sx, sy] = snapToCell(c.wx, c.wy);
    switch (action.kind) {
      case 'point':
        this.pushUndo();
        placePoint(this.map, action.objectKey, sx, sy);
        this.selection = { type: 'point', key: action.objectKey };
        this.dragging = this.selection;
        this.dragMoved = true;
        break;
      case 'guard': {
        this.pushUndo();
        const i = addGuard(this.map, sx, sy);
        this.selection = { type: 'guard', index: i };
        this.dragging = this.selection;
        this.dragMoved = true;
        break;
      }
      case 'camera': {
        this.pushUndo();
        const i = addCamera(this.map, sx, sy);
        this.selection = { type: 'camera', index: i };
        this.dragging = this.selection;
        this.dragMoved = true;
        break;
      }
      case 'patrol':
        this.pushUndo();
        if (this.activeRoute === null || !this.map.patrolRoutes[this.activeRoute]) {
          this.activeRoute = createRoute(this.map);
        }
        addPatrolPoint(this.map, this.activeRoute, sx, sy);
        break;
      case 'escape':
        this.pushUndo();
        this.escapeFrom = { wx: c.wx, wy: c.wy };
        break;
      default:
        break;
    }
    this.commit();
  }

  private onMove(e: PointerEvent): void {
    const c = this.eventCell(e);
    this.pointerWorld = { wx: c.wx, wy: c.wy };
    const inBounds = c.x >= 0 && c.y >= 0 && c.x < this.map.width && c.y < this.map.height;
    this.hover = inBounds ? { x: c.x, y: c.y } : null;

    if (this.panning) {
      this.view.offsetX = this.panFrom.offsetX + (e.clientX - this.panFrom.x);
      this.view.offsetY = this.panFrom.offsetY + (e.clientY - this.panFrom.y);
      this.draw();
      return;
    }
    if (this.painting && this.lastPaintCell) {
      const action = this.activeAction();
      for (const cell of cellsBetween(this.lastPaintCell.x, this.lastPaintCell.y, c.x, c.y)) {
        applyTileTool(this.map, action, cell.x, cell.y);
      }
      this.lastPaintCell = { x: c.x, y: c.y };
      this.draw();
      return;
    }
    if (this.dragging) {
      if (!this.dragMoved) {
        this.pushUndo();
        this.dragMoved = true;
      }
      const [sx, sy] = this.dragging.type === 'patrolPoint' ? [c.wx, c.wy] : snapToCell(c.wx, c.wy);
      moveSelection(this.map, this.dragging, sx, sy);
      this.draw();
      return;
    }
    this.draw(); // hover / previews
  }

  private onUp(_e: PointerEvent): void {
    if (this.lineMode && this.lineStart) {
      const action = this.activeAction();
      const end = { x: Math.floor(this.pointerWorld.wx / CELL), y: Math.floor(this.pointerWorld.wy / CELL) };
      for (const cell of cellsBetween(this.lineStart.x, this.lineStart.y, end.x, end.y)) {
        this.warning = applyTileTool(this.map, action, cell.x, cell.y).join(' ') || this.warning;
      }
    }
    if (this.escapeFrom) {
      const x = Math.min(this.escapeFrom.wx, this.pointerWorld.wx);
      const y = Math.min(this.escapeFrom.wy, this.pointerWorld.wy);
      const w = Math.abs(this.pointerWorld.wx - this.escapeFrom.wx);
      const h = Math.abs(this.pointerWorld.wy - this.escapeFrom.wy);
      const obj = this.map.objects as Record<string, unknown>;
      if (w < 8 || h < 8) delete obj.escape;
      else obj.escape = [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
    }
    const changed = this.painting || this.lineMode || this.dragging || this.escapeFrom;
    this.painting = false;
    this.lineMode = false;
    this.lineStart = null;
    this.lastPaintCell = null;
    this.dragging = null;
    this.escapeFrom = null;
    this.panning = false;
    if (changed) this.commit();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const before = screenToWorld(this.view, mx, my);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.view.scale = Math.min(Math.max(this.view.scale * factor, 0.1), 4);
    this.view.offsetX = mx - before.x * this.view.scale;
    this.view.offsetY = my - before.y * this.view.scale;
    this.draw();
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.isTyping(e)) {
        this.spaceDown = true;
        this.canvas.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection && !this.isTyping(e)) {
        e.preventDefault();
        this.pushUndo();
        deleteSelection(this.map, this.selection);
        this.selection = null;
        this.commit();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.canvas.style.cursor = 'crosshair';
      }
    });
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  // --- inspector -----------------------------------------------------------

  private renderInspector(): void {
    const root = el('inspector');
    const action = this.activeAction();
    if (this.selection) {
      this.renderSelectionInspector(root, this.selection);
      return;
    }
    if (action.kind === 'patrol') {
      this.renderPatrolInspector(root);
      return;
    }
    if (action.kind === 'escape') {
      const has = Array.isArray((this.map.objects as Record<string, unknown>).escape);
      root.innerHTML = `<p class="muted">Drag on the map to set the escape zone — reach it in the loot-laden van to win.</p>${
        has ? '<button id="clearEscape" class="danger">Remove escape zone</button>' : ''
      }`;
      el('clearEscape')?.addEventListener('click', () => {
        this.pushUndo();
        delete (this.map.objects as Record<string, unknown>).escape;
        this.commit();
      });
      return;
    }
    root.innerHTML = '<p class="muted">Pick a tool on the left, then paint or click the map. Select an object (with its tool or Erase) to edit it here.</p>';
  }

  private renderSelectionInspector(root: HTMLElement, sel: Selection): void {
    if (sel.type === 'guard') {
      const g = guardObject(this.map, sel.index);
      if (!g) return;
      root.innerHTML = this.guardInspectorHtml(g);
      this.wireGuardInspector(sel.index);
    } else if (sel.type === 'camera') {
      const cams = (this.map.objects as Record<string, unknown>).security_cams as CameraObject[];
      const cam = cams[sel.index];
      root.innerHTML = this.cameraInspectorHtml(cam);
      this.wireCameraInspector(sel.index);
    } else if (sel.type === 'point') {
      root.innerHTML = `<p><strong>${sel.key.replace(/_/g, ' ')}</strong></p><p class="muted">A required spawn. Drag it on the map to move it; it can't be deleted.</p>`;
    } else if (sel.type === 'patrolPoint') {
      const route = this.map.patrolRoutes[sel.routeIndex];
      root.innerHTML = `<p><strong>Patrol waypoint ${sel.pointIndex + 1}</strong> of route “${route?.name ?? ''}”.</p><button id="delPoint" class="danger">Delete waypoint</button>`;
      el('delPoint')?.addEventListener('click', () => {
        this.pushUndo();
        deleteSelection(this.map, sel);
        this.selection = null;
        this.commit();
      });
    }
  }

  private guardInspectorHtml(g: GuardObject): string {
    const weaponOpts = ['Random', ...WEAPON_IDS]
      .map((w) => {
        const val = w === 'Random' ? '' : w;
        const selected = (g.weapon ?? '') === val ? 'selected' : '';
        return `<option value="${val}" ${selected}>${w}</option>`;
      })
      .join('');
    const shieldVal = g.riotShield === undefined ? '' : g.riotShield ? 'yes' : 'no';
    const shieldOpts = [
      ['', 'Random'],
      ['yes', 'Riot shield'],
      ['no', 'No shield'],
    ]
      .map(([v, l]) => `<option value="${v}" ${shieldVal === v ? 'selected' : ''}>${l}</option>`)
      .join('');
    const kind = g.behavior?.kind ?? 'random';
    const behaviorOpts = [
      ['random', 'Random wander'],
      ['stay', 'Stay put'],
      ['route', 'Follow a route'],
    ]
      .map(([v, l]) => `<option value="${v}" ${kind === v ? 'selected' : ''}>${l}</option>`)
      .join('');
    const routeNames = this.map.patrolRoutes.map((r) => r.name);
    const currentRoute = g.behavior && g.behavior.kind === 'route' ? g.behavior.route : '';
    const routeSelect =
      kind === 'route'
        ? routeNames.length > 0
          ? `<div class="field"><label>Route</label><select id="guardRoute">${routeNames
              .map((n) => `<option value="${n}" ${n === currentRoute ? 'selected' : ''}>${n}</option>`)
              .join('')}</select></div>`
          : '<p class="muted">No routes yet — draw one with the Patrol tool first.</p>'
        : '';
    return `
      <p><strong>Guard</strong></p>
      <div class="field"><label>Weapon</label><select id="guardWeapon">${weaponOpts}</select></div>
      <div class="field"><label>Shield</label><select id="guardShield">${shieldOpts}</select></div>
      <div class="field"><label>Behaviour</label><select id="guardBehavior">${behaviorOpts}</select></div>
      ${routeSelect}
      <div class="field"><label class="row"><input type="checkbox" id="guardBank" ${g.isBankManager ? 'checked' : ''}/> Bank manager (carries the vault key)</label></div>
      <button id="delGuard" class="danger">Delete guard</button>
    `;
  }

  private wireGuardInspector(index: number): void {
    const change = (patch: Partial<GuardObject>): void => {
      this.pushUndo();
      updateGuard(this.map, index, patch);
      this.commit();
    };
    el<HTMLSelectElement>('guardWeapon').addEventListener('change', (e) =>
      change({ weapon: ((e.target as HTMLSelectElement).value || undefined) as GuardObject['weapon'] }),
    );
    el<HTMLSelectElement>('guardShield').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      change({ riotShield: v === '' ? undefined : v === 'yes' });
    });
    el<HTMLSelectElement>('guardBehavior').addEventListener('change', (e) => {
      const kind = (e.target as HTMLSelectElement).value as GuardBehavior['kind'];
      let behavior: GuardBehavior = { kind: 'random' };
      if (kind === 'stay') behavior = { kind: 'stay' };
      else if (kind === 'route') behavior = { kind: 'route', route: this.map.patrolRoutes[0]?.name ?? '' };
      change({ behavior });
    });
    el<HTMLSelectElement>('guardRoute')?.addEventListener('change', (e) =>
      change({ behavior: { kind: 'route', route: (e.target as HTMLSelectElement).value } }),
    );
    el<HTMLInputElement>('guardBank').addEventListener('change', (e) =>
      change({ isBankManager: (e.target as HTMLInputElement).checked }),
    );
    el('delGuard').addEventListener('click', () => {
      this.pushUndo();
      deleteSelection(this.map, { type: 'guard', index });
      this.selection = null;
      this.commit();
    });
  }

  private cameraInspectorHtml(cam: CameraObject): string {
    const deg = (r: number): number => Math.round((r * 180) / Math.PI);
    return `
      <p><strong>Security camera</strong></p>
      <p class="muted">Sweep arc, in degrees (0° points right, grows clockwise).</p>
      <div class="field"><label>Sweep start: <span id="minLabel">${deg(cam.swivel_min)}</span>°</label>
        <input type="range" id="camMin" min="0" max="360" value="${deg(cam.swivel_min)}"/></div>
      <div class="field"><label>Sweep end: <span id="maxLabel">${deg(cam.swivel_max)}</span>°</label>
        <input type="range" id="camMax" min="0" max="360" value="${deg(cam.swivel_max)}"/></div>
      <button id="delCam" class="danger">Delete camera</button>
    `;
  }

  private wireCameraInspector(index: number): void {
    const rad = (d: string): number => (Number(d) * Math.PI) / 180;
    const apply = (patch: Partial<CameraObject>): void => {
      this.pushUndo();
      updateCamera(this.map, index, patch);
      this.commit();
    };
    const min = el<HTMLInputElement>('camMin');
    const max = el<HTMLInputElement>('camMax');
    min.addEventListener('input', () => {
      el('minLabel').textContent = min.value;
      apply({ swivel_min: rad(min.value) });
    });
    max.addEventListener('input', () => {
      el('maxLabel').textContent = max.value;
      apply({ swivel_max: rad(max.value) });
    });
    el('delCam').addEventListener('click', () => {
      this.pushUndo();
      deleteSelection(this.map, { type: 'camera', index });
      this.selection = null;
      this.commit();
    });
  }

  private renderPatrolInspector(root: HTMLElement): void {
    const routes = this.map.patrolRoutes;
    const options = routes
      .map((r, i) => `<option value="${i}" ${i === this.activeRoute ? 'selected' : ''}>${r.name} (${r.points.length})</option>`)
      .join('');
    root.innerHTML = `
      <p class="muted">Click the map to drop waypoints into the active route. Guards you set to “Follow a route” walk it in a loop.</p>
      <div class="field"><label>Active route</label>
        <select id="routeSelect">${options || '<option value="-1">— none yet —</option>'}</select></div>
      <div class="row">
        <button id="newRoute">New route</button>
        <button id="delRoute" class="danger" ${routes.length === 0 ? 'disabled' : ''}>Delete route</button>
      </div>
    `;
    el<HTMLSelectElement>('routeSelect').addEventListener('change', (e) => {
      this.activeRoute = Number((e.target as HTMLSelectElement).value);
      this.commit();
    });
    el('newRoute').addEventListener('click', () => {
      this.pushUndo();
      this.activeRoute = createRoute(this.map);
      this.commit();
    });
    el('delRoute').addEventListener('click', () => {
      if (this.activeRoute === null || !routes[this.activeRoute]) return;
      this.pushUndo();
      routes.splice(this.activeRoute, 1);
      this.activeRoute = routes.length > 0 ? 0 : null;
      this.commit();
    });
  }
}

/** Bresenham cell list between two cells (inclusive), for freehand + straight-line painting. */
function cellsBetween(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

export { Editor };

// Bootstrap only in a browser (guards against the module being imported in a non-DOM context).
if (typeof document !== 'undefined') {
  loadEditorAssets()
    .then((assets) => new Editor(assets).start())
    .catch((err) => {
      document.body.innerHTML = `<p style="color:#fff;padding:20px">Editor failed to load: ${
        err instanceof Error ? err.message : String(err)
      }</p>`;
    });
}
