package game

// Every runtime asset is compiled into the executable, so a shipped stealth_em_up.exe
// runs on its own from any folder. When the game is started inside a checkout (the repo
// root is found, see find_asset_root), files are read from disk instead, so editing a
// map or data/*.json takes effect without a rebuild.

import "base:runtime"
import "core:os"
import "core:slice"
import "core:strings"

@(private = "file")
Embedded_Dir :: struct {
	prefix: string,
	files:  []runtime.Load_Directory_File,
}

// Paths are relative to this file. Only the folders the game reads at runtime.
@(private = "file")
embedded_dirs := [?]Embedded_Dir {
	{"images/", #load_directory("../../images")},
	{"movie_clips/", #load_directory("../../movie_clips")},
	{"maps/", #load_directory("../../maps")},
	{"data/", #load_directory("../../data")},
	{"odin/assets/sound/", #load_directory("../assets/sound")},
	{"odin/assets/fonts/", #load_directory("../assets/fonts")},
}

@(private = "file")
embedded: map[string][]byte

// True when find_asset_root located a checkout; otherwise only the embedded copies are used.
assets_on_disk: bool

assets_init :: proc() {
	for d in embedded_dirs {
		for f in d.files do embedded[strings.concatenate({d.prefix, f.name})] = f.data
	}
}

// Returns an owned copy (free it with delete), from disk in a checkout or else from the
// copy embedded in the executable. `rel` uses forward slashes, e.g. "images/tile_red.png".
read_asset :: proc(rel: string, allocator := context.allocator) -> (data: []byte, ok: bool) {
	if assets_on_disk {
		d, err := os.read_entire_file(asset_path(rel), allocator)
		if err == nil do return d, true
	}
	if e, found := embedded[rel]; found do return slice.clone(e, allocator), true
	return nil, false
}
