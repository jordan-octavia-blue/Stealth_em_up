package game

// PIXI.Text replacement: Liberation Sans through fontstash, laid out with Pixi v3's
// Text metrics (width = widest line + stroke, line height = font height + stroke, anchor
// against that box) so anchored labels sit where the web build puts them. The glyphs are
// rasterised at the on-screen size, so zoomed-in text stays sharp instead of being a
// scaled canvas texture.

import "core:math"
import "core:strings"
import "core:os"
import "core:fmt"
import fs "vendor:fontstash"
import sg "sokol:gfx"
import sgl "sokol:gl"

Text_Data :: struct {
	str:     string,
	size:    f64, // font px
	fill:    u32,
	stroke:  u32,
	stroke_thickness: f64,
}

font_ctx: fs.FontContext
font_id: int
font_base: ^Base_Texture
font_old: ^Base_Texture
font_rgba: []u8
font_atlas_w, font_atlas_h: int

text_init :: proc() -> bool {
	fs.Init(&font_ctx, 1024, 1024, .TOPLEFT)
	data, ok := read_asset("odin/assets/fonts/LiberationSans-Regular.ttf")
	if !ok {
		fmt.eprintln("font not found")
		return false
	}
	font_id = fs.AddFontMem(&font_ctx, "sans", data, false)
	fs.SetFont(&font_ctx, font_id)
	text_upload_atlas()
	return true
}

text_upload_atlas :: proc() {
	w := font_ctx.width
	h := font_ctx.height
	if len(font_rgba) != w * h * 4 {
		delete(font_rgba)
		font_rgba = make([]u8, w * h * 4)
	}
	for i in 0 ..< w * h {
		font_rgba[i * 4 + 0] = 255
		font_rgba[i * 4 + 1] = 255
		font_rgba[i * 4 + 2] = 255
		font_rgba[i * 4 + 3] = font_ctx.textureData[i]
	}
	if font_old != nil {
		sg.destroy_view(font_old.view)
		sg.destroy_image(font_old.img)
		free(font_old)
	}
	font_old = font_base
	font_base = make_base_texture(&font_rgba[0], w, h)
	font_atlas_w = w
	font_atlas_h = h
}

// Called after sg.commit: new glyphs rasterised this frame become visible next frame.
text_end_frame :: proc() {
	dirty: [4]f32
	if fs.ValidateTexture(&font_ctx, &dirty) || font_ctx.width != font_atlas_w {
		if font_ctx.width > 4096 {
			fs.ResetAtlas(&font_ctx, 1024, 1024)
		}
		text_upload_atlas()
	}
}

new_text :: proc(str: string, size: f64, fill: u32 = 0x000000, stroke: u32 = 0xFFFFFF, stroke_thickness: f64 = 0) -> ^Node {
	n := new_node(.Text)
	n.text = new(Text_Data)
	n.text.str = strings.clone(str)
	n.text.size = size
	n.text.fill = fill
	n.text.stroke = stroke
	n.text.stroke_thickness = stroke_thickness
	return n
}

set_text :: proc(n: ^Node, str: string) {
	if n.text.str == str do return
	delete(n.text.str)
	n.text.str = strings.clone(str)
}

// Pixi measures "|MÉq" on a canvas; for Arial this lands close to these ratios.
text_ascent :: proc(size: f64) -> f64 { return math.round(size * 0.93) }
text_descent :: proc(size: f64) -> f64 { return math.round(size * 0.22) }

line_width :: proc(line: string, size: f64) -> f64 {
	fs.SetSize(&font_ctx, f32(size))
	fs.SetAlignHorizontal(&font_ctx, .LEFT)
	fs.SetAlignVertical(&font_ctx, .BASELINE)
	return f64(fs.TextBounds(&font_ctx, line, 0, 0, nil))
}

text_size :: proc(t: ^Text_Data) -> (w, h: f64) {
	lines := strings.split_lines(t.str, context.temp_allocator)
	maxw := 0.0
	for l in lines do maxw = max(maxw, line_width(l, t.size))
	lh := text_ascent(t.size) + text_descent(t.size) + t.stroke_thickness
	return maxw + t.stroke_thickness, lh * f64(len(lines))
}

draw_text_node :: proc(n: ^Node, m: Mat, world_alpha: f64) {
	t := n.text
	if len(t.str) == 0 || font_base == nil do return
	w, h := text_size(t)
	// rasterise at the on-screen size
	s := math.sqrt(m.a * m.a + m.b * m.b)
	raster := math.round(t.size * s)
	if raster < 4 do raster = 4
	if raster > 160 do raster = 160
	k := raster / t.size
	ox := -n.anchor.x * w
	oy := -n.anchor.y * h
	st := t.stroke_thickness
	lh := text_ascent(t.size) + text_descent(t.size) + st
	lines := strings.split_lines(t.str, context.temp_allocator)
	use_texture(font_base.view)
	fs.SetSize(&font_ctx, f32(raster))
	fs.SetAlignHorizontal(&font_ctx, .LEFT)
	fs.SetAlignVertical(&font_ctx, .BASELINE)
	itw := 1.0 / f64(font_atlas_w)
	ith := 1.0 / f64(font_atlas_h)
	pass :: proc(m: Mat, lines: []string, ox, oy, st, lh, size, k, dx, dy: f64, color: u32, alpha, itw, ith: f64) {
		r, g, b, a := color_rgba(color, alpha)
		sgl.begin_quads()
		sgl.c4b(r, g, b, a)
		for line, i in lines {
			bx := ox + st / 2 + dx
			by := oy + st / 2 + f64(i) * lh + text_ascent(size) + dy
			iter := fs.TextIterInit(&font_ctx, 0, 0, line)
			q: fs.Quad
			for fs.TextIterNext(&font_ctx, &iter, &q) {
				x0 := bx + f64(q.x0) / k
				y0 := by + f64(q.y0) / k
				x1 := bx + f64(q.x1) / k
				y1 := by + f64(q.y1) / k
				// fontstash UVs use its current atlas size; ours may lag a frame
				s0 := f32(f64(q.s0) / f64(font_ctx.itw) * itw)
				t0 := f32(f64(q.t0) / f64(font_ctx.ith) * ith)
				s1 := f32(f64(q.s1) / f64(font_ctx.itw) * itw)
				t1 := f32(f64(q.t1) / f64(font_ctx.ith) * ith)
				vx, vy := mat_apply(m, x0, y0)
				sgl.v2f_t2f(vx, vy, s0, t0)
				vx, vy = mat_apply(m, x1, y0)
				sgl.v2f_t2f(vx, vy, s1, t0)
				vx, vy = mat_apply(m, x1, y1)
				sgl.v2f_t2f(vx, vy, s1, t1)
				vx, vy = mat_apply(m, x0, y1)
				sgl.v2f_t2f(vx, vy, s0, t1)
			}
		}
		sgl.end()
	}
	if st > 0 {
		r := st / 2
		dirs := [8][2]f64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {0.7071, 0.7071}, {-0.7071, 0.7071}, {0.7071, -0.7071}, {-0.7071, -0.7071}}
		for d in dirs {
			pass(m, lines, ox, oy, st, lh, t.size, k, d.x * r, d.y * r, t.stroke, world_alpha, itw, ith)
		}
	}
	pass(m, lines, ox, oy, st, lh, t.size, k, 0, 0, t.fill, world_alpha, itw, ith)
}
