package game

// The running drop kick (Q while moving). The robber leaps in the direction they are running,
// lands, and gets back up:
//
//   .Air   KICK_AIR_MS of fixed-speed lunge. Input is ignored and the robber faces the kick.
//   .Land  KICK_LAND_MS on the floor before they can move again.
//
// Hits are decided by the host (or offline) in kick_hits, once per tick per airborne robber:
//   - a living guard is launched backwards and stunned (the melee stun path in car.odin);
//   - a dead body slides backwards (the van's knockback list);
//   - a closed door that is not reinforced is smashed open for good, locked or not;
//   - a reinforced door, or a wall, just stops the kick.
// The first thing hit ends the lunge. A remote robber lunges on its own machine (it drives
// its own position), so the host tells it with net_ev_kick_land when a hit cut the kick short.
//
// Cost: a distance check per guard per tick, only while someone is airborne, plus one grid
// lookup. Nothing runs while nobody is kicking.

import "core:math"

Kick_State :: enum u8 { None, Air, Land }

KICK_SPEED_PX_S :: 780.0 // about twice the sprint speed; covers ~170 px in the air
KICK_AIR_MS :: 220.0
KICK_LAND_MS :: 380.0
KICK_REACH_PX :: 10.0 // past touching, so the kick lands just before the bodies meet
KICK_KNOCKBACK_PX_S :: 1400.0 // decays by KNOCKBACK_DECAY per tick: ~230 px of flight
KICK_STUN_MS :: 1800.0
KICK_BODY_PX_S :: 700.0
KICK_BODY_MS :: 300.0
KICK_SUSPICION_MS :: 2500.0
KICK_DOOR_HEAR_PX :: 240.0 // a door coming off its hinges is heard by calm guards this close
KICK_DOOR_TINT :: 0x8a5a2b
KICK_AIR_SCALE :: 1.25
KICK_LAND_SCALE :: 0.9

// Starts a kick for the bound robber if they are running. Runs on the host for every robber
// (a client's press is replayed there) and on a client for its own robber.
kick_start :: proc() -> bool {
	h := hero
	if h == nil || !h.alive || h.in_car || h.kick_state != .None do return false
	if hero_drag_target != nil || h.lockpicking || h.planting_bomb do return false
	dx, dy := 0.0, 0.0
	if keys.w do dy -= 1
	else if keys.s do dy += 1
	if keys.d do dx += 1
	else if keys.a do dx -= 1
	if dx == 0 && dy == 0 {
		if bound_is_local() do new_floating_message("Get a running start!", h.x, h.y, 0xFFaa00)
		return false
	}
	l := math.sqrt(dx * dx + dy * dy)
	h.kick_dx = dx / l
	h.kick_dy = dy / l
	h.kick_state = .Air
	h.kick_until = clock_now() + KICK_AIR_MS
	h.spyglass_equipped = false
	return true
}

// Advances the phase timers and, while the kick owns the robber, drives them.
// Returns true when the normal walking code should not move them this tick.
kick_drive :: proc(h: ^Sprite) -> bool {
	if !kick_tick(h) do return false
	if h.kick_state == .Air {
		if physics_has_actor(h) {
			physics_set_velocity(h, h.kick_dx * KICK_SPEED_PX_S, h.kick_dy * KICK_SPEED_PX_S)
		} else {
			h.x += h.kick_dx * KICK_SPEED_PX_S / TICKS_PER_SECOND
			h.y += h.kick_dy * KICK_SPEED_PX_S / TICKS_PER_SECOND
		}
	} else if physics_has_actor(h) {
		physics_stop(h)
	}
	return true
}

// Only the phase timers: the host runs this for a robber that walks on its own machine.
kick_tick :: proc(h: ^Sprite) -> bool {
	if h.kick_state == .None do return false
	now := clock_now()
	if h.kick_state == .Air && now >= h.kick_until do kick_land(h)
	if h.kick_state == .Land && now >= h.kick_until do h.kick_state = .None
	if !h.alive || h.in_car do h.kick_state = .None
	return h.kick_state != .None
}

kick_land :: proc(h: ^Sprite) {
	if h.kick_state != .Air do return
	h.kick_state = .Land
	h.kick_until = clock_now() + KICK_LAND_MS
	if physics_has_actor(h) do physics_stop(h)
}

// Faces the kick and poses the sprite (bigger in the air, flat on landing).
kick_pose :: #force_inline proc(h: ^Sprite) {
	switch h.kick_state {
	case .None: h.sprite.scale = {1, 1}
	case .Air:
		h.rad = math.atan2(h.kick_dy, h.kick_dx)
		h.sprite.scale = {KICK_AIR_SCALE, KICK_AIR_SCALE}
	case .Land:
		h.rad = math.atan2(h.kick_dy, h.kick_dx)
		h.sprite.scale = {KICK_LAND_SCALE, KICK_LAND_SCALE}
	}
}

// Host / offline: what the bound robber's kick connects with this tick.
kick_hits :: proc() {
	h := hero
	if h.kick_state != .Air || !h.alive do return
	now := clock_now()
	hit := false
	for g in guards {
		if g.being_choked_out do continue
		dx := g.x - h.x
		dy := g.y - h.y
		dist := math.sqrt(dx * dx + dy * dy)
		if dist > h.radius + g.radius + KICK_REACH_PX do continue
		// only what is in front of the boots
		if dist > 0.001 && dx * h.kick_dx + dy * h.kick_dy <= 0 do continue
		if g.alive {
			if is_stunned(g, now) do continue
			if physics_has_actor(g) do physics_set_velocity(g, h.kick_dx * KICK_KNOCKBACK_PX_S, h.kick_dy * KICK_KNOCKBACK_PX_S)
			g.stunned_until = now + KICK_STUN_MS
			g.dodge_until = 0
			g.moving = true
			clear_path(g)
			g.target = null_point()
			// a guard knows when they have been drop-kicked, seen or not
			guard_see_alarming_object(g)
			new_floating_message("Oof!", g.x, g.y, 0xFFaa00)
		} else {
			if kick_body_already_sliding(g) do continue
			append(&car.knockbacks, Knockback{g, h.kick_dx * KICK_BODY_PX_S, h.kick_dy * KICK_BODY_PX_S, KICK_BODY_MS})
		}
		hit = true
	}
	if !hit do hit = kick_door(h)
	if hit {
		hero_mark_kick_suspicious(h, KICK_SUSPICION_MS)
		if bound_is_local() do cam_start_shake(6, 0.6)
		kick_land(h)
		net_ev_kick_land(bound_player)
	}
}

kick_body_already_sliding :: proc(g: ^Sprite) -> bool {
	for k in car.knockbacks do if k.sprite == g do return true
	return false
}

// The cell just past the boots. A closed door there is smashed unless it is reinforced; a
// reinforced door or a wall stops the kick. Returns true when the kick connected.
kick_door :: proc(h: ^Sprite) -> bool {
	reach := h.radius + KICK_REACH_PX
	px := h.x + h.kick_dx * reach
	py := h.y + h.kick_dy * reach
	c := grid_cell_at_coords(px, py)
	if c == nil || !c.solid do return false
	if !c.door do return true
	for d in grid.door_sprites {
		if d.door_cell != c do continue
		if d.reinforced {
			new_floating_message("Reinforced!", px, py, 0xFFaa00)
			return true
		}
		door_kick_open(d)
		return true
	}
	return true
}

door_kick_open :: proc(d: ^Sprite) {
	cs := f64(grid.cell_size)
	cx := d.door_cell.x + cs / 2
	cy := d.door_cell.y + cs / 2
	kick_cancel_lockpicks(d)
	door_open(d)
	d.broken = true
	d.unlocked = true
	grenade_blast_particles(cx, cy, cs / 2, KICK_DOOR_TINT)
	new_floating_message("CRASH!", cx, cy, 0xFFFFFF)
	kick_door_heard(cx, cy)
}

// Anyone picking this lock no longer needs to.
kick_cancel_lockpicks :: proc(d: ^Sprite) {
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		if hero.lockpicking && prog_bar.visible && prog_bar.callback == .Unlock && prog_bar.cb_sprite == d {
			prog_stop()
			hero.lockpicking = false
			grid.a_door_is_being_unlocked = false
		}
		player_switch(prev)
	}
}

// Like a smoke or flash grenade going off: calm guards close by come to look.
kick_door_heard :: proc(cx, cy: f64) {
	now := clock_now()
	any_heard := false
	for g in guards {
		if !g.alive || g.being_choked_out do continue
		if g.blind_until != 0 && now < g.blind_until do continue
		if get_distance(cx, cy, g.x, g.y) <= KICK_DOOR_HEAR_PX {
			g.saw_hero_last_at = {cx, cy}
			guard_see_alarming_object(g)
			any_heard = true
		}
	}
	if any_heard do squad_update_belief(cx, cy, now)
}

hero_mark_kick_suspicious :: proc(h: ^Sprite, duration_ms: f64) {
	until := clock_now() + duration_ms
	if until > h.kick_suspicious_until do h.kick_suspicious_until = until
}
