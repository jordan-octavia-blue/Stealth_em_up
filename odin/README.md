# Stealth 'em Up: Odin + Sokol port

This is the game: a native desktop port of the original JavaScript/Pixi browser version, which has since been
removed but is still in git history. It uses [Odin](https://odin-lang.org) and
[sokol-odin](https://github.com/floooh/sokol-odin). The gameplay is a line-for-line port of the TypeScript sources and
feels identical: the fixed 60 Hz simulation, guard AI and squad tactics, physics, fog of
war, grenades, the van, breaching and the debug overlays. Only the menu is different.

## Build and run

### Windows

Requirements: `odin` and `git` on PATH, plus the Visual Studio C++ build tools, which Odin already needs for
linking ("Build Tools for Visual Studio", "Desktop development with C++" workload).

```bat
odin\build.bat          :: -> odin\bin\stealth_em_up.exe
odin\build.bat run      :: build, then run from the repo root
odin\build.bat debug    :: -debug build with a console window
```

On the first build, the script fetches sokol-odin at a pinned commit and compiles its C libraries with `cl`. It
finds Visual Studio itself through `vswhere`, so it doesn't need a Developer Command Prompt. Later builds only
run `odin build`. The game renders through sokol's OpenGL backend (`-define:SOKOL_USE_GL=true`), the same
renderer the Linux build uses. Stats are stored in `%APPDATA%\stealth_em_up\stats.txt`.

### Linux

Requirements: an Odin compiler (tested with `dev-2026-11`), a C compiler, and the X11/GL/ALSA dev headers
(`build-essential libx11-dev libxi-dev libxcursor-dev libgl-dev libasound2-dev` on Debian/Ubuntu). If anything
is missing, `build.sh` says so and prints the install command.

```sh
./odin/build.sh          # -> odin/bin/stealth_em_up (optimised)
./odin/build.sh run      # build, then run from the repo root
./odin/build.sh debug    # -debug build
```

On the first build, the script clones sokol-odin at a pinned commit into `odin/third_party/` (git-ignored) and
compiles the sokol C libraries, including the ALSA backend of sokol_audio. Set `SOKOL_ODIN_DIR` to use an
existing checkout.

The game reads its assets from the repo (`images/`, `movie_clips/`, `maps/`, `data/`) plus `odin/assets/`
(sounds converted to WAV and the Liberation Sans font). It finds the repo root by searching upward from the
working directory and from the executable.

Set `STEALTH_AUTOSTART=1` to skip the menu.

## Co-op

Two to four robbers in one heist. The menu has **Host Co-op** (Steam) and **Host on LAN** (plain UDP on port
27015). A host's lobby lists the crew and has **Start Heist**, **Invite Friends** (opens the Steam overlay) and
**Leave**.

- **Steam:** the game loads `steam_api64.dll` / `libsteam_api.so` at runtime (they're in `odin/steam/`, and the
  build scripts copy them into `odin/bin/`), so it still starts and plays solo without Steam. It uses Steam lobbies
  for invites and `ISteamNetworkingMessages` for P2P traffic through Steam's relays, so no port forwarding is
  needed. The app ID is 480 (Valve's Spacewar test app) unless `STEAM_APP_ID` is set. A friend who accepts an
  invite while the game is closed gets it launched with `+connect_lobby <id>`.
- **LAN / testing:** `STEALTH_HOST=1` hosts over UDP at startup and `STEALTH_JOIN=<ip>[:port]` joins. The UDP
  transport has no reliability layer, so keep it to a LAN or one machine.

Rules: there is no joining a heist in progress. A downed robber drops the loot and spectates, and the heist is
lost when every robber is down. The van seats a driver plus passengers. Esc takes the host's whole crew back to
the lobby; a client's Esc leaves the crew.

How it works (`game/players.odin`, `game/net.odin`, `game/net_transport.odin`):

- The host runs the full simulation with every robber in it. Each robber's input state lives in `players[]`, and
  `player_switch(i)` swaps it into the globals the single-player code reads (`hero`, `keys`, `mouse`, ...). With
  one player that is exactly the single-player path.
- Clients run no AI or game rules. A client moves its own robber locally (so walking feels the same) and sends its
  position and mouse every tick. Key and button presses go to the host reliably, and the host replays them
  through the normal handlers with that player bound.
- The host sends a snapshot every other tick (30 Hz, unreliable) that clients smooth toward, plus a reliable event
  stream for one-shot things: sounds, messages, particles, bullets, wall damage, grenades, explosions, alerts and
  the end of the heist. Effects that a client replays itself (for example the shards from wall damage) are
  wrapped in `net.mute` on the host so they aren't sent twice.
- Both sides seed the RNG with the host's seed before `start_game`, so the map setup matches.
- Cost: offline play only pays a few `net.role` checks on effect calls. A host serialises a ~1-2 KB snapshot
  every other tick; clients skip the AI, nav and squad updates.

## Heists

The menu picks one of four heists, easiest first (`MAPS` in `game/grid.odin`): Corner Store, Jewelry Store, the
original First National Bank, and Federal Reserve. In co-op the host picks and the crew sees the choice. After a
win, **Next Heist** moves to the next one. The choice is remembered in the stats file. `STEALTH_MAP=1`..`4` picks
one at startup (handy with `STEALTH_AUTOSTART=1`).

The new maps are drawn as ASCII in `maps/src/*.txt` (the legend is at the top of `maps/build_maps.py`). Run
`python3 maps/build_maps.py` after editing one. It checks that the robber can reach the loot and the van, that the
van can drive to the escape zone, and where each camera can hang.

## Controls

The handlers are in `game/input.odin`, and the menu lists the bindings (`CONTROLS` in `game/ui.odin`). Keep the two in sync.
Press Esc during play to return to the menu.

## Layout

The right-hand column names the TypeScript each file was ported from, which is in git history.

| File | Ported from |
|---|---|
| `game/main.odin` | the window, frame loop and event plumbing |
| `game/render.odin`, `game/core.odin`, `game/text.odin` | the Pixi v3 subset: scene graph, Graphics, MovieClip, Text, ParticleContainer |
| `physics/` | the planck.js (Box2D v2) subset the game uses |
| `game/phys.odin` | `src/physics/world.ts` |
| `game/nav.odin`, `game/squad.odin` | `src/nav/*`, `src/systems/squad.ts` |
| `game/game.odin` | `src/legacy/main.ts` and `camera.ts` |
| `game/sprite.odin` | jo_sprite, the hero, guards, cameras, doors and guns |
| `game/grid.odin` | the map loader, tile grid, autotiling and breach damage |
| `game/fog.odin` | the fog of war; visibility polygons are cut out with the stencil buffer. Off by default (`enable_los`) |
| `game/effects.odin` | particles and the baked blood trail |
| `game/car.odin` | the van and melee |
| `game/kick.odin` | the running drop kick (Q): knockback, smashing doors, reinforced doors |
| `game/grenades.odin` | weapons data and grenades |
| `game/audio.odin` | the sound manager and the synthesized van engine |
| `game/input.odin` | keyboard and mouse handlers |
| `game/ui.odin` | the progress bar, buttons, menu and stats |
| `game/debug.odin` | the N, B and H overlays |
| `game/players.odin`, `game/net.odin`, `game/net_transport.odin` | new: co-op players, netcode, UDP and Steam transports |

## Intentional differences from the web build

- **Menu:** a native screen replaces `game.html`'s HTML instructions. It shows the controls, the stats and a Start
  button. Esc goes back to it, and "Play Again" restarts directly.
- **Stats:** the localStorage counters (wins, losses, guards shot and choked) live in a text file:
  `~/.local/share/stealth_em_up/stats.txt` on Linux, or `%APPDATA%\stealth_em_up\stats.txt` on Windows.
- **Text:** text is drawn with Liberation Sans through fontstash at the on-screen size, so zoomed text stays sharp.
  Box metrics follow Pixi's, so anchored labels sit in the same places.
- **Audio:** audio is mono at 44.1 kHz. Each web `<audio>` element is one voice that restarts on play, and the
  seven-element gun-shot pool is a seven-voice round-robin.
- **No FPS meter.**
