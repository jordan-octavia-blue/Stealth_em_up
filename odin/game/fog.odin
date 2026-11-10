package game

// render/fog.ts, fog/visibility.ts, fog/occluders.ts.
//
// The web build renders "white map minus black visibility polygons" into a render
// texture and uses it as a sprite mask over a 0.75-alpha black sheet. Here the same
// polygons are written into the stencil buffer and the sheet is drawn where the stencil
// is unset: identical coverage, no extra render target.

import "core:math"
import "core:slice"
import sgl "sokol:gl"

FOG_RADIUS :: 900.0
CAMERA_CONE :: (2 * math.PI) / 3
WALL_LIGHT_INSET :: 20.0
enable_los := false // the line-of-sight shade (fog of war). Off: the whole map and every guard are visible.

Segment :: struct { x1, y1, x2, y2: f64 }

fog: struct {
	occluders:        [dynamic]Segment,
	valid:            bool,
	occluder_version: int,
	polys:            [dynamic][dynamic]f64, // fan polygons drawn into the stencil
	poly_cone:        [dynamic]bool,
	node:             ^Node,
	near:             [dynamic]Segment,
	angles:           [dynamic]f64,
}

fog_invalidate :: proc() { fog.valid = false }

fog_setup :: proc() {
	fog_invalidate()
	fog.occluder_version = -1
	if !enable_los do return
	fog.node = new_node(.Fog)
	add_child(stage_child, fog.node)
}

fog_reset :: proc() {
	fog.valid = false
	fog.occluder_version = -1
	fog.node = nil
	for &p in fog.polys do clear(&p)
}

fog_current_occluders :: proc() -> []Segment {
	if !fog.valid {
		build_occluders(&fog.occluders, WALL_LIGHT_INSET)
		fog.valid = true
		fog.occluder_version += 1
	}
	return fog.occluders[:]
}

build_occluders :: proc(out: ^[dynamic]Segment, inset: f64) {
	clear(out)
	width, height := grid.width, grid.height
	cs := f64(grid.cell_size)
	blocking :: #force_inline proc(x, y: int) -> bool {
		if x < 0 || y < 0 || x >= grid.width || y >= grid.height do return true
		c := grid.cells[y * grid.width + x]
		return c != nil ? c.blocks_vision : true
	}
	for side in ([2]int{-1, 1}) {
		for y in 0 ..< height {
			line_y := (side == -1 ? f64(y) * cs : f64(y + 1) * cs) - f64(side) * inset
			run := -1
			for x in 0 ..= width {
				edge := x < width && blocking(x, y) && !blocking(x, y + side)
				if edge && run < 0 do run = x
				else if !edge && run >= 0 {
					append(out, Segment{f64(run) * cs, line_y, f64(x) * cs, line_y})
					run = -1
				}
			}
		}
	}
	for side in ([2]int{-1, 1}) {
		for x in 0 ..< width {
			line_x := (side == -1 ? f64(x) * cs : f64(x + 1) * cs) - f64(side) * inset
			run := -1
			for y in 0 ..= height {
				edge := y < height && blocking(x, y) && !blocking(x + side, y)
				if edge && run < 0 do run = y
				else if !edge && run >= 0 {
					append(out, Segment{line_x, f64(run) * cs, line_x, f64(y) * cs})
					run = -1
				}
			}
		}
	}
	w := f64(width) * cs
	h := f64(height) * cs
	append(out, Segment{0, 0, w, 0}, Segment{w, 0, w, h}, Segment{w, h, 0, h}, Segment{0, h, 0, 0})
}

CORNER_EPSILON :: 0.00015
TWO_PI :: math.PI * 2

// computeVisibility. `cone` < 0 means a full circle.
compute_visibility :: proc(out: ^[dynamic]f64, ox, oy: f64, segments: []Segment, radius: f64, facing: f64 = 0, cone: f64 = -1) {
	clear(out)
	limited := cone >= 0 && cone < TWO_PI
	span := limited ? cone : TWO_PI
	start := limited ? facing - span / 2 : -math.PI
	near := &fog.near
	clear(near)
	for s in segments {
		if min(s.x1, s.x2) > ox + radius do continue
		if max(s.x1, s.x2) < ox - radius do continue
		if min(s.y1, s.y2) > oy + radius do continue
		if max(s.y1, s.y2) < oy - radius do continue
		append(near, s)
	}
	angles := &fog.angles
	clear(angles)
	norm :: #force_inline proc(a: f64) -> f64 {
		r := js_mod(a, TWO_PI)
		return r < 0 ? r + TWO_PI : r
	}
	push :: #force_inline proc(angles: ^[dynamic]f64, a, start, span: f64) {
		rel := norm(a - start)
		if rel <= span do append(angles, rel)
	}
	for s in near {
		a1 := math.atan2(s.y1 - oy, s.x1 - ox)
		a2 := math.atan2(s.y2 - oy, s.x2 - ox)
		push(angles, a1 - CORNER_EPSILON, start, span)
		push(angles, a1 + CORNER_EPSILON, start, span)
		push(angles, a2 - CORNER_EPSILON, start, span)
		push(angles, a2 + CORNER_EPSILON, start, span)
	}
	samples := 64
	step := span / f64(samples)
	for i in 0 ..= samples do append(angles, min(f64(i) * step, span))
	slice.sort(angles[:])
	if limited do append(out, ox, oy)
	last_x := math.nan_f64()
	last_y := math.nan_f64()
	for rel in angles {
		angle := start + rel
		dx := math.cos(angle)
		dy := math.sin(angle)
		best := radius
		for &s in near {
			t := ray_segment(ox, oy, dx, dy, &s)
			if t >= 0 && t < best do best = t
		}
		px := ox + dx * best
		py := oy + dy * best
		if abs(px - last_x) < 0.01 && abs(py - last_y) < 0.01 do continue
		append(out, px, py)
		last_x = px
		last_y = py
	}
}

ray_segment :: #force_inline proc(ox, oy, dx, dy: f64, s: ^Segment) -> f64 {
	sx := s.x2 - s.x1
	sy := s.y2 - s.y1
	denom := dx * sy - dy * sx
	if denom > -1e-12 && denom < 1e-12 do return -1
	ax := s.x1 - ox
	ay := s.y1 - oy
	t := (ax * sy - ay * sx) / denom
	if t < 0 do return -1
	u := (ax * dy - ay * dx) / denom
	if u < 0 || u > 1 do return -1
	return t
}

safe_origin :: proc(x, y, fx, fy: f64) -> Point {
	if is_wall_sight_blocking(x, y) do return {fx, fy}
	return {x, y}
}

fog_poly_slot :: proc(i: int) -> ^[dynamic]f64 {
	for len(fog.polys) <= i {
		append(&fog.polys, [dynamic]f64{})
		append(&fog.poly_cone, false)
	}
	return &fog.polys[i]
}

fog_poly_count: int

// updateFog: once per rendered frame, after the simulation steps.
fog_update :: proc() {
	if !enable_los || fog.node == nil do return
	segments := fog_current_occluders()
	fog_poly_count = 0
	view := Point{hero.x, hero.y}
	if spyglass_valid do view = safe_origin(spyglass_pos.x, spyglass_pos.y, hero.x, hero.y)
	fog_view_origin = view
	p := fog_poly_slot(0)
	compute_visibility(p, view.x, view.y, segments, FOG_RADIUS)
	if len(p) >= 6 {
		fog.poly_cone[0] = false
		fog_poly_count = 1
	}
	for cam in security_cameras {
		if !cam.hacked || !cam.alive do continue
		o := safe_origin(cam.x, cam.y, cam.losx, cam.losy)
		q := fog_poly_slot(fog_poly_count)
		compute_visibility(q, o.x, o.y, segments, FOG_RADIUS, cam.rad, CAMERA_CONE)
		if len(q) >= 6 {
			fog.poly_cone[fog_poly_count] = true
			fog_poly_count += 1
		}
	}
}

// Called from the scene walk for the fog node.
draw_fog :: proc(m: Mat, world_alpha: f64) {
	sgl.load_pipeline(rs.pip_stencil_write)
	use_no_texture()
	sgl.begin_triangles()
	sgl.c4b(0, 0, 0, 255)
	for i in 0 ..< fog_poly_count {
		pts := fog.polys[i][:]
		n := len(pts) / 2
		if fog.poly_cone[i] {
			// starts with the origin: fan from it
			ox, oy := mat_apply(m, pts[0], pts[1])
			for k in 1 ..< n - 1 {
				x0, y0 := mat_apply(m, pts[k * 2], pts[k * 2 + 1])
				x1, y1 := mat_apply(m, pts[k * 2 + 2], pts[k * 2 + 3])
				sgl.v2f_t2f(ox, oy, 0.5, 0.5)
				sgl.v2f_t2f(x0, y0, 0.5, 0.5)
				sgl.v2f_t2f(x1, y1, 0.5, 0.5)
			}
		} else {
			// radially sorted around the viewpoint: fan from the viewpoint, closed
			// the viewpoint is not in the list but every point is visible from it
			ox, oy := mat_apply(m, fog_view_origin.x, fog_view_origin.y)
			for k in 0 ..< n {
				j := (k + 1) % n
				x0, y0 := mat_apply(m, pts[k * 2], pts[k * 2 + 1])
				x1, y1 := mat_apply(m, pts[j * 2], pts[j * 2 + 1])
				sgl.v2f_t2f(ox, oy, 0.5, 0.5)
				sgl.v2f_t2f(x0, y0, 0.5, 0.5)
				sgl.v2f_t2f(x1, y1, 0.5, 0.5)
			}
		}
	}
	sgl.end()
	sgl.load_pipeline(rs.pip_stencil_test)
	gw := f64(grid.width * grid.cell_size)
	gh := f64(grid.height * grid.cell_size)
	fill_quad(m, 0, 0, gw, gh, 0x000000, 0.75 * world_alpha)
	sgl.load_pipeline(rs.pip_alpha)
}

fog_view_origin: Point
