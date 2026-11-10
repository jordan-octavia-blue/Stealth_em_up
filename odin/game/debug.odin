package game

// systems/nav_debug.ts (N), systems/physics_debug.ts (B), systems/breach_debug.ts (H).

import "core:math"

NAV_DEBUG_MODES := [6]string{"off", "paths", "mesh", "regions", "danger", "flow"}
PHYSICS_DEBUG_MODES := [4]string{"off", "fixtures", "occluders", "polygon"}
BREACH_DEBUG_MODES := [3]string{"off", "materials", "hp"}

REGION_COLORS := [8]u32{0x4fc3f7, 0xffb74d, 0x81c784, 0xe57373, 0xba68c8, 0x4db6ac, 0xfff176, 0xa1887f}

nav_dbg, phys_dbg, breach_dbg: struct {
	mode:     int,
	graphics: ^Node,
}

ensure_dbg_graphics :: proc(g: ^^Node) -> ^Node {
	if g^ == nil || g^.parent == nil {
		g^ = new_graphics()
		add_child(display_actors, g^)
	}
	return g^
}

nav_debug_cycle :: proc() -> string {
	nav_dbg.mode = (nav_dbg.mode + 1) % len(NAV_DEBUG_MODES)
	if nav_dbg.graphics != nil && nav_dbg.mode == 0 do g_clear(nav_dbg.graphics)
	return NAV_DEBUG_MODES[nav_dbg.mode]
}
nav_debug_reset :: proc() { nav_dbg = {} }

physics_debug_cycle :: proc() -> string {
	phys_dbg.mode = (phys_dbg.mode + 1) % len(PHYSICS_DEBUG_MODES)
	if phys_dbg.graphics != nil && phys_dbg.mode == 0 do g_clear(phys_dbg.graphics)
	return PHYSICS_DEBUG_MODES[phys_dbg.mode]
}
physics_debug_reset :: proc() { phys_dbg = {} }

breach_debug_cycle :: proc() -> string {
	breach_dbg.mode = (breach_dbg.mode + 1) % len(BREACH_DEBUG_MODES)
	if breach_dbg.graphics != nil && breach_dbg.mode == 0 do g_clear(breach_dbg.graphics)
	return BREACH_DEBUG_MODES[breach_dbg.mode]
}
breach_debug_reset :: proc() { breach_dbg = {} }

peak_danger :: proc(g: ^Nav_Grid) -> f64 {
	peak := 0.0
	for d in g.danger_cost do if f64(d) > peak do peak = f64(d)
	return peak
}

nav_debug_draw :: proc() {
	if nav_dbg.mode == 0 || !nav_ready() do return
	g := ensure_dbg_graphics(&nav_dbg.graphics)
	g_clear(g)
	ng := nav.grid
	cs := ng.cell_size
	switch NAV_DEBUG_MODES[nav_dbg.mode] {
	case "mesh":
		for i in 0 ..< ng.size {
			x := f64(ng_cell_x(ng, i)) * cs
			y := f64(ng_cell_y(ng, i)) * cs
			if ng.walkable[i] == 1 {
				g_line_style(g, 1, 0x00ff88, 0.55)
				g_begin_fill(g, 0x00ff88, 0.06)
				g_draw_rect(g, x, y, cs, cs)
				g_end_fill(g)
			} else {
				g_line_style(g, 2, 0xff3366, 0.95)
				g_begin_fill(g, 0xff1133, 0.4)
				g_draw_rect(g, x + 1, y + 1, cs - 2, cs - 2)
				g_end_fill(g)
			}
		}
		g_line_style(g, 0, 0, 0)
		return
	case "regions":
		regions := nav_regions()
		for i in 0 ..< ng.size {
			label := region_label_at(regions, i)
			if label == -1 do continue
			col := REGION_COLORS[label % len(REGION_COLORS)]
			g_line_style(g, 1, col, 0.9)
			g_begin_fill(g, col, 0.5)
			g_draw_rect(g, f64(ng_cell_x(ng, i)) * cs, f64(ng_cell_y(ng, i)) * cs, cs, cs)
			g_end_fill(g)
		}
		g_line_style(g, 0, 0, 0)
		return
	case "danger":
		peak := peak_danger(ng)
		if peak <= 0 do return
		for i in 0 ..< ng.size {
			d := f64(ng.danger_cost[i])
			if d <= 0 do continue
			g_begin_fill(g, 0xff2200, 0.1 + 0.6 * (d / peak))
			g_draw_rect(g, f64(ng_cell_x(ng, i)) * cs, f64(ng_cell_y(ng, i)) * cs, cs, cs)
			g_end_fill(g)
		}
		return
	case "flow":
		field := nav.field
		if field == nil do return
		g_line_style(g, 2, 0x00e5ff, 0.8)
		half := cs / 2
		for i in 0 ..< ng.size {
			dir := field.dir[i]
			if dir == -1 do continue
			cx := f64(ng_cell_x(ng, i)) * cs + half
			cy := f64(ng_cell_y(ng, i)) * cs + half
			g_move_to(g, cx, cy)
			g_line_to(g, cx + f64(DIR_X[dir]) * half * 0.8, cy + f64(DIR_Y[dir]) * half * 0.8)
		}
		if field.target != -1 {
			tx, ty := ng_point_at_index(ng, field.target)
			g_line_style(g, 2, 0xff00ff, 1)
			g_draw_circle(g, tx, ty, 10)
		}
		return
	}
	// paths
	waypoints := make([dynamic]Point, context.temp_allocator)
	for guard in guards {
		if !guard.alive || guard.target == nil || guard.target.null do continue
		g_line_style(g, 2, 0x00ff88, 0.9)
		g_move_to(g, guard.target.x, guard.target.y)
		append(&waypoints, Point{guard.target.x, guard.target.y})
		for p in guard.path {
			g_line_to(g, p.x, p.y)
			append(&waypoints, Point{p.x, p.y})
		}
	}
	for guard in guards {
		if !guard.alive || guard.target == nil || guard.target.null do continue
		g_line_style(g, 4, 0xffb300, 0.95)
		g_move_to(g, guard.x, guard.y)
		g_line_to(g, guard.target.x, guard.target.y)
	}
	g_line_style(g, 0, 0, 0)
	g_begin_fill(g, 0x00ff88, 0.9)
	for p in waypoints do g_draw_circle(g, p.x, p.y, 3)
	g_end_fill(g)
}

phys_debug_target: ^Node

physics_debug_draw :: proc() {
	if phys_dbg.mode == 0 || !physics.built do return
	g := ensure_dbg_graphics(&phys_dbg.graphics)
	g_clear(g)
	switch PHYSICS_DEBUG_MODES[phys_dbg.mode] {
	case "fixtures":
		phys_debug_target = g
		physics_for_each_fixture(proc(s: Debug_Shape) {
			g := phys_debug_target
			is_door := s.category & CAT_DOOR != 0
			color: u32
			switch {
			case s.kind == .Car: color = 0xff5252
			case s.kind == .Trigger: color = 0x9c27b0
			case is_door: color = 0xffb300
			case s.kind == .Actor: color = 0x00e5ff
			case: color = 0x9e9e9e
			}
			g_line_style(g, s.sensor ? 1 : 2, color, s.sensor ? 0.5 : 0.9)
			if s.is_circle {
				g_draw_circle(g, s.cx, s.cy, s.r)
			} else if s.poly_n >= 2 {
				pts := make([dynamic]f64, 0, s.poly_n * 2 + 2, context.temp_allocator)
				for i in 0 ..< s.poly_n * 2 do append(&pts, s.poly[i])
				append(&pts, s.poly[0], s.poly[1])
				g_draw_polygon(g, pts[:])
			}
		})
		return
	case "occluders":
		segs := fog_current_occluders()
		g_line_style(g, 2, 0xff4081, 0.9)
		for s in segs {
			g_move_to(g, s.x1, s.y1)
			g_line_to(g, s.x2, s.y2)
		}
		return
	}
	segs := fog_current_occluders()
	o := spyglass_valid ? spyglass_pos : Point{hero.x, hero.y}
	poly := make([dynamic]f64, context.temp_allocator)
	compute_visibility(&poly, o.x, o.y, segs, FOG_RADIUS)
	if len(poly) < 6 do return
	g_line_style(g, 2, 0x76ff03, 0.9)
	g_draw_polygon(g, poly[:])
}

breach_debug_draw :: proc() {
	if breach_dbg.mode == 0 || grid.cells == nil do return
	g := ensure_dbg_graphics(&breach_dbg.graphics)
	g_clear(g)
	cs := f64(grid.cell_size)
	if BREACH_DEBUG_MODES[breach_dbg.mode] == "materials" {
		for c in grid.cells {
			if !(c.solid || c.door) do continue
			material := c.material == .None ? Material.Brick : c.material
			color: u32
			#partial switch material {
			case .Drywall: color = 0x66bb6a
			case .Brick: color = 0xff9800
			case .Concrete: color = 0x9e9e9e
			case .Steel: color = 0x5c6bc0
			case: continue
			}
			g_begin_fill(g, color, 0.35)
			g_draw_rect(g, c.x, c.y, cs, cs)
			g_end_fill(g)
		}
		return
	}
	bar_h := 6.0
	for c in grid.cells {
		if !(c.solid || c.door) do continue
		mx := c.max_hp
		if mx <= 0 do continue
		frac := max(0, min(1, c.hp / mx))
		g_begin_fill(g, 0x000000, 0.5)
		g_draw_rect(g, c.x + 2, c.y + 2, cs - 4, bar_h)
		g_end_fill(g)
		red := u32(math.round(255 * (1 - frac)))
		green := u32(math.round(255 * frac))
		g_begin_fill(g, (red << 16) | (green << 8), 0.9)
		g_draw_rect(g, c.x + 2, c.y + 2, (cs - 4) * frac, bar_h)
		g_end_fill(g)
	}
}
