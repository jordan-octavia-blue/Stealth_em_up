#!/usr/bin/env bash
# Builds the Odin + Sokol port of Stealth em Up (Linux, GL core).
#   ./odin/build.sh            -> odin/bin/stealth_em_up
#   ./odin/build.sh run        -> build and run from the repo root
#   ./odin/build.sh debug      -> build with -debug (no -o:speed)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SOKOL_COMMIT=60dd3a7c55246cca9a6cf2d34664a8861414f0fe
SOKOL_DIR="${SOKOL_ODIN_DIR:-$HERE/third_party/sokol-odin}"

if [ ! -d "$SOKOL_DIR/sokol" ]; then
  mkdir -p "$(dirname "$SOKOL_DIR")"
  git clone https://github.com/floooh/sokol-odin "$SOKOL_DIR"
  git -C "$SOKOL_DIR" checkout -q "$SOKOL_COMMIT"
fi

S="$SOKOL_DIR/sokol"
build_lib() { # src dst
  if [ ! -f "$S/$2.a" ]; then
    echo "cc $1"
    (cd "$S" && cc -pthread -c -O2 -DNDEBUG -DIMPL -DSOKOL_GLCORE "c/$1.c" -o "/tmp/$1.$$.o" && ar rcs "$2.a" "/tmp/$1.$$.o" && rm "/tmp/$1.$$.o")
  fi
}
build_lib sokol_log       log/sokol_log_linux_x64_gl_release
build_lib sokol_gfx       gfx/sokol_gfx_linux_x64_gl_release
build_lib sokol_app       app/sokol_app_linux_x64_gl_release
build_lib sokol_glue      glue/sokol_glue_linux_x64_gl_release
build_lib sokol_time      time/sokol_time_linux_x64_gl_release
build_lib sokol_gl        gl/sokol_gl_linux_x64_gl_release

# sokol_audio: the upstream binding links PulseAudio; we build the ALSA backend
# into our own archive and bind the handful of calls we need ourselves.
mkdir -p "$HERE/build"
if [ ! -f "$HERE/build/libsokol_audio_alsa.a" ]; then
  echo "cc sokol_audio (ALSA)"
  (cd "$S" && cc -pthread -c -O2 -DNDEBUG -DIMPL -DSOKOL_GLCORE -DSAUDIO_USE_ALSA c/sokol_audio.c -o "$HERE/build/sokol_audio_alsa.o")
  ar rcs "$HERE/build/libsokol_audio_alsa.a" "$HERE/build/sokol_audio_alsa.o"
fi

# The game imports "sokol:app" etc; expose the checkout as a collection.
mkdir -p "$HERE/bin"
FLAGS=(-collection:sokol="$S" -collection:physics="$HERE/physics" -out:"$HERE/bin/stealth_em_up")
if [ "${1:-}" = "debug" ]; then FLAGS+=(-debug); else FLAGS+=(-o:speed); fi
odin build "$HERE/game" "${FLAGS[@]}"
echo "built $HERE/bin/stealth_em_up"
if [ "${1:-}" = "run" ]; then cd "$HERE/.." && "$HERE/bin/stealth_em_up"; fi
