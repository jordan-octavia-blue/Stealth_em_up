package game

// Co-op revive: stand on a downed crewmate's body and hold Space to bring them back.
//
// The host decides everything. A client's Space is replayed on the host (net_host_replay_input),
// which runs the revive channel on that player's progress bar like a lock-pick; the snapshot
// already carries every player's bar and P_ALIVE, so a client sees the bar fill and its robber
// stand back up without any new event. Reviving wins over the drop kick, the lock-pick and
// dragging: whenever a downed ally is within reach, Space revives.
//
// Cost: revive_target is a scan of at most four players, run on a Space press and once a frame
// for the local robber's tooltip.

REVIVE_MS :: 3000.0

// The downed crewmate the bound robber is standing on, or nil. Never in single player.
revive_target :: proc() -> ^Sprite {
	h := hero
	if h == nil || !h.alive || h.in_car || player_count() < 2 do return nil
	reach := h.radius * drag_distance
	for p, i in players {
		if !p.active || i == bound_player || p.hero == nil do continue
		o := p.hero
		if !o.alive && get_distance(h.x, h.y, o.x, o.y) <= reach do return o
	}
	return nil
}

// Space pressed: starts the revive channel if a downed ally is in reach. Host and offline only.
revive_start :: proc() -> bool {
	if hero_drag_target != nil || hero.lockpicking || hero.kick_state != .None do return false
	t := revive_target()
	if t == nil do return false
	prog_reset(t.x, t.y, REVIVE_MS, .Revive, nil, t)
	// walking off the body cancels it, like walking away from a lock
	prog_bar.cancel_target = {t.x, t.y}
	prog_bar.has_cancel_target = true
	hero.reviving = true
	return true
}

// Space released before the bar filled.
revive_cancel :: proc() {
	if prog_bar.visible && prog_bar.callback == .Revive do prog_stop()
	hero.reviving = false
}

// The bar filled: the bound robber has brought `t` back.
revive_finish :: proc(t: ^Sprite) {
	hero.reviving = false
	if t == nil || t.alive || !hero.alive do return
	hero_revive(t)
}

// Stands a downed robber back up where they fell, with their gear and a fresh life.
hero_revive :: proc(h: ^Sprite) {
	if h.alive do return
	prev := player_switch(h.player_id)
	defer player_switch(prev)
	h.alive = true
	h.health = 1
	h.moving = true // robbers always steer toward their key target (new_sprite_obj)
	h.kick_state = .None
	h.lockpicking = false
	h.planting_bomb = false
	h.reloading = false // a reload cut short by death (hero_kill stops the bar)
	h.reviving = false
	h.speed = h.speed_walk
	clear_path(h)
	h.target = null_point()
	physics_add_hero(h, h.radius)
	physics_teleport(h, h.x, h.y)
	if h.sprite_head.parent == nil do add_child(h.sprite, h.sprite_head)
	set_hero_image()
	keys = {}
	key_handlers_enabled = true
	mouse_handlers_enabled = true
	if bound_is_local() {
		set_text(message_game_over, "")
		spectate_reset() // the camera comes back to this robber
	}
	new_floating_message("Back on their feet!", h.x, h.y, 0x66ff66)
}

// The local robber's hint when standing on a downed crewmate. Host, offline and client.
revive_tooltip :: proc() {
	if prog_bar.visible do return
	if t := revive_target(); t != nil do show_tooltip("[Hold Space] to revive", t.x, t.y - 32)
}
