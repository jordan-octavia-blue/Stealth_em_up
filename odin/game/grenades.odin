package game

// systems/grenades.ts + systems/weapons.ts (data/weapons.json).

import "core:math"
import "core:encoding/json"
import "core:os"

Gun_Def :: struct { damage, loudness: f64 }
gun_defs: map[string]Gun_Def

Throwable_Def :: struct {
	id:           string,
	damage:       f64,
	loudness:     f64,
	fuse_ms:      f64,
	radius:       f64,
	duration_ms:  f64,
	blind_ms:     f64,
	has_blind_ms: bool,
	fx_damage, fx_breach, fx_loud, fx_vision_block, fx_blind: bool,
}
throwable_defs: map[string]Throwable_Def

load_weapons :: proc() -> bool {
	data, ok := read_asset("data/weapons.json")
	if !ok do return false
	v, jerr := json.parse(data)
	if jerr != nil do return false
	root := v.(json.Object)
	for g in root["guns"].(json.Array) {
		o := g.(json.Object)
		gun_defs[o["id"].(json.String)] = {jnum(o["damage"]), jnum(o["loudness"])}
	}
	for t in root["throwables"].(json.Array) {
		o := t.(json.Object)
		d: Throwable_Def
		d.id = o["id"].(json.String)
		d.damage = jnum(o["damage"])
		d.loudness = jnum(o["loudness"])
		d.fuse_ms = jnum(o["fuseMs"])
		d.radius = jnum(o["radius"])
		if x, ok := o["durationMs"]; ok do d.duration_ms = jnum(x)
		if x, ok := o["blindMs"]; ok {
			d.blind_ms = jnum(x)
			d.has_blind_ms = true
		}
		for e in o["effects"].(json.Array) {
			switch e.(json.String) {
			case "damage": d.fx_damage = true
			case "breach": d.fx_breach = true
			case "loud": d.fx_loud = true
			case "vision_block": d.fx_vision_block = true
			case "blind": d.fx_blind = true
			}
		}
		throwable_defs[d.id] = d
	}
	return true
}

THROW_SPEED_PX_PER_MS :: 0.8
THROW_MS_MIN :: 220.0
THROW_MS_MAX :: 1000.0
ARC_HEIGHT :: 0.5
CLOUD_CIRCLE_RADIUS_FACTOR :: 0.72
HEAR_PX_PER_LOUDNESS :: 80.0

Grenade_Phase :: enum u8 { Flying, Fuse, Cloud, Done }

Grenade :: struct {
	def:             Throwable_Def,
	start, target:   Point,
	throw_ms:        f64,
	elapsed:         f64,
	fuse_remaining:  f64,
	cloud_remaining: f64,
	phase:           Grenade_Phase,
	sprite:          ^Sprite,
	smoke_id:        int,
	smoke_cells:     [dynamic]int,
	cloud_fx:        ^Node,
	sighting:        ^Sprite, // the {x, y} proxy in alarming_objects
	net_id:          u32,
	cosmetic:        bool, // co-op client copy: never detonates by itself, waits for the host
}

grenades: [dynamic]^Grenade

Flash_Overlay :: struct { node: ^Node, a: f64 }
flash_overlays: [dynamic]Flash_Overlay

pdist :: #force_inline proc(a, b: Point) -> f64 { return math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) }

tint_for :: proc(id: string) -> u32 {
	switch id {
	case "frag": return 0xff5533
	case "smoke": return 0x9aa0a6
	case "flash": return 0xffe680
	}
	return 0xffffff
}

throw_grenade :: proc(type_id: string, target: Point) -> bool {
	start := hero != nil ? Point{hero.x, hero.y} : target
	g := grenade_spawn(type_id, start, target)
	if g == nil do return false
	net_ev_grenade(g)
	return true
}

grenade_spawn :: proc(type_id: string, start, target: Point) -> ^Grenade {
	def, ok := throwable_defs[type_id]
	if !ok do return nil
	g := new(Grenade)
	g.def = def
	g.start = start
	g.target = target
	g.throw_ms = clamp(pdist(start, target) / THROW_SPEED_PX_PER_MS, THROW_MS_MIN, THROW_MS_MAX)
	g.fuse_remaining = def.fuse_ms
	g.cloud_remaining = def.duration_ms
	g.phase = .Flying
	g.smoke_id = -1
	// makeSprite
	s := new_sprite_obj(.Basic, new_sprite(img_bomb), display_effects)
	s.sprite.anchor = {0.5, 0.5}
	s.sprite.scale = {0.3, 0.3}
	s.sprite.tint = tint_for(def.id)
	s.sprite.visible = true
	g.sprite = s
	grenade_register_sighting(g, start)
	append(&grenades, g)
	return g
}

grenade_register_sighting :: proc(g: ^Grenade, at: Point) {
	if g.sighting == nil {
		p := new(Sprite)
		p.reg_index = -1
		p.x = at.x
		p.y = at.y
		g.sighting = p
		append(&alarming_objects, p)
	} else {
		g.sighting.x = at.x
		g.sighting.y = at.y
	}
}

grenade_unregister_sighting :: proc(g: ^Grenade) {
	if g.sighting == nil do return
	for o, i in alarming_objects do if o == g.sighting {
		ordered_remove(&alarming_objects, i)
		break
	}
	free(g.sighting)
	g.sighting = nil
}

grenade_destroy_sprite :: proc(g: ^Grenade) {
	if g.sprite == nil do return
	g.sprite.sprite.visible = false
	remove_from_parent(g.sprite.sprite)
	g.sprite = nil
}

grenades_update :: proc(dt: f64) {
	for i := 0; i < len(grenades); i += 1 {
		g := grenades[i]
		grenade_step(g, dt)
		if g.phase == .Done {
			grenade_unregister_sighting(g)
			delete(g.smoke_cells)
			free(g)
			ordered_remove(&grenades, i)
			i -= 1
		}
	}
}

grenades_reset :: proc() {
	for g in grenades {
		grenade_tear_down_smoke(g)
		g.sprite = nil
		if g.sighting != nil do free(g.sighting)
		delete(g.smoke_cells)
		free(g)
	}
	clear(&grenades)
	clear(&flash_overlays)
}

grenade_step :: proc(g: ^Grenade, dt: f64) {
	switch g.phase {
	case .Flying:
		g.elapsed += dt
		t := g.throw_ms > 0 ? g.elapsed / g.throw_ms : 1
		c := clamp(t, 0, 1)
		px := g.start.x + (g.target.x - g.start.x) * c
		py := g.start.y + (g.target.y - g.start.y) * c
		scale := 1 + ARC_HEIGHT * math.sin(math.PI * c)
		if g.sprite != nil {
			g.sprite.x = px
			g.sprite.y = py
			g.sprite.sprite.scale = {0.3 * scale, 0.3 * scale}
			g.sprite.sprite.rotation += 0.3
			sprite_prepare_for_draw(g.sprite)
		}
		grenade_register_sighting(g, {px, py})
		if t >= 1 do g.phase = .Fuse
	case .Fuse:
		g.fuse_remaining -= dt
		if g.sprite != nil do sprite_prepare_for_draw(g.sprite)
		if g.fuse_remaining <= 0 && !g.cosmetic {
			grenade_detonate(g)
			if g.phase != .Cloud do g.phase = .Done
		}
	case .Cloud:
		g.cloud_remaining -= dt
		if g.cloud_fx != nil {
			fade := clamp(g.cloud_remaining / 1000, 0, 1)
			g.cloud_fx.alpha = 0.55 * fade + 0.0
		}
		// a client's copy waits for the host's Grenade_Done instead
		if g.cloud_remaining <= 0 && !g.cosmetic {
			net_ev_grenade_phase(g, .Grenade_Done)
			grenade_tear_down_smoke(g)
			g.phase = .Done
		}
	case .Done:
	}
}

grenade_detonate :: proc(g: ^Grenade) {
	net_ev_grenade_phase(g, .Grenade_Det)
	grenade_destroy_sprite(g)
	center := g.target
	d := &g.def
	if d.fx_damage || d.fx_breach do grenade_frag(g, center)
	if d.fx_vision_block do grenade_deploy_smoke(g, center)
	if d.fx_blind do grenade_flash(g, center)
	if d.fx_loud do grenade_be_loud(center)
	else do grenade_be_heard(g, center)
	grenade_blast_particles(center.x, center.y, d.radius, tint_for(d.id))
}

// Co-op client: the host decided the grenade went off. Only the parts that are not already
// sent as their own events (sounds, shake, debris and wall damage are) happen here.
grenade_detonate_cosmetic :: proc(g: ^Grenade) {
	grenade_destroy_sprite(g)
	d := &g.def
	if d.fx_vision_block do grenade_deploy_smoke(g, g.target)
	if d.fx_blind do flash_screen()
	if g.phase != .Cloud do g.phase = .Done
}

grenade_be_heard :: proc(g: ^Grenade, center: Point) {
	radius := g.def.loudness * HEAR_PX_PER_LOUDNESS
	if radius <= 0 do return
	now := clock_now()
	any_heard := false
	for guard in guards {
		if !guard.alive || guard.being_choked_out do continue
		if guard.blind_until != 0 && now < guard.blind_until do continue
		if pdist(center, {guard.x, guard.y}) <= radius {
			guard.saw_hero_last_at = center
			guard_see_alarming_object(guard)
			any_heard = true
		}
	}
	if any_heard {
		squad_update_belief(center.x, center.y, now)
		if hero != nil {
			hero.last_seen_x = center.x
			hero.last_seen_y = center.y
		}
		if hero_last_seen != nil {
			hero_last_seen.x = center.x
			hero_last_seen.y = center.y
		}
		notify_guards_of_hero_location = true
	}
}

grenade_frag :: proc(g: ^Grenade, center: Point) {
	radius := g.def.radius
	size := f64(grid.cell_size)
	for idx in 0 ..< len(grid.cells) {
		ccx := f64(idx % grid.width) * size + size / 2
		ccy := f64(idx / grid.width) * size + size / 2
		if pdist(center, {ccx, ccy}) < radius do grid_damage_cell(idx, DAMAGE_AMOUNT[.Bomb], .Bomb)
	}
	for guard in guards {
		if guard.alive && pdist(center, {guard.x, guard.y}) < radius do sprite_kill(guard, center.x, center.y)
	}
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		if hero != nil && hero.alive && pdist(center, {hero.x, hero.y}) < radius do kill_hero(center.x, center.y)
		player_switch(prev)
	}
	emit_nav_danger(center.x, center.y, 8, 3)
	play_sound(.Explosion)
	cam_start_shake(300, 12)
	net_ev_shake(300, 12)
}

grenade_be_loud :: proc(center: Point) {
	alert_all_guards()
	if hero != nil {
		hero.last_seen_x = center.x
		hero.last_seen_y = center.y
	}
	if hero_last_seen != nil {
		hero_last_seen.x = center.x
		hero_last_seen.y = center.y
	}
	notify_guards_of_hero_location = true
	squad_update_belief(center.x, center.y, clock_now())
}

grenade_deploy_smoke :: proc(g: ^Grenade, center: Point) {
	size := f64(grid.cell_size)
	r := size * CLOUD_CIRCLE_RADIUS_FACTOR
	radius := g.def.radius
	cells := make([dynamic]int, context.temp_allocator)
	circles := make([dynamic][3]f64, context.temp_allocator)
	min_gx := max(0, int(math.floor((center.x - radius) / size)))
	max_gx := min(grid.width - 1, int(math.floor((center.x + radius) / size)))
	min_gy := max(0, int(math.floor((center.y - radius) / size)))
	max_gy := min(grid.height - 1, int(math.floor((center.y + radius) / size)))
	for gy in min_gy ..= max_gy {
		for gx in min_gx ..= max_gx {
			ccx := f64(gx) * size + size / 2
			ccy := f64(gy) * size + size / 2
			if pdist(center, {ccx, ccy}) <= radius {
				append(&cells, gy * grid.width + gx)
				append(&circles, [3]f64{ccx, ccy, r})
			}
		}
	}
	g.smoke_id = physics_add_vision_blocker(circles[:])
	for idx in cells {
		c := grid.cells[idx]
		if c != nil && !c.blocks_vision {
			c.blocks_vision = true
			append(&g.smoke_cells, idx)
		}
	}
	if len(g.smoke_cells) > 0 do fog_invalidate()
	// makeCloudFx
	fx := new_graphics()
	g_begin_fill(fx, 0xbfc4c9, 1)
	for c in circles do g_draw_circle(fx, c[0], c[1], c[2] * 1.35)
	g_end_fill(fx)
	fx.alpha = 0.55
	add_child(display_effects, fx)
	g.cloud_fx = fx
	g.phase = .Cloud
}

grenade_tear_down_smoke :: proc(g: ^Grenade) {
	if g.smoke_id >= 0 {
		physics_remove_vision_blocker(g.smoke_id)
		g.smoke_id = -1
	}
	if len(g.smoke_cells) > 0 {
		for idx in g.smoke_cells {
			c := grid.cells[idx]
			if c != nil do c.blocks_vision = false
		}
		fog_invalidate()
		clear(&g.smoke_cells)
	}
	if g.cloud_fx != nil {
		remove_from_parent(g.cloud_fx)
		g.cloud_fx = nil
	}
}

grenade_flash :: proc(g: ^Grenade, center: Point) {
	dur := g.def.has_blind_ms ? g.def.blind_ms : 3000
	until := clock_now() + dur
	radius := g.def.radius
	for u in guards {
		if u.alive && pdist(center, {u.x, u.y}) <= radius && physics_can_see(center.x, center.y, u.x, u.y) do u.blind_until = until
	}
	for u in security_cameras {
		if u.alive && pdist(center, {u.x, u.y}) <= radius && physics_can_see(center.x, center.y, u.x, u.y) do u.blind_until = until
	}
	cam_start_shake(200, 6)
	net_ev_shake(200, 6)
	flash_screen()
}

// flashScreen: a white sheet over everything that fades per rendered frame
flash_screen :: proc() {
	o := new_graphics()
	g_begin_fill(o, 0xffffff, 1)
	g_draw_rect(o, -5000, -5000, 20000, 20000)
	g_end_fill(o)
	o.alpha = 0.85
	add_child(stage_child, o)
	append(&flash_overlays, Flash_Overlay{o, 0.85})
}

// requestAnimationFrame(fade): once per rendered frame.
flash_overlays_tick :: proc() {
	for i := 0; i < len(flash_overlays); i += 1 {
		f := &flash_overlays[i]
		f.a -= 0.06
		f.node.alpha = f.a
		if f.a <= 0 {
			remove_from_parent(f.node)
			free_node(f.node)
			ordered_remove(&flash_overlays, i)
			i -= 1
		}
	}
}
