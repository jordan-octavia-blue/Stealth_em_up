package game

// systems/particles.ts and the blood-trail render texture from main.ts.

import "core:math"
import sg "sokol:gfx"
import sgl "sokol:gl"

Particle :: struct {
	x, y, rotation: f64,
	scale:          f64,
	dx, dy, dr:     f64,
	tick:           int,
	node:           ^Node, // nil for blood (never displayed, only stamps the trail)
}

shells: [dynamic]Particle
shards: [dynamic]Particle
bloods: [dynamic]Particle

SHELL_SPEED :: 10.0
BLOOD_SPEED :: 1.0
SHARD_LIMIT :: 2000
shard_type := 0
current_shard: ^Texture

tick_particle :: proc(p: ^Particle, tick_max: int, bounce: bool) -> bool {
	p.y += p.dy
	if is_wall_solid(p.x, p.y) {
		p.y -= p.dy * 2
		p.dy *= -1
	}
	p.x -= p.dx
	if is_wall_solid(p.x, p.y) {
		if bounce {
			p.x += p.dx * 2
			p.dx *= -1
		} else {
			sync_particle(p)
			return true
		}
	}
	p.dx *= 0.9
	p.dy *= 0.9
	p.rotation += p.dr
	p.tick += 1
	sync_particle(p)
	return p.tick > tick_max
}

sync_particle :: #force_inline proc(p: ^Particle) {
	if p.node != nil {
		p.node.x = p.x
		p.node.y = p.y
		p.node.rotation = p.rotation
	}
}

update_particles :: proc(dt: f64) {
	// Expired shells and shards stop moving but stay on the floor (they are never
	// removed from the particle container), exactly like the web build.
	for i := 0; i < len(shells); i += 1 {
		if tick_particle(&shells[i], 20, true) {
			ordered_remove(&shells, i)
			i -= 1
		}
	}
	for i := 0; i < len(shards); i += 1 {
		if tick_particle(&shards[i], 20, true) {
			ordered_remove(&shards, i)
			i -= 1
		}
	}
	for i := 0; i < len(bloods); i += 1 {
		b := &bloods[i]
		b.scale *= 0.7
		bx := random_float_with_bias(-10, 10)
		by := random_float_with_bias(-10, 10)
		bs := random_float_with_bias(1, b.scale * 20)
		draw_blood_trail(b.x + bx, b.y + by, bs)
		if tick_particle(b, 7, false) {
			ordered_remove(&bloods, i)
			i -= 1
		}
	}
}

next_shard_texture :: proc() {
	shard_type += 1
	shard_type %= len(shard_images)
	current_shard = shard_images[shard_type]
}

add_container_particle :: proc(list: ^[dynamic]Particle, p: Particle, tex: ^Texture, tint: u32 = 0xFFFFFF) {
	n := new_sprite(tex)
	n.anchor = {0.5, 0.5}
	n.scale = {p.scale, p.scale}
	n.tint = tint
	q := p
	q.node = n
	sync_particle(&q)
	append(list, q)
	add_child(particle_container, n)
}

shard_particle_splatter :: proc(angle, tx, ty: f64) {
	net_ev_splatter(.Shard, angle, tx, ty)
	amount := int(random_int_from_interval(6, 30))
	angle := angle + math.PI / 2
	for _ in 0 ..< amount {
		p: Particle
		p.x = tx
		p.y = ty
		p.scale = random_float_from_interval(0.3, 1)
		speed := random_float_with_bias(0.1, SHELL_SPEED * 2)
		off := random_float_from_interval(-math.PI / 6, math.PI / 6)
		p.dr = random_float_from_interval(-0.3, 0.3)
		p.dx = speed * math.sin(angle + off)
		p.dy = speed * math.cos(angle + off)
		p.rotation = angle
		add_container_particle(&shards, p, current_shard)
		next_shard_texture()
		if len(shards) > SHARD_LIMIT do return
	}
}

blood_particle_splatter :: proc(angle, tx, ty: f64) {
	net_ev_splatter(.Blood, angle, tx, ty)
	amount := int(random_int_from_interval(30, 60))
	angle := angle + math.PI / 2
	for _ in 0 ..< amount {
		p: Particle
		p.scale = 1
		speed := random_float_with_bias(0.7, BLOOD_SPEED)
		off := random_float_with_bias(0, math.PI / 4)
		if random_int_from_interval(0, 2) != 0 do off *= -1
		p.dr = random_float_from_interval(-0.3, 0.3)
		p.dx = -speed * math.sin(angle + off) * 15
		p.dy = -speed * math.cos(angle + off) * 15
		p.x = tx + math.sin(angle) * 20
		p.y = ty + math.cos(angle) * 20
		p.rotation = angle
		append(&bloods, p)
	}
}

grenade_blast_particles :: proc(cx, cy, radius: f64, tint: u32) {
	net_ev_blast(cx, cy, radius, tint)
	if particle_container == nil do return
	amount := int(random_int_from_interval(24, 40))
	for _ in 0 ..< amount {
		p: Particle
		ang := random_float_from_interval(-math.PI, math.PI)
		d := math.sqrt(random()) * radius
		p.x = cx + math.cos(ang) * d
		p.y = cy + math.sin(ang) * d
		p.scale = random_float_from_interval(0.3, 0.9)
		speed := random_float_with_bias(0.5, SHELL_SPEED * 1.5)
		p.dx = -math.cos(ang) * speed
		p.dy = math.sin(ang) * speed
		p.dr = random_float_from_interval(-0.4, 0.4)
		p.rotation = ang
		add_container_particle(&shards, p, current_shard, tint)
		next_shard_texture()
		if len(shards) > SHARD_LIMIT do return
	}
}

eject_shell :: proc(source: ^Sprite) {
	net_ev_shell(source)
	p: Particle
	p.x = source.x
	p.y = source.y
	p.scale = 0.5
	speed := random_float_with_bias(SHELL_SPEED * 0.6, SHELL_SPEED * 2)
	off := random_float_from_interval(-math.PI / 6, math.PI / 6)
	p.dr = random_float_from_interval(-0.3, 0.3)
	rot := source.sprite.rotation
	p.dx = speed * math.sin(rot + off)
	p.dy = speed * math.cos(rot + off)
	p.rotation = rot
	add_container_particle(&shells, p, img_shell)
}

// ---------------------------------------------------------------- blood trail
//
// Splats accumulate in a Graphics (`blood_trail`) and every 200 they are baked into a
// map-sized render texture, as in the web build. The bake itself has to run between
// passes, so the baked shapes are handed to `blood_flush` which runs before the frame's
// main pass.

BLOOD_TRAIL_BAKE_EVERY :: 200

blood: struct {
	graphics:     ^Node,
	pending:      int,
	img:          sg.Image,
	tex_view:     sg.View,
	att_view:     sg.View,
	w, h:         int,
	sprite:       ^Node,
	needs_clear:  bool,
	to_bake:      [dynamic]^Graphics_Shape,
}

blood_setup :: proc() {
	blood.graphics = new_graphics()
	g_line_style(blood.graphics, 0)
	add_child(display_blood, blood.graphics)
}

blood_setup_texture :: proc() {
	w := grid.width * grid.cell_size
	h := grid.height * grid.cell_size
	if blood.img.id == 0 || blood.w != w || blood.h != h {
		blood_destroy_texture()
		blood.img = sg.make_image({
			usage = {color_attachment = true},
			width = i32(w),
			height = i32(h),
			pixel_format = .RGBA8,
			sample_count = 1,
		})
		blood.tex_view = sg.make_view({texture = {image = blood.img}})
		blood.att_view = sg.make_view({color_attachment = {image = blood.img}})
		blood.w = w
		blood.h = h
	}
	blood.needs_clear = true
	blood.sprite = new_node(.Image)
	blood.sprite.image_view = blood.tex_view
	blood.sprite.image_w = f64(w)
	blood.sprite.image_h = f64(h)
	add_child_at(display_blood, blood.sprite, 0)
	blood.pending = 0
}

blood_destroy_texture :: proc() {
	if blood.img.id != 0 {
		sg.destroy_view(blood.tex_view)
		sg.destroy_view(blood.att_view)
		sg.destroy_image(blood.img)
		blood.img = {}
	}
}

blood_reset :: proc() {
	for s in blood.to_bake do g_free_shape(s)
	clear(&blood.to_bake)
	blood.graphics = nil
	blood.sprite = nil
	blood.pending = 0
}

draw_blood_trail :: proc(x, y, size: f64) {
	net_ev_trail(x, y, size)
	g_begin_fill(blood.graphics, 0x990000, 1.0)
	g_draw_circle(blood.graphics, x, y, size)
	blood.pending += 1
	if blood.pending >= BLOOD_TRAIL_BAKE_EVERY do bake_blood_trail()
}

bake_blood_trail :: proc() {
	if blood.img.id == 0 do return
	gfx := blood.graphics.gfx
	for s in gfx.shapes do append(&blood.to_bake, s)
	clear(&gfx.shapes)
	g_clear(blood.graphics)
	blood.pending = 0
}

// Before the main pass: clear the new trail and draw any baked splats into it.
blood_flush :: proc() {
	if blood.img.id == 0 do return
	if !blood.needs_clear && len(blood.to_bake) == 0 do return
	action: sg.Pass_Action
	action.colors[0] = {load_action = blood.needs_clear ? .CLEAR : .LOAD, store_action = .STORE, clear_value = {0, 0, 0, 0}}
	sg.begin_pass({action = action, attachments = {colors = {0 = blood.att_view}}})
	sgl.set_context(rs.rt_ctx)
	sgl.defaults()
	sgl.load_pipeline(rs.pip_rt_alpha)
	sgl.matrix_mode_projection()
	// GL render targets are stored bottom-up; flip so the texture samples top-down.
	sgl.ortho(0, f32(blood.w), 0, f32(blood.h), -1, 1)
	sgl.matrix_mode_modelview()
	sgl.load_identity()
	rs.textured = false
	if len(blood.to_bake) > 0 {
		tmp := Graphics{shapes = blood.to_bake}
		draw_graphics(&tmp, MAT_IDENTITY, 1, 0xFFFFFF)
	}
	sgl.context_draw(rs.rt_ctx)
	sg.end_pass()
	sgl.set_context(sgl.default_context())
	rs.textured = false
	for s in blood.to_bake do g_free_shape(s)
	clear(&blood.to_bake)
	blood.needs_clear = false
}
