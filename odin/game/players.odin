package game

// Co-op players. The single-player code reads its robber through a handful of globals
// (`hero`, `keys`, `mouse`, `hero_drag_target`, `prog_bar`, the spyglass, ...). Rather than
// thread a player through every proc, each player keeps its own copy of that state, and
// `player_switch` swaps a player's copy into the globals. Between per-player sections the
// globals always hold the local player, so rendering, the camera and the fog keep reading
// them unchanged, and with one player the game runs exactly the single-player code path.
//
// Cost: a switch copies ~300 bytes each way; the host does a few per player per tick plus one
// per guard that sees a robber, so it is negligible next to a physics step.

MAX_PLAYERS :: 4

Player :: struct {
	active:           bool,
	is_local:         bool,
	hero:             ^Sprite,
	keys:             Keys,
	mouse:            Point,
	end_aim:          Point,
	drag_target:      ^Sprite,
	moving_anim:      bool,
	prog:             type_of(prog_bar),
	spyglass_pos:     Point,
	spyglass_in_door: bool,
	spyglass_valid:   bool,
	key_handlers:     bool,
	mouse_handlers:   bool,
}

players: [MAX_PLAYERS]Player
local_player: int // index of the player this machine controls
bound_player: int // whose state the globals hold right now

player_save :: proc() {
	p := &players[bound_player]
	p.hero = hero
	p.keys = keys
	p.mouse = mouse
	p.end_aim = hero_end_aim
	p.drag_target = hero_drag_target
	p.moving_anim = hero_moving_anim
	p.prog = prog_bar
	p.spyglass_pos = spyglass_pos
	p.spyglass_in_door = spyglass_in_door
	p.spyglass_valid = spyglass_valid
	p.key_handlers = key_handlers_enabled
	p.mouse_handlers = mouse_handlers_enabled
}

player_load :: proc(i: int) {
	bound_player = i
	p := &players[i]
	hero = p.hero
	keys = p.keys
	mouse = p.mouse
	hero_end_aim = p.end_aim
	hero_drag_target = p.drag_target
	hero_moving_anim = p.moving_anim
	prog_bar = p.prog
	spyglass_pos = p.spyglass_pos
	spyglass_in_door = p.spyglass_in_door
	spyglass_valid = p.spyglass_valid
	key_handlers_enabled = p.key_handlers
	mouse_handlers_enabled = p.mouse_handlers
}

// Makes player i's state live in the globals and returns who was bound before.
// Usage: prev := player_switch(i); defer player_switch(prev)
player_switch :: proc(i: int) -> int {
	prev := bound_player
	if i == bound_player do return prev
	player_save()
	player_load(i)
	return prev
}

bound_is_local :: #force_inline proc() -> bool { return bound_player == local_player }

player_count :: proc() -> int {
	n := 0
	for p in players do if p.active do n += 1
	return n
}

// The player whose robber is `h`, or -1.
player_of :: proc(h: ^Sprite) -> int {
	if h == nil || h.kind != .Hero do return -1
	return h.player_id
}

// The drag target of player i, wherever its state currently lives.
player_drag_target :: proc(i: int) -> ^Sprite {
	if i == bound_player do return hero_drag_target
	if i < 0 || i >= MAX_PLAYERS do return nil
	return players[i].drag_target
}

any_hero_alive :: proc() -> bool {
	for p in players do if p.active && p.hero != nil && p.hero.alive do return true
	return false
}

// Robbers spawn around the map's hero spawn: the first exactly on it (so single player is
// unchanged), the others on a small ring, skipping spots that overlap a wall.
SPAWN_OFFSETS := [MAX_PLAYERS]Point{{0, 0}, {40, 0}, {-40, 0}, {0, 40}}

players_reset :: proc() {
	players = {}
	bound_player = local_player
	spectate_reset()
}

// Creates player i's robber at the spawn. Called from setup_map with the globals unbound.
player_spawn :: proc(i: int, spawn: Point) {
	p := &players[i]
	p.active = true
	p.is_local = i == local_player
	h := new_hero(img_hero_body, 4, 8)
	h.player_id = i
	off := SPAWN_OFFSETS[i]
	h.x = spawn.x + off.x
	h.y = spawn.y + off.y
	if i != 0 && !physics_spot_clear_for_actor(h.x, h.y, h.radius) {
		h.x = spawn.x
		h.y = spawn.y
	}
	physics_add_hero(h, h.radius)
	h.speed = h.speed_walk
	p.hero = h
	p.drag_target = nil
	p.keys = {}
	p.mouse = {}
	p.key_handlers = true
	p.mouse_handlers = true
}

// Guards and cameras look for robbers. Returns the robber `observer` would react to:
// a suspicious (or face-known) robber it can see first, else any robber it can see, else
// the nearest robber (so aim and `currently_sees_hero` still have someone to point at).
pick_seen_hero :: proc(observer: ^Sprite) -> int {
	seen := -1
	nearest := -1
	best := max(f64)
	for p, i in players {
		if !p.active || p.hero == nil do continue
		h := p.hero
		d := get_distance(observer.x, observer.y, h.x, h.y)
		if d < best {
			best = d
			nearest = i
		}
		if sprite_sees(observer, h) {
			if hero_will_cause_alert(h) || guard_knows_face(observer, i) do return i
			if seen == -1 do seen = i
		}
	}
	if seen != -1 do return seen
	return nearest
}

guard_knows_face :: #force_inline proc(g: ^Sprite, player: int) -> bool {
	return player >= 0 && g.knows_face & (1 << uint(player)) != 0
}

guard_learn_face :: #force_inline proc(g: ^Sprite, player: int) {
	if player >= 0 do g.knows_face |= 1 << uint(player)
}

// Session membership, set by the network layer before start_game. Offline: just slot 0.
session_slots: [MAX_PLAYERS]bool = {true, false, false, false}

players_spawn_all :: proc(spawn: Point) {
	players_reset()
	for i in 0 ..< MAX_PLAYERS {
		if session_slots[i] do player_spawn(i, spawn)
	}
	player_load(local_player)
}
