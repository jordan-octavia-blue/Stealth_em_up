package game

import "core:fmt"

// Co-op spectating. Once the local robber is down and the crew is still in the heist, the
// camera follows a living teammate instead of the corpse. Space cycles between teammates.
// Purely local: nothing here touches the simulation or goes over the wire.
//
// Cost: a scan of at most MAX_PLAYERS slots per rendered step, only while dead.

SPECTATE_SMOOTH :: 0.12 // per-step ease toward the followed robber, so a switch glides

spectate: struct {
	target:    int, // player index being followed, -1 for none
	following: bool, // the camera has been easing toward `target`
	pos:       Point,
	key_down:  bool,
}

spectate_reset :: proc() {
	spectate = {target = -1}
}

spectate_valid :: proc(i: int) -> bool {
	if i < 0 || i >= MAX_PLAYERS || i == local_player do return false
	p := players[i]
	return p.active && p.hero != nil && p.hero.alive
}

// The next living teammate after `from` in direction `dir`, or -1.
spectate_next :: proc(from, dir: int) -> int {
	for k in 1 ..= MAX_PLAYERS {
		i := (from + dir * k) %% MAX_PLAYERS
		if spectate_valid(i) do return i
	}
	return -1
}

// The robber the camera should follow instead of the local one, or nil while the local
// robber is alive (or nobody is left). Keeps following the same teammate until they drop.
spectate_hero :: proc() -> ^Sprite {
	if hero == nil || hero.alive || player_count() < 2 {
		spectate.target = -1
		spectate.following = false
		return nil
	}
	if !spectate_valid(spectate.target) do spectate.target = spectate_next(spectate.target < 0 ? local_player : spectate.target, 1)
	if spectate.target < 0 {
		spectate.following = false
		return nil
	}
	return players[spectate.target].hero
}

// Space while down: watch the next living teammate.
spectate_cycle :: proc() {
	if hero == nil || hero.alive || spectate.target < 0 do return
	t := spectate_next(spectate.target, 1)
	if t < 0 || t == spectate.target do return
	spectate.target = t
	local_message(fmt.tprintf("Watching robber %d", t + 1))
}

// Key handling for a downed local robber. Returns true when the key was consumed.
spectate_on_key :: proc(code: int, down: bool) -> bool {
	if hero == nil || hero.alive || code != 32 do return false
	if down && !spectate.key_down do spectate_cycle()
	spectate.key_down = down
	return true
}

// The point the camera centres on while spectating; eases there so switching glides.
spectate_camera_point :: proc(h: ^Sprite) -> Point {
	want := Point{h.x, h.y}
	if h.in_car && car.van != nil do want = {car.van.x, car.van.y}
	if !spectate.following {
		spectate.following = true
		spectate.pos = {camera.x, camera.y}
	}
	spectate.pos.x += (want.x - spectate.pos.x) * SPECTATE_SMOOTH
	spectate.pos.y += (want.y - spectate.pos.y) * SPECTATE_SMOOTH
	return spectate.pos
}
