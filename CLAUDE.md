# CLAUDE.md

Guidance for working in this repo. Start with `README.md` (how to run, layout) and
`docs/SYSTEMS_ROADMAP.md` (architecture and the phased modernization plan).

- `src/game.ts` is the `game.html` entry; `src/menu.ts` is `menu.html`'s.
- Legacy ES5, converted to ES modules, lives in `src/legacy/` and still shares state
  through `window` (see `src/legacy-bridge.ts` / `src/legacy-globals.d.ts`).
- Extracted subsystems live under `src/systems/`, `src/nav/`, `src/physics/`, `src/map/`,
  `src/render/`, `src/core/`.

## Controls

The keyboard/mouse handlers are the single source of truth — `src/systems/input.ts`
(`addKeyHandlers`). The menu's on-screen "Controls" list is in `menu.html`; keep it and this
section in sync with the handler when bindings change.

### Gameplay

| Action | Input | Notes |
|---|---|---|
| Move | `W` `A` `S` `D` | |
| Sprint | `Shift` (hold) | Disabled while dragging a body |
| Draw / holster weapon | `G` | Toggles `hero.gunOut`; hides the spyglass |
| Shoot | Left Click | Only while the weapon is drawn |
| Reload | `R` | |
| Pick up gun drop | Right Click | When standing on a dropped gun |
| Spyglass / binoculars | `P` | Toggles `hero.spyglass_equipped`; holsters the weapon |
| Put on / take off mask | `V` | |
| Place / detonate explosive | `F` | See "Bomb" below |
| Interact | `Space` | Lock-pick door, choke out / drag a guard, bug a camera, disable cameras (context-sensitive; hold to lock-pick or drag) |
| Zoom | Mouse Wheel | |
| Return to menu | `Esc` | |

### Bomb (`F`)

`F` is context-sensitive and depends on which bomb ability the hero has:

- **Timed bomb** (`hero.ability_timed_bomb`): press `F` to plant (1.5 s channel). The bomb
  detonates on a 5 s fuse. Consumes one charge from `bombs_left`; shows "No Bombs Left" when
  empty. This is how you breach a destructible wall / drywall.
- **Remote bomb** (`hero.ability_remote_bomb`): press `F` once to plant (1.5 s channel), then
  press `F` again to detonate. The tooltip switches to "Press 'f' to detonate" after planting.

Planting is blocked while a bomb is already placed and visible.

### Debug overlays

Each key cycles its overlay and shows the new mode as an in-game message. Handlers:
`src/systems/nav_debug.ts`, `src/systems/physics_debug.ts`, `src/systems/breach_debug.ts`.

| Key | Overlay | Modes (cycled in order) |
|---|---|---|
| `N` | Nav / pathfinding | off → paths → regions → danger → flow |
| `B` | Physics / fog | off → fixtures → occluders → polygon |
| `H` | Wall destruction | off → materials → hp |
