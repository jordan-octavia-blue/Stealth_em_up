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
(`addKeyHandlers`), with the debug-overlay cycles in `src/systems/nav_debug.ts`,
`src/systems/physics_debug.ts`, and `src/systems/breach_debug.ts`.

The player-facing list of controls lives in the menu (`menu.html`, the "Controls" screen).
When you add, remove, or rebind a key in `input.ts` — including the bomb (`F`) and the debug
overlays (`N` / `B` / `H`) — update that menu list to match so the two never drift apart.
