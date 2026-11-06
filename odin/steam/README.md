# Steamworks runtime

The two redistributable libraries from the Steamworks SDK 1.65 (`redistributable_bin/`), which co-op loads at
runtime: `win64/steam_api64.dll` and `linux64/libsteam_api.so`. The build scripts copy the right one next to
the executable. The game does not link against them, so it starts and plays solo without Steam.

Nothing else from the SDK is needed: `game/net_transport.odin` declares the few flat-API calls it uses.
