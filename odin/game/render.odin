package game

// A small Pixi-v3-shaped scene graph drawn with sokol-gl.
//
// The web build is a Pixi v3 game and a lot of its "feel" lives in how Pixi composes the
// scene: container order is draw order, a child's transform is parent * (translate,
// rotate, scale), sprites use trimmed TexturePacker frames with anchors measured against
// the untrimmed size, and a ParticleContainer only re-uploads rotation/scale/texture/alpha
// when its child list changes. This file reproduces those rules so the gameplay code can
// be ported line for line against the same display objects.

import "core:math"
import "core:strings"
import "core:encoding/json"
import "core:os"
import "core:fmt"
import sg "sokol:gfx"
import sgl "sokol:gl"
import stbi "vendor:stb/image"

Rect :: struct { x, y, w, h: f64 }

Base_Texture :: struct {
	img:  sg.Image,
	view: sg.View,
	w, h: int,
}

Texture :: struct {
	base:     ^Base_Texture,
	name:     string,
	crop:     Rect, // the sprite's pixels, in unrotated sprite space (UVs come from this)
	has_trim: bool,
	trim:     Rect, // x, y = offset inside the untrimmed image, w, h = untrimmed size
	rotated:  bool,
	uvs:      [4][2]f32,
	width:    f64, // Pixi texture.width: the untrimmed size when trimmed
	height:   f64,
}

texture_update_uvs :: proc(t: ^Texture) {
	tw := f64(t.base.w)
	th := f64(t.base.h)
	f := t.crop
	if t.rotated {
		t.uvs[0] = {f32((f.x + f.h) / tw), f32(f.y / th)}
		t.uvs[1] = {f32((f.x + f.h) / tw), f32((f.y + f.w) / th)}
		t.uvs[2] = {f32(f.x / tw), f32((f.y + f.w) / th)}
		t.uvs[3] = {f32(f.x / tw), f32(f.y / th)}
	} else {
		t.uvs[0] = {f32(f.x / tw), f32(f.y / th)}
		t.uvs[1] = {f32((f.x + f.w) / tw), f32(f.y / th)}
		t.uvs[2] = {f32((f.x + f.w) / tw), f32((f.y + f.h) / th)}
		t.uvs[3] = {f32(f.x / tw), f32((f.y + f.h) / th)}
	}
}

// ---------------------------------------------------------------- texture loading

g_sampler: sg.Sampler
g_white: ^Texture

load_base_texture :: proc(path: string) -> ^Base_Texture {
	cpath := strings.clone_to_cstring(path, context.temp_allocator)
	w, h, comp: i32
	pixels := stbi.load(cpath, &w, &h, &comp, 4)
	if pixels == nil {
		fmt.eprintln("could not load image", path)
		return nil
	}
	defer stbi.image_free(pixels)
	return make_base_texture(pixels, int(w), int(h))
}

make_base_texture :: proc(pixels: [^]u8, w, h: int) -> ^Base_Texture {
	desc: sg.Image_Desc
	desc.width = i32(w)
	desc.height = i32(h)
	desc.pixel_format = .RGBA8
	desc.data = {ptr = pixels, size = uint(w * h * 4)}
	b := new(Base_Texture)
	b.img = sg.make_image(desc)
	b.view = sg.make_view({texture = {image = b.img}})
	b.w = w
	b.h = h
	return b
}

texture_from_base :: proc(base: ^Base_Texture, name: string = "") -> ^Texture {
	t := new(Texture)
	t.base = base
	t.name = name
	t.crop = {0, 0, f64(base.w), f64(base.h)}
	t.width = f64(base.w)
	t.height = f64(base.h)
	texture_update_uvs(t)
	return t
}

texture_cache: map[string]^Texture

// TexturePacker JSON (array form) loaded the way Pixi v3's spritesheet loader does.
load_spritesheet :: proc(json_path, image_path: string) -> bool {
	data, err := os.read_entire_file(json_path, context.allocator)
	if err != nil {
		fmt.eprintln("could not read", json_path)
		return false
	}
	base := load_base_texture(image_path)
	if base == nil do return false
	v, perr := json.parse(data)
	if perr != .None {
		fmt.eprintln("bad json", json_path, perr)
		return false
	}
	root := v.(json.Object)
	frames := root["frames"]
	add_frame :: proc(base: ^Base_Texture, name: string, fr: json.Object) {
		f := fr["frame"].(json.Object)
		rect := Rect{jnum(f["x"]), jnum(f["y"]), jnum(f["w"]), jnum(f["h"])}
		t := new(Texture)
		t.base = base
		t.name = strings.clone(name)
		t.crop = rect
		t.rotated = jbool(fr["rotated"])
		t.width = rect.w
		t.height = rect.h
		if jbool(fr["trimmed"]) {
			sss := fr["spriteSourceSize"].(json.Object)
			ss := fr["sourceSize"].(json.Object)
			t.has_trim = true
			t.trim = {jnum(sss["x"]), jnum(sss["y"]), jnum(ss["w"]), jnum(ss["h"])}
			t.width = t.trim.w
			t.height = t.trim.h
		}
		texture_update_uvs(t)
		texture_cache[t.name] = t
	}
	#partial switch fs in frames {
	case json.Array:
		for fr in fs {
			o := fr.(json.Object)
			add_frame(base, o["filename"].(json.String), o)
		}
	case json.Object:
		for name, fr in fs {
			add_frame(base, name, fr.(json.Object))
		}
	}
	return true
}

jnum :: proc(v: json.Value) -> f64 {
	#partial switch x in v {
	case json.Float:   return f64(x)
	case json.Integer: return f64(x)
	}
	return 0
}
jbool :: proc(v: json.Value) -> bool {
	#partial switch x in v {
	case json.Boolean: return bool(x)
	}
	return false
}

frame_tex :: proc(name: string) -> ^Texture {
	t, ok := texture_cache[name]
	if !ok {
		fmt.eprintln("missing frame", name)
		return g_white
	}
	return t
}

// Pixi's Texture.fromImage(url): a standalone image file, cached by url.
image_tex :: proc(path: string) -> ^Texture {
	if t, ok := texture_cache[path]; ok do return t
	base := load_base_texture(asset_path(path))
	if base == nil do return g_white
	t := texture_from_base(base, strings.clone(path))
	texture_cache[t.name] = t
	return t
}

// ---------------------------------------------------------------- display objects

Node_Kind :: enum u8 {
	Container,
	Sprite,
	Graphics,
	Text,
	Particles, // a ParticleContainer
	Fog,       // the fog-of-war shade (drawn through the stencil)
	Image,     // a full render-target image (blood trail)
}

Node :: struct {
	kind:       Node_Kind,
	parent:     ^Node,
	children:   [dynamic]^Node,
	x, y:       f64,
	rotation:   f64,
	scale:      [2]f64,
	anchor:     [2]f64,
	alpha:      f64,
	tint:       u32,
	visible:    bool,
	renderable: bool,
	tex:        ^Texture,
	gfx:        ^Graphics,
	text:       ^Text_Data,
	clip:       ^Clip_Data,
	// ParticleContainer bookkeeping: `update_static` on the container, the static
	// snapshot on each child.
	update_static: bool,
	snap_tex:      ^Texture,
	snap_rot:      f64,
	snap_scale:    [2]f64,
	snap_anchor:   [2]f64,
	snap_alpha:    f64,
	// Image nodes
	image_view: sg.View,
	image_w, image_h: f64,
}

new_node :: proc(kind: Node_Kind) -> ^Node {
	n := new(Node)
	n.kind = kind
	n.scale = {1, 1}
	n.alpha = 1
	n.tint = 0xFFFFFF
	n.visible = true
	n.renderable = true
	return n
}

new_container :: proc() -> ^Node { return new_node(.Container) }

new_sprite :: proc(tex: ^Texture) -> ^Node {
	n := new_node(.Sprite)
	n.tex = tex
	return n
}

new_graphics :: proc() -> ^Node {
	n := new_node(.Graphics)
	n.gfx = new(Graphics)
	n.gfx.line_alpha = 1
	n.gfx.fill_alpha = 1
	return n
}

new_particle_container :: proc() -> ^Node { return new_node(.Particles) }

add_child :: proc(parent, child: ^Node) {
	add_child_at(parent, child, len(parent.children))
}

add_child_at :: proc(parent, child: ^Node, index: int) {
	if child == parent do return
	if child.parent != nil do remove_child(child.parent, child)
	child.parent = parent
	inject_at(&parent.children, index, child)
	if parent.kind == .Particles do parent.update_static = true
}

remove_child :: proc(parent, child: ^Node) {
	if parent == nil || child == nil do return
	for c, i in parent.children {
		if c == child {
			ordered_remove(&parent.children, i)
			child.parent = nil
			if parent.kind == .Particles do parent.update_static = true
			return
		}
	}
}

remove_from_parent :: proc(child: ^Node) {
	if child != nil && child.parent != nil do remove_child(child.parent, child)
}

remove_all_children :: proc(parent: ^Node) {
	for c in parent.children do c.parent = nil
	clear(&parent.children)
	if parent.kind == .Particles do parent.update_static = true
}

// Pixi's Sprite.width (scale * frame width; the frame is the untrimmed size).
sprite_width :: proc(n: ^Node) -> f64 { return n.scale.x * n.tex.width }
sprite_height :: proc(n: ^Node) -> f64 { return n.scale.y * n.tex.height }

// ---------------------------------------------------------------- Pixi Graphics

Shape_Kind :: enum u8 { Poly, Rect, Circle, Ellipse }

Graphics_Shape :: struct {
	kind:       Shape_Kind,
	line_width: f64,
	line_color: u32,
	line_alpha: f64,
	fill_color: u32,
	fill_alpha: f64,
	fill:       bool,
	closed:     bool,
	points:     [dynamic]f64, // polygon points
	x, y, w, h: f64,          // rect / circle (w = radius) / ellipse
}

Graphics :: struct {
	shapes:       [dynamic]^Graphics_Shape,
	current:      ^Graphics_Shape,
	line_width:   f64,
	line_color:   u32,
	line_alpha:   f64,
	fill_color:   u32,
	fill_alpha:   f64,
	filling:      bool,
}

g_free_shape :: proc(s: ^Graphics_Shape) {
	delete(s.points)
	free(s)
}

g_clear :: proc(n: ^Node) {
	g := n.gfx
	g.line_width = 0
	g.filling = false
	for s in g.shapes {
		if s != g.current do g_free_shape(s)
	}
	clear(&g.shapes)
	// Pixi v3 leaves currentPath pointing at the old (now orphaned) data.
}

g_line_style :: proc(n: ^Node, width: f64, color: u32 = 0, alpha: f64 = 1) {
	g := n.gfx
	g.line_width = width
	g.line_color = color
	g.line_alpha = alpha
	if g.current != nil {
		if len(g.current.points) > 0 {
			l := len(g.current.points)
			px, py := g.current.points[l - 2], g.current.points[l - 1]
			s := g_draw_shape(n, .Poly)
			append(&s.points, px, py)
		} else {
			g.current.line_width = g.line_width
			g.current.line_color = g.line_color
			g.current.line_alpha = g.line_alpha
		}
	}
}

g_begin_fill :: proc(n: ^Node, color: u32 = 0, alpha: f64 = 1) {
	g := n.gfx
	g.filling = true
	g.fill_color = color
	g.fill_alpha = alpha
	if g.current != nil && len(g.current.points) <= 2 {
		g.current.fill = true
		g.current.fill_color = color
		g.current.fill_alpha = alpha
	}
}

g_end_fill :: proc(n: ^Node) {
	g := n.gfx
	g.filling = false
	g.fill_color = 0
	g.fill_alpha = 1
}

g_draw_shape :: proc(n: ^Node, kind: Shape_Kind) -> ^Graphics_Shape {
	g := n.gfx
	if g.current != nil {
		if len(g.current.points) <= 2 && len(g.shapes) > 0 {
			last := pop(&g.shapes)
			if last != g.current do g_free_shape(last)
			else if !contains_shape(g.shapes[:], last) do g_free_shape(last)
		}
	}
	g.current = nil
	s := new(Graphics_Shape)
	s.kind = kind
	s.line_width = g.line_width
	s.line_color = g.line_color
	s.line_alpha = g.line_alpha
	s.fill_color = g.fill_color
	s.fill_alpha = g.fill_alpha
	s.fill = g.filling
	append(&g.shapes, s)
	if kind == .Poly {
		s.closed = g.filling
		g.current = s
	}
	return s
}

contains_shape :: proc(list: []^Graphics_Shape, s: ^Graphics_Shape) -> bool {
	for x in list do if x == s do return true
	return false
}

g_move_to :: proc(n: ^Node, x, y: f64) {
	s := g_draw_shape(n, .Poly)
	append(&s.points, x, y)
}

g_line_to :: proc(n: ^Node, x, y: f64) {
	if n.gfx.current == nil do return
	append(&n.gfx.current.points, x, y)
}

g_draw_rect :: proc(n: ^Node, x, y, w, h: f64) {
	s := g_draw_shape(n, .Rect)
	s.x, s.y, s.w, s.h = x, y, w, h
}

g_draw_circle :: proc(n: ^Node, x, y, r: f64) {
	s := g_draw_shape(n, .Circle)
	s.x, s.y, s.w, s.h = x, y, r, r
}

g_draw_ellipse :: proc(n: ^Node, x, y, w, h: f64) {
	s := g_draw_shape(n, .Ellipse)
	s.x, s.y, s.w, s.h = x, y, w, h
}

g_draw_polygon :: proc(n: ^Node, pts: []f64) {
	s := g_draw_shape(n, .Poly)
	append(&s.points, ..pts)
}

g_arc :: proc(n: ^Node, cx, cy, radius, start_angle, end_angle: f64, anticlockwise := false) {
	start_angle, end_angle := start_angle, end_angle
	if start_angle == end_angle do return
	if !anticlockwise && end_angle <= start_angle {
		end_angle += math.PI * 2
	} else if anticlockwise && start_angle <= end_angle {
		start_angle += math.PI * 2
	}
	sweep := anticlockwise ? (start_angle - end_angle) * -1 : (end_angle - start_angle)
	segs := math.ceil(abs(sweep) / (math.PI * 2)) * 40
	if sweep == 0 do return
	g := n.gfx
	start_x := cx + math.cos(start_angle) * radius
	start_y := cy + math.sin(start_angle) * radius
	if g.current != nil {
		if anticlockwise && g.filling do append(&g.current.points, cx, cy)
		else do append(&g.current.points, start_x, start_y)
	} else {
		if anticlockwise && g.filling do g_move_to(n, cx, cy)
		else do g_move_to(n, start_x, start_y)
	}
	pts := &g.current.points
	theta := sweep / (segs * 2)
	theta2 := theta * 2
	c_theta := math.cos(theta)
	s_theta := math.sin(theta)
	seg_minus := segs - 1
	remainder := math.mod(seg_minus, 1) / seg_minus
	for i := 0.0; i <= seg_minus; i += 1 {
		real := i + remainder * i
		angle := theta + start_angle + theta2 * real
		c := math.cos(angle)
		s := -math.sin(angle)
		append(pts, (c_theta * c + s_theta * s) * radius + cx, (c_theta * -s + s_theta * c) * radius + cy)
	}
}

// ---------------------------------------------------------------- movie clips

Clip_Data :: struct {
	frames:          []^Texture,
	animation_speed: f64,
	loop:            bool,
	playing:         bool,
	current_time:    f64,
}

new_movie_clip :: proc(frames: []^Texture) -> ^Node {
	n := new_sprite(frames[0])
	n.clip = new(Clip_Data)
	n.clip.frames = frames
	n.clip.animation_speed = 1
	n.clip.loop = true
	return n
}

clip_current_frame :: proc(n: ^Node) -> int {
	c := n.clip
	return int(math.floor(c.current_time)) %% len(c.frames)
}

clip_goto_and_play :: proc(n: ^Node, frame: int) {
	n.clip.current_time = f64(frame)
	n.clip.playing = true
}

clip_goto_and_stop :: proc(n: ^Node, frame: int) {
	n.clip.playing = false
	n.clip.current_time = f64(frame)
	n.tex = n.clip.frames[clip_current_frame(n)]
}

clip_stop :: proc(n: ^Node) { n.clip.playing = false }
clip_play :: proc(n: ^Node) { n.clip.playing = true }

// Pixi's MovieClip.update, driven by the shared ticker (wall-clock frames, not the fixed
// simulation step). `delta` is Pixi's ticker deltaTime: elapsed ms * 60 / 1000.
all_clips: [dynamic]^Node

clip_update :: proc(n: ^Node, delta: f64) {
	c := n.clip
	if !c.playing do return
	c.current_time += c.animation_speed * delta
	floor := math.floor(c.current_time)
	nf := f64(len(c.frames))
	if floor < 0 {
		if c.loop {
			c.current_time += nf
			n.tex = c.frames[int(c.current_time)]
		} else {
			clip_goto_and_stop(n, 0)
		}
	} else if c.loop || floor < nf {
		n.tex = c.frames[int(floor) %% len(c.frames)]
	} else if floor >= nf {
		clip_goto_and_stop(n, len(c.frames) - 1)
	}
}

// ---------------------------------------------------------------- drawing

Mat :: struct { a, b, c, d, tx, ty: f64 }
MAT_IDENTITY :: Mat{1, 0, 0, 1, 0, 0}

local_matrix :: proc(n: ^Node, rotation: f64, scale: [2]f64) -> Mat {
	sr := math.sin(rotation)
	cr := math.cos(rotation)
	return {cr * scale.x, sr * scale.x, -sr * scale.y, cr * scale.y, n.x, n.y}
}

mat_mul :: proc(l, p: Mat) -> Mat {
	// world = parent * local, Pixi's updateTransform
	return {
		l.a * p.a + l.b * p.c,
		l.a * p.b + l.b * p.d,
		l.c * p.a + l.d * p.c,
		l.c * p.b + l.d * p.d,
		l.tx * p.a + l.ty * p.c + p.tx,
		l.tx * p.b + l.ty * p.d + p.ty,
	}
}

mat_apply :: proc(m: Mat, x, y: f64) -> (f32, f32) {
	return f32(m.a * x + m.c * y + m.tx), f32(m.b * x + m.d * y + m.ty)
}

Render_State :: struct {
	pip_alpha:         sgl.Pipeline,
	pip_stencil_write: sgl.Pipeline,
	pip_stencil_test:  sgl.Pipeline,
	pip_rt_alpha:      sgl.Pipeline,
	rt_ctx:            sgl.Context,
	textured:          bool,
	cur_view:          sg.View,
}
rs: Render_State

render_init :: proc() {
	alpha_blend := sg.Blend_State {
		enabled          = true,
		src_factor_rgb   = .SRC_ALPHA,
		dst_factor_rgb   = .ONE_MINUS_SRC_ALPHA,
		src_factor_alpha = .ONE,
		dst_factor_alpha = .ONE_MINUS_SRC_ALPHA,
	}
	{
		d: sg.Pipeline_Desc
		d.colors[0].blend = alpha_blend
		rs.pip_alpha = sgl.make_pipeline(d)
	}
	{
		d: sg.Pipeline_Desc
		d.colors[0].write_mask = .NONE
		d.stencil = {
			enabled    = true,
			front      = {compare = .ALWAYS, pass_op = .REPLACE},
			back       = {compare = .ALWAYS, pass_op = .REPLACE},
			write_mask = 0xFF,
			read_mask  = 0xFF,
			ref        = 1,
		}
		rs.pip_stencil_write = sgl.make_pipeline(d)
	}
	{
		d: sg.Pipeline_Desc
		d.colors[0].blend = alpha_blend
		d.stencil = {
			enabled    = true,
			front      = {compare = .NOT_EQUAL, pass_op = .KEEP},
			back       = {compare = .NOT_EQUAL, pass_op = .KEEP},
			write_mask = 0,
			read_mask  = 0xFF,
			ref        = 1,
		}
		rs.pip_stencil_test = sgl.make_pipeline(d)
	}
	rs.rt_ctx = sgl.make_context({
		max_vertices = 1 << 18,
		max_commands = 1 << 14,
		color_format = .RGBA8,
		depth_format = .NONE,
		sample_count = 1,
	})
	{
		d: sg.Pipeline_Desc
		d.colors[0].blend = alpha_blend
		rs.pip_rt_alpha = sgl.context_make_pipeline(rs.rt_ctx, d)
	}
	g_sampler = sg.make_sampler({
		min_filter = .LINEAR,
		mag_filter = .LINEAR,
		wrap_u = .CLAMP_TO_EDGE,
		wrap_v = .CLAMP_TO_EDGE,
	})
	white := [4]u8{255, 255, 255, 255}
	g_white = texture_from_base(make_base_texture(&white[0], 1, 1), "white")
}

use_texture :: proc(view: sg.View) {
	if !rs.textured || rs.cur_view.id != view.id {
		sgl.enable_texture()
		sgl.texture(view, g_sampler)
		rs.textured = true
		rs.cur_view = view
	}
}

use_no_texture :: proc() {
	use_texture(g_white.base.view)
}

color_rgba :: proc(c: u32, a: f64) -> (u8, u8, u8, u8) {
	return u8((c >> 16) & 0xFF), u8((c >> 8) & 0xFF), u8(c & 0xFF), u8(clamp(a, 0, 1) * 255 + 0.5)
}

tint_mul :: proc(c, tint: u32) -> u32 {
	if tint == 0xFFFFFF do return c
	r := ((c >> 16) & 0xFF) * ((tint >> 16) & 0xFF) / 255
	g := ((c >> 8) & 0xFF) * ((tint >> 8) & 0xFF) / 255
	b := (c & 0xFF) * (tint & 0xFF) / 255
	return (r << 16) | (g << 8) | b
}

draw_textured_quad :: proc(m: Mat, tex: ^Texture, anchor: [2]f64, tint: u32, alpha: f64, sx: f64 = 1, sy: f64 = 1) {
	w0, w1, h0, h1: f64
	if tex.has_trim {
		w1 = tex.trim.x - anchor.x * tex.trim.w
		w0 = w1 + tex.crop.w
		h1 = tex.trim.y - anchor.y * tex.trim.h
		h0 = h1 + tex.crop.h
	} else {
		w0 = tex.width * (1 - anchor.x)
		w1 = tex.width * -anchor.x
		h0 = tex.height * (1 - anchor.y)
		h1 = tex.height * -anchor.y
	}
	w0 *= sx; w1 *= sx; h0 *= sy; h1 *= sy
	use_texture(tex.base.view)
	r, g, b, a := color_rgba(tint, alpha)
	sgl.begin_quads()
	x, y := mat_apply(m, w1, h1)
	sgl.v2f_t2f_c4b(x, y, tex.uvs[0].x, tex.uvs[0].y, r, g, b, a)
	x, y = mat_apply(m, w0, h1)
	sgl.v2f_t2f_c4b(x, y, tex.uvs[1].x, tex.uvs[1].y, r, g, b, a)
	x, y = mat_apply(m, w0, h0)
	sgl.v2f_t2f_c4b(x, y, tex.uvs[2].x, tex.uvs[2].y, r, g, b, a)
	x, y = mat_apply(m, w1, h0)
	sgl.v2f_t2f_c4b(x, y, tex.uvs[3].x, tex.uvs[3].y, r, g, b, a)
	sgl.end()
}

render_node :: proc(n: ^Node, parent: Mat, parent_alpha: f64) {
	world_alpha := n.alpha * parent_alpha
	if !n.visible || world_alpha <= 0 || !n.renderable do return
	m := mat_mul(local_matrix(n, n.rotation, n.scale), parent)
	switch n.kind {
	case .Container:
		for c in n.children do render_node(c, m, world_alpha)
	case .Sprite:
		if n.tex != nil do draw_textured_quad(m, n.tex, n.anchor, n.tint, world_alpha)
		for c in n.children do render_node(c, m, world_alpha)
	case .Graphics:
		draw_graphics(n.gfx, m, world_alpha, n.tint)
		for c in n.children do render_node(c, m, world_alpha)
	case .Text:
		draw_text_node(n, m, world_alpha)
	case .Particles:
		render_particles(n, m, world_alpha)
	case .Fog:
		draw_fog(m, world_alpha)
	case .Image:
		use_texture(n.image_view)
		r, g, b, a := color_rgba(0xFFFFFF, world_alpha)
		sgl.begin_quads()
		x, y := mat_apply(m, 0, 0)
		sgl.v2f_t2f_c4b(x, y, 0, 0, r, g, b, a)
		x, y = mat_apply(m, n.image_w, 0)
		sgl.v2f_t2f_c4b(x, y, 1, 0, r, g, b, a)
		x, y = mat_apply(m, n.image_w, n.image_h)
		sgl.v2f_t2f_c4b(x, y, 1, 1, r, g, b, a)
		x, y = mat_apply(m, 0, n.image_h)
		sgl.v2f_t2f_c4b(x, y, 0, 1, r, g, b, a)
		sgl.end()
	}
}

// ParticleContainer: positions are live, everything else (texture, anchor, scale,
// rotation, alpha) is whatever it was the last time the child list changed. Tint and
// child visibility are ignored, exactly like Pixi v3's particle shader.
render_particles :: proc(n: ^Node, m: Mat, world_alpha: f64) {
	if len(n.children) == 0 do return
	if n.update_static {
		for c in n.children {
			c.snap_tex = c.tex
			c.snap_rot = c.rotation
			c.snap_scale = c.scale
			c.snap_anchor = c.anchor
			c.snap_alpha = c.alpha
		}
		n.update_static = false
	}
	for c in n.children {
		if c.snap_tex == nil do continue
		sr := math.sin(c.snap_rot)
		cr := math.cos(c.snap_rot)
		// rotate (already scaled) vertex, then translate, then the container matrix
		lm := Mat{cr, sr, -sr, cr, c.x, c.y}
		draw_textured_quad(mat_mul(lm, m), c.snap_tex, c.snap_anchor, 0xFFFFFF, world_alpha * c.snap_alpha, c.snap_scale.x, c.snap_scale.y)
	}
}

// ---- Graphics tessellation (fills, then outlines, per shape in order, like Pixi)

draw_graphics :: proc(g: ^Graphics, m: Mat, world_alpha: f64, tint: u32) {
	for s in g.shapes {
		switch s.kind {
		case .Rect:
			if s.fill {
				fill_quad(m, s.x, s.y, s.w, s.h, tint_mul(s.fill_color, tint), s.fill_alpha * world_alpha)
			}
			if s.line_width > 0 {
				pts := [10]f64{s.x, s.y, s.x + s.w, s.y, s.x + s.w, s.y + s.h, s.x, s.y + s.h, s.x, s.y}
				stroke_polyline(m, pts[:], s.line_width, tint_mul(s.line_color, tint), s.line_alpha * world_alpha)
			}
		case .Circle, .Ellipse:
			pts: [82]f64
			seg := math.PI * 2 / 40
			for i in 0 ..= 40 {
				pts[i * 2] = s.x + math.sin(seg * f64(i)) * s.w
				pts[i * 2 + 1] = s.y + math.cos(seg * f64(i)) * s.h
			}
			if s.fill {
				fill_fan(m, s.x, s.y, pts[:], tint_mul(s.fill_color, tint), s.fill_alpha * world_alpha)
			}
			if s.line_width > 0 {
				stroke_polyline(m, pts[:], s.line_width, tint_mul(s.line_color, tint), s.line_alpha * world_alpha)
			}
		case .Poly:
			p := s.points[:]
			l := len(p)
			if l < 2 do continue
			closed_pts := p
			tmp: [dynamic]f64
			if s.closed && l >= 4 && (p[0] != p[l - 2] || p[1] != p[l - 1]) {
				tmp = make([dynamic]f64, 0, l + 2, context.temp_allocator)
				append(&tmp, ..p)
				append(&tmp, p[0], p[1])
				closed_pts = tmp[:]
			}
			if s.fill && l >= 6 {
				fill_polygon(m, p, tint_mul(s.fill_color, tint), s.fill_alpha * world_alpha)
			}
			if s.line_width > 0 {
				stroke_polyline(m, closed_pts, s.line_width, tint_mul(s.line_color, tint), s.line_alpha * world_alpha)
			}
		}
	}
}

fill_quad :: proc(m: Mat, x, y, w, h: f64, color: u32, alpha: f64) {
	use_no_texture()
	r, g, b, a := color_rgba(color, alpha)
	sgl.begin_quads()
	sgl.c4b(r, g, b, a)
	vx, vy := mat_apply(m, x, y)
	sgl.v2f_t2f(vx, vy, 0.5, 0.5)
	vx, vy = mat_apply(m, x + w, y)
	sgl.v2f_t2f(vx, vy, 0.5, 0.5)
	vx, vy = mat_apply(m, x + w, y + h)
	sgl.v2f_t2f(vx, vy, 0.5, 0.5)
	vx, vy = mat_apply(m, x, y + h)
	sgl.v2f_t2f(vx, vy, 0.5, 0.5)
	sgl.end()
}

fill_fan :: proc(m: Mat, cx, cy: f64, ring: []f64, color: u32, alpha: f64) {
	use_no_texture()
	r, g, b, a := color_rgba(color, alpha)
	sgl.begin_triangles()
	sgl.c4b(r, g, b, a)
	ox, oy := mat_apply(m, cx, cy)
	n := len(ring) / 2
	for i in 0 ..< n - 1 {
		x0, y0 := mat_apply(m, ring[i * 2], ring[i * 2 + 1])
		x1, y1 := mat_apply(m, ring[i * 2 + 2], ring[i * 2 + 3])
		sgl.v2f_t2f(ox, oy, 0.5, 0.5)
		sgl.v2f_t2f(x0, y0, 0.5, 0.5)
		sgl.v2f_t2f(x1, y1, 0.5, 0.5)
	}
	sgl.end()
}

// Polygon fill by ear clipping (Pixi uses earcut / a stencil for big polygons; for the
// simple polygons this game draws the result is the same).
fill_polygon :: proc(m: Mat, pts: []f64, color: u32, alpha: f64) {
	n := len(pts) / 2
	if n < 3 do return
	idx := make([dynamic]int, 0, n, context.temp_allocator)
	area := 0.0
	for i in 0 ..< n {
		j := (i + 1) % n
		area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]
		append(&idx, i)
	}
	if area < 0 {
		for i in 0 ..< n / 2 do idx[i], idx[n - 1 - i] = idx[n - 1 - i], idx[i]
	}
	use_no_texture()
	r, g, b, a := color_rgba(color, alpha)
	sgl.begin_triangles()
	sgl.c4b(r, g, b, a)
	emit :: proc(m: Mat, pts: []f64, i: int) {
		x, y := mat_apply(m, pts[i * 2], pts[i * 2 + 1])
		sgl.v2f_t2f(x, y, 0.5, 0.5)
	}
	guard := 0
	for len(idx) > 3 && guard < n * n {
		guard += 1
		cnt := len(idx)
		clipped := false
		for k in 0 ..< cnt {
			ia := idx[(k + cnt - 1) % cnt]
			ib := idx[k]
			ic := idx[(k + 1) % cnt]
			ax, ay := pts[ia * 2], pts[ia * 2 + 1]
			bx, by := pts[ib * 2], pts[ib * 2 + 1]
			cx, cy := pts[ic * 2], pts[ic * 2 + 1]
			cr := (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
			if cr <= 0 do continue
			inside := false
			for q in idx {
				if q == ia || q == ib || q == ic do continue
				px, py := pts[q * 2], pts[q * 2 + 1]
				d1 := (bx - ax) * (py - ay) - (by - ay) * (px - ax)
				d2 := (cx - bx) * (py - by) - (cy - by) * (px - bx)
				d3 := (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
				if d1 >= 0 && d2 >= 0 && d3 >= 0 {
					inside = true
					break
				}
			}
			if inside do continue
			emit(m, pts, ia); emit(m, pts, ib); emit(m, pts, ic)
			ordered_remove(&idx, k)
			clipped = true
			break
		}
		if !clipped {
			// degenerate: fan the rest
			for k in 1 ..< len(idx) - 1 {
				emit(m, pts, idx[0]); emit(m, pts, idx[k]); emit(m, pts, idx[k + 1])
			}
			clear(&idx)
		}
	}
	if len(idx) == 3 {
		emit(m, pts, idx[0]); emit(m, pts, idx[1]); emit(m, pts, idx[2])
	}
	sgl.end()
}

// Thick polyline with miter joins (Pixi's buildLine look). Closed when first == last.
stroke_polyline :: proc(m: Mat, pts: []f64, width: f64, color: u32, alpha: f64) {
	n := len(pts) / 2
	if n < 2 do return
	use_no_texture()
	r, g, b, a := color_rgba(color, alpha)
	hw := width / 2
	closed := n > 2 && pts[0] == pts[(n - 1) * 2] && pts[1] == pts[(n - 1) * 2 + 1]
	// per-vertex offset (miter)
	offs := make([]f64, n * 2, context.temp_allocator)
	for i in 0 ..< n {
		px, py := pts[i * 2], pts[i * 2 + 1]
		has_prev := i > 0 || closed
		has_next := i < n - 1 || closed
		pi := i > 0 ? i - 1 : n - 2
		ni := i < n - 1 ? i + 1 : 1
		n1x, n1y, n2x, n2y: f64
		if has_prev {
			dx := px - pts[pi * 2]
			dy := py - pts[pi * 2 + 1]
			l := math.sqrt(dx * dx + dy * dy)
			if l > 0 {n1x = -dy / l; n1y = dx / l}
		}
		if has_next {
			dx := pts[ni * 2] - px
			dy := pts[ni * 2 + 1] - py
			l := math.sqrt(dx * dx + dy * dy)
			if l > 0 {n2x = -dy / l; n2y = dx / l}
		}
		if !has_prev {n1x, n1y = n2x, n2y}
		if !has_next {n2x, n2y = n1x, n1y}
		mx := n1x + n2x
		my := n1y + n2y
		ml := math.sqrt(mx * mx + my * my)
		if ml < 1e-9 {
			offs[i * 2] = n1x * hw
			offs[i * 2 + 1] = n1y * hw
			continue
		}
		mx /= ml
		my /= ml
		dotn := mx * n1x + my * n1y
		scale := dotn > 0.1 ? hw / dotn : hw * 10
		offs[i * 2] = mx * scale
		offs[i * 2 + 1] = my * scale
	}
	sgl.begin_quads()
	sgl.c4b(r, g, b, a)
	for i in 0 ..< n - 1 {
		ax, ay := pts[i * 2], pts[i * 2 + 1]
		bx, by := pts[i * 2 + 2], pts[i * 2 + 3]
		if ax == bx && ay == by do continue
		x0, y0 := mat_apply(m, ax + offs[i * 2], ay + offs[i * 2 + 1])
		x1, y1 := mat_apply(m, bx + offs[i * 2 + 2], by + offs[i * 2 + 3])
		x2, y2 := mat_apply(m, bx - offs[i * 2 + 2], by - offs[i * 2 + 3])
		x3, y3 := mat_apply(m, ax - offs[i * 2], ay - offs[i * 2 + 1])
		sgl.v2f_t2f(x0, y0, 0.5, 0.5)
		sgl.v2f_t2f(x1, y1, 0.5, 0.5)
		sgl.v2f_t2f(x2, y2, 0.5, 0.5)
		sgl.v2f_t2f(x3, y3, 0.5, 0.5)
	}
	sgl.end()
}

// ---------------------------------------------------------------- frame

render_begin_frame :: proc(width, height: f64) {
	sgl.set_context(sgl.default_context())
	sgl.defaults()
	sgl.load_pipeline(rs.pip_alpha)
	sgl.matrix_mode_projection()
	sgl.ortho(0, f32(width), f32(height), 0, -1, 1)
	sgl.matrix_mode_modelview()
	sgl.load_identity()
	rs.textured = false
	rs.cur_view = {}
}
