Stealth_em_up
=============

A top-down stealth heist game. Grab the loot, get in the van, and drive to the green escape zone.

The game is written in [Odin](https://odin-lang.org) on [sokol](https://github.com/floooh/sokol-odin). It started
as a JavaScript/Pixi browser game, which was removed once this port became the main build. That version is
still in git history.

## Build and run

**Windows:** run `odin\build.bat run` from the repo root. You need `odin` and `git` on PATH, plus the
Visual Studio C++ build tools, which Odin already needs.

**Linux:** run `./odin/build.sh run`. You need `odin`, a C compiler and the X11/GL/ALSA headers. The script
tells you what's missing.

The first build fetches sokol and compiles its C libraries once. See [`odin/README.md`](odin/README.md) for
details, the code layout and controls.

## Co-op

Two to four robbers can pull the heist together over Steam. Click **Host Co-op** in the menu, invite friends from
the Steam overlay, then **Start Heist**. Steam has to be running. Until the game has its own Steam app ID it uses
Valve's test app (480); set `STEAM_APP_ID` to override. See [`odin/README.md`](odin/README.md#co-op).

## Layout

- `odin/`: the game (`odin/game/`), the physics engine (`odin/physics/`), build scripts, sounds and font.
- `images/`, `movie_clips/`, `maps/`, `data/`: runtime assets, read from the repo at startup.
- `maps/src/`: ASCII sources for the heists; `python3 maps/build_maps.py` turns them into `.jomap` files.
- `sound/`: the original audio files. The game plays the WAV conversions in `odin/assets/sound/`.
- `working_files/`: Tiled sources for the maps.

## Terms
- `LOS`: line of sight, which drives the fog of war. The shade is off by default (`enable_los` in `odin/game/fog.odin`).
