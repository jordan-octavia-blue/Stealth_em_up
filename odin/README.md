# Stealth 'em Up: Odin + Sokol port

This is a native desktop port of the web game (`game.html`). It uses [Odin](https://odin-lang.org) and
[sokol-odin](https://github.com/floooh/sokol-odin). The gameplay is a line-for-line port of the TypeScript sources and
is meant to feel identical: the fixed 60 Hz simulation, guard AI and squad tactics, physics, fog of
war, grenades, the van, breaching and the debug overlays. Only the menu is different.

## Build and run (Linux)

Requirements: an Odin compiler (tested with `dev-2026-11`), a C compiler, and the X11/GL/ALSA dev headers
(`libx11-dev libxi-dev libxcursor-dev libgl-dev libasound2-dev`).

```sh
./odin/build.sh          # -> odin/bin/stealth_em_up (optimised)
./odin/build.sh run      # build, then run from the repo root
./odin/build.sh debug    # -debug build
```

The first build clones sokol-odin at a pinned commit into `odin/third_party/` (git-ignored) and compiles the
sokol C libraries, including the ALSA backend of sokol_audio. Set `SOKOL_ODIN_DIR` to use an existing checkout.

The game reads its assets from the repo (`images/`, `movie_clips/`, `maps/`, `data/`) plus `odin/assets/`
(sounds converted to WAV and the Liberation Sans font). It finds the repo root by searching upward from the
working directory and from the executable.

Set `STEALTH_AUTOSTART=1` to skip the menu.

## Controls

These are the same bindings as `src/systems/input.ts`. The menu lists them too (`CONTROLS` in `game/ui.odin`).
Press Esc during play to return to the menu.

## Layout

| File | Ports |
|---|---|
| `game/main.odin` | the window, frame loop and event plumbing |
| `game/render.odin`, `game/core.odin`, `game/text.odin` | the Pixi v3 subset: scene graph, Graphics, MovieClip, Text, ParticleContainer |
| `physics/` | the planck.js (Box2D v2) subset the game uses |
| `game/phys.odin` | `src/physics/world.ts` |
| `game/nav.odin`, `game/squad.odin` | `src/nav/*`, `src/systems/squad.ts` |
| `game/game.odin` | `src/legacy/main.ts` and `camera.ts` |
| `game/sprite.odin` | jo_sprite, the hero, guards, cameras, doors and guns |
| `game/grid.odin` | the map loader, tile grid, autotiling and breach damage |
| `game/fog.odin` | the fog of war; visibility polygons are cut out with the stencil buffer |
| `game/effects.odin` | particles and the baked blood trail |
| `game/car.odin` | the van and melee |
| `game/grenades.odin` | weapons data and grenades |
| `game/audio.odin` | the sound manager and the synthesized van engine |
| `game/input.odin` | keyboard and mouse handlers |
| `game/ui.odin` | the progress bar, buttons, menu and stats |
| `game/debug.odin` | the N, B and H overlays |

## Intentional differences from the web build

- **Menu:** a native screen replaces `game.html`'s HTML instructions. It shows the controls, the stats and a Start
  button. Esc goes back to it, and "Play Again" restarts directly.
- **Stats:** the localStorage counters (wins, losses, guards shot and choked) live in
  `~/.local/share/stealth_em_up/stats.txt`.
- **Text:** text is drawn with Liberation Sans through fontstash at the on-screen size, so zoomed text stays sharp.
  Box metrics follow Pixi's, so anchored labels sit in the same places.
- **Audio:** audio is mono at 44.1 kHz. Each web `<audio>` element is one voice that restarts on play, and the
  seven-element gun-shot pool is a seven-voice round-robin.
- **No FPS meter.**
