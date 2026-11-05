package game

// src/nav/*: nav grid, A*, flow field, regions, danger, string pulling and the
// budgeted path scheduler. Costs and scores are stored as f32 (Float32Array in the web
// build) and combined in f64, so A* breaks ties exactly the same way.

import "core:math"
import "core:time"

DIR_X := [8]int{1, 0, -1, 0, 1, 1, -1, -1}
DIR_Y := [8]int{0, 1, 0, -1, 1, -1, 1, -1}
DIR_COST := [8]f64{1, 1, 1, 1, math.SQRT_TWO, math.SQRT_TWO, math.SQRT_TWO, math.SQRT_TWO}
OPPOSITE_DIR := [8]i8{2, 3, 0, 1, 7, 6, 5, 4}
ORTHOGONAL_DIRS :: 4
ALL_DIRS :: 8

DOOR_COST :: 1.5
RESTRICTED_COST :: 1.15
RUBBLE_COST :: 1.4
DANGER_HALF_LIFE_S :: 8.0
MAX_DANGER :: 12.0

// A waypoint. Heap-allocated and shared by reference exactly like the JS {x, y} objects
// (a guard's `target` *is* the point it shifted off its path), with `null` standing in
// for `target.x = null`.
Path_Point :: struct {
	x, y:    f64,
	null:    bool,
	mark:    bool, // point-pool sweep (see sprite.odin)
	in_free: bool,
}

Path :: [dynamic]^Path_Point

null_point :: proc() -> ^Path_Point {
	p := new_point(0, 0)
	p.null = true
	return p
}

Nav_Grid :: struct {
	width, height, size: int,
	cell_size:           f64,
	walkable:            []u8,
	base_cost:           []f32,
	door_cost:           []f32,
	danger_cost:         []f32,
	version:             int,
	g_score:             []f32,
	f_score:             []f32,
	came_from:           []i32,
	state:               []u8,
	stamp:               []u32,
	generation:          u32,
}

nav_grid_make :: proc(width, height: int, cell_size: f64) -> ^Nav_Grid {
	g := new(Nav_Grid)
	g.width = width
	g.height = height
	g.size = width * height
	g.cell_size = cell_size
	g.walkable = make([]u8, g.size)
	g.base_cost = make([]f32, g.size)
	for &c in g.base_cost do c = 1
	g.door_cost = make([]f32, g.size)
	g.danger_cost = make([]f32, g.size)
	g.g_score = make([]f32, g.size)
	g.f_score = make([]f32, g.size)
	g.came_from = make([]i32, g.size)
	g.state = make([]u8, g.size)
	g.stamp = make([]u32, g.size)
	return g
}

nav_grid_free :: proc(g: ^Nav_Grid) {
	if g == nil do return
	delete(g.walkable); delete(g.base_cost); delete(g.door_cost); delete(g.danger_cost)
	delete(g.g_score); delete(g.f_score); delete(g.came_from); delete(g.state); delete(g.stamp)
	free(g)
}

ng_in_bounds :: #force_inline proc(g: ^Nav_Grid, cx, cy: int) -> bool {
	return cx >= 0 && cy >= 0 && cx < g.width && cy < g.height
}
ng_index :: #force_inline proc(g: ^Nav_Grid, cx, cy: int) -> int { return cy * g.width + cx }
ng_cell_x :: #force_inline proc(g: ^Nav_Grid, i: int) -> int { return i % g.width }
ng_cell_y :: #force_inline proc(g: ^Nav_Grid, i: int) -> int { return i / g.width }

ng_index_at_point :: proc(g: ^Nav_Grid, x, y: f64) -> int {
	fx := math.floor(x / g.cell_size)
	fy := math.floor(y / g.cell_size)
	if fx != fx || fy != fy do return -1 // NaN
	if fx < 0 || fy < 0 || fx >= f64(g.width) || fy >= f64(g.height) do return -1
	return ng_index(g, int(fx), int(fy))
}

ng_point_at_index :: proc(g: ^Nav_Grid, i: int) -> (f64, f64) {
	half := g.cell_size / 2
	return f64(ng_cell_x(g, i)) * g.cell_size + half, f64(ng_cell_y(g, i)) * g.cell_size + half
}

ng_is_walkable :: proc(g: ^Nav_Grid, i: int) -> bool {
	return i >= 0 && i < g.size && g.walkable[i] == 1
}

ng_cost_at :: #force_inline proc(g: ^Nav_Grid, i: int) -> f64 {
	cost := f64(g.base_cost[i]) + f64(g.door_cost[i]) + f64(g.danger_cost[i])
	return cost > 0.01 ? cost : 0.01
}

ng_set_walkable :: proc(g: ^Nav_Grid, i: int, walkable: bool) -> bool {
	next: u8 = walkable ? 1 : 0
	if g.walkable[i] == next do return false
	g.walkable[i] = next
	g.version += 1
	return true
}

ng_can_step :: #force_inline proc(g: ^Nav_Grid, i: int, dir: int) -> bool {
	cx := ng_cell_x(g, i)
	cy := ng_cell_y(g, i)
	nx := cx + DIR_X[dir]
	ny := cy + DIR_Y[dir]
	if !ng_in_bounds(g, nx, ny) do return false
	if g.walkable[ng_index(g, nx, ny)] != 1 do return false
	if dir < ORTHOGONAL_DIRS do return true
	return g.walkable[ng_index(g, nx, cy)] == 1 && g.walkable[ng_index(g, cx, ny)] == 1
}

ng_neighbor :: #force_inline proc(g: ^Nav_Grid, i: int, dir: int) -> int {
	if !ng_can_step(g, i, dir) do return -1
	return ng_index(g, ng_cell_x(g, i) + DIR_X[dir], ng_cell_y(g, i) + DIR_Y[dir])
}

ng_begin_search :: proc(g: ^Nav_Grid) {
	g.generation += 1
	if g.generation == 0xffffffff {
		for &s in g.stamp do s = 0
		g.generation = 1
	}
}

ng_nearest_walkable :: proc(g: ^Nav_Grid, index: int, max_radius := 8) -> int {
	if index < 0 || index >= g.size do return -1
	if g.walkable[index] == 1 do return index
	cx := ng_cell_x(g, index)
	cy := ng_cell_y(g, index)
	for r in 1 ..= max_radius {
		best := -1
		best_dist := max(int)
		for dy in -r ..= r {
			for dx in -r ..= r {
				if abs(dx) != r && abs(dy) != r do continue
				nx := cx + dx
				ny := cy + dy
				if !ng_in_bounds(g, nx, ny) do continue
				ni := ng_index(g, nx, ny)
				if g.walkable[ni] != 1 do continue
				d := dx * dx + dy * dy
				if d < best_dist {
					best_dist = d
					best = ni
				}
			}
		}
		if best != -1 do return best
	}
	return -1
}

// ---------------------------------------------------------------- binary heap

Index_Heap :: struct {
	items: [dynamic]i32,
}

heap_push :: proc(h: ^Index_Heap, index: int, score: []f32) {
	append(&h.items, i32(index))
	i := len(h.items) - 1
	for i > 0 {
		parent := (i - 1) >> 1
		if score[h.items[parent]] <= score[h.items[i]] do break
		h.items[parent], h.items[i] = h.items[i], h.items[parent]
		i = parent
	}
}

heap_pop :: proc(h: ^Index_Heap, score: []f32) -> int {
	if len(h.items) == 0 do return -1
	top := int(h.items[0])
	last := pop(&h.items)
	count := len(h.items)
	if count > 0 {
		h.items[0] = last
		i := 0
		for {
			left := i * 2 + 1
			right := left + 1
			smallest := i
			if left < count && score[h.items[left]] < score[h.items[smallest]] do smallest = left
			if right < count && score[h.items[right]] < score[h.items[smallest]] do smallest = right
			if smallest == i do break
			h.items[smallest], h.items[i] = h.items[i], h.items[smallest]
			i = smallest
		}
	}
	return top
}

// ---------------------------------------------------------------- A*

OCTILE_D2_MINUS_2D :: math.SQRT_TWO - 2

octile :: proc(ax, ay, bx, by: int) -> f64 {
	dx := f64(abs(ax - bx))
	dy := f64(abs(ay - by))
	return dx + dy + OCTILE_D2_MINUS_2D * min(dx, dy)
}

astar_heap: Index_Heap

find_path :: proc(g: ^Nav_Grid, start, goal: int, out: ^[dynamic]int) -> bool {
	clear(out)
	if start < 0 || goal < 0 || start >= g.size || goal >= g.size do return false
	if !ng_is_walkable(g, start) || !ng_is_walkable(g, goal) do return false
	if start == goal {
		append(out, start)
		return true
	}
	goal_x := ng_cell_x(g, goal)
	goal_y := ng_cell_y(g, goal)
	ng_begin_search(g)
	clear(&astar_heap.items)
	g.stamp[start] = g.generation
	g.g_score[start] = 0
	g.f_score[start] = f32(octile(ng_cell_x(g, start), ng_cell_y(g, start), goal_x, goal_y))
	g.came_from[start] = -1
	g.state[start] = 1
	heap_push(&astar_heap, start, g.f_score)
	for len(astar_heap.items) > 0 {
		current := heap_pop(&astar_heap, g.f_score)
		if g.state[current] == 2 do continue
		g.state[current] = 2
		if current == goal {
			node := current
			for node != -1 {
				append(out, node)
				node = int(g.came_from[node])
			}
			// reverse
			n := len(out)
			for i in 0 ..< n / 2 do out[i], out[n - 1 - i] = out[n - 1 - i], out[i]
			return true
		}
		for dir in 0 ..< ALL_DIRS {
			next := ng_neighbor(g, current, dir)
			if next == -1 do continue
			seen := g.stamp[next] == g.generation
			if seen && g.state[next] == 2 do continue
			tentative := f64(g.g_score[current]) + DIR_COST[dir] * ng_cost_at(g, next)
			if seen && g.state[next] == 1 && f64(g.g_score[next]) <= tentative do continue
			g.stamp[next] = g.generation
			g.came_from[next] = i32(current)
			g.g_score[next] = f32(tentative)
			g.f_score[next] = f32(tentative + octile(ng_cell_x(g, next), ng_cell_y(g, next), goal_x, goal_y))
			g.state[next] = 1
			heap_push(&astar_heap, next, g.f_score)
		}
	}
	return false
}

// ---------------------------------------------------------------- flow field

Flow_Field :: struct {
	distance: []f32,
	dir:      []i8,
	target:   int,
	version:  int,
}

flow_heap: Index_Heap
flow_closed: []u8

compute_flow_field :: proc(g: ^Nav_Grid, target: int, into: ^Flow_Field) -> ^Flow_Field {
	field := into
	if field == nil {
		field = new(Flow_Field)
		field.distance = make([]f32, g.size)
		field.dir = make([]i8, g.size)
	}
	for &d in field.distance do d = math.inf_f32(1)
	for &d in field.dir do d = -1
	field.target = target
	field.version = g.version
	if !ng_is_walkable(g, target) do return field
	if len(flow_closed) < g.size {
		delete(flow_closed)
		flow_closed = make([]u8, g.size)
	}
	for i in 0 ..< g.size do flow_closed[i] = 0
	clear(&flow_heap.items)
	field.distance[target] = 0
	heap_push(&flow_heap, target, field.distance)
	for len(flow_heap.items) > 0 {
		current := heap_pop(&flow_heap, field.distance)
		if flow_closed[current] == 1 do continue
		flow_closed[current] = 1
		for d in 0 ..< ALL_DIRS {
			next := ng_neighbor(g, current, d)
			if next == -1 || flow_closed[next] == 1 do continue
			candidate := f64(field.distance[current]) + DIR_COST[d] * ng_cost_at(g, current)
			if candidate >= f64(field.distance[next]) do continue
			field.distance[next] = f32(candidate)
			field.dir[next] = OPPOSITE_DIR[d]
			heap_push(&flow_heap, next, field.distance)
		}
	}
	return field
}

field_reachable :: proc(f: ^Flow_Field, i: int) -> bool {
	return i >= 0 && i < len(f.distance) && !math.is_inf(f.distance[i])
}

path_from_field :: proc(g: ^Nav_Grid, f: ^Flow_Field, start: int, out: ^[dynamic]int) -> bool {
	clear(out)
	if !field_reachable(f, start) do return false
	append(out, start)
	current := start
	for guard := 0; guard <= g.size && current != f.target; guard += 1 {
		d := f.dir[current]
		if d == -1 {
			clear(out)
			return false
		}
		next := ng_index(g, ng_cell_x(g, current) + DIR_X[d], ng_cell_y(g, current) + DIR_Y[d])
		append(out, next)
		current = next
	}
	if current != f.target {
		clear(out)
		return false
	}
	return true
}

// ---------------------------------------------------------------- regions

Region_Map :: struct {
	labels:  []i32,
	cells:   [dynamic][dynamic]int,
	version: int,
}

label_regions :: proc(g: ^Nav_Grid, into: ^Region_Map) -> ^Region_Map {
	m := into
	if m == nil {
		m = new(Region_Map)
		m.labels = make([]i32, g.size)
	}
	for &l in m.labels do l = -1
	for &c in m.cells do delete(c)
	clear(&m.cells)
	stack := make([dynamic]int, 0, 256, context.temp_allocator)
	for seed in 0 ..< g.size {
		if g.walkable[seed] != 1 || m.labels[seed] != -1 do continue
		label := len(m.cells)
		append(&m.cells, make([dynamic]int))
		members := &m.cells[label]
		m.labels[seed] = i32(label)
		append(members, seed)
		append(&stack, seed)
		for len(stack) > 0 {
			current := pop(&stack)
			for dir in 0 ..< ALL_DIRS {
				next := ng_neighbor(g, current, dir)
				if next == -1 || m.labels[next] != -1 do continue
				m.labels[next] = i32(label)
				append(members, next)
				append(&stack, next)
			}
		}
	}
	m.version = g.version
	return m
}

region_label_at :: proc(m: ^Region_Map, i: int) -> int {
	if i < 0 || i >= len(m.labels) do return -1
	return int(m.labels[i])
}

region_connected :: proc(m: ^Region_Map, a, b: int) -> bool {
	la := region_label_at(m, a)
	return la != -1 && la == region_label_at(m, b)
}

region_random_cell :: proc(m: ^Region_Map, i: int) -> int {
	label := region_label_at(m, i)
	if label == -1 do return -1
	members := m.cells[label]
	if len(members) == 0 do return -1
	return members[int(math.floor(random() * f64(len(members)))) % len(members)]
}

// ---------------------------------------------------------------- danger

deposit_danger :: proc(g: ^Nav_Grid, center: int, amount, radius: f64) {
	if center < 0 || center >= g.size || amount <= 0 do return
	cx := ng_cell_x(g, center)
	cy := ng_cell_y(g, center)
	r := max(0, int(math.floor(radius)))
	for dy in -r ..= r {
		for dx in -r ..= r {
			nx := cx + dx
			ny := cy + dy
			if !ng_in_bounds(g, nx, ny) do continue
			index := ng_index(g, nx, ny)
			if g.walkable[index] != 1 do continue
			dist := math.sqrt(f64(dx * dx + dy * dy))
			if dist > f64(r) do continue
			falloff := r == 0 ? 1 : 1 - dist / f64(r + 1)
			next := f64(g.danger_cost[index]) + amount * falloff
			g.danger_cost[index] = f32(next > MAX_DANGER ? MAX_DANGER : next)
		}
	}
}

decay_danger :: proc(g: ^Nav_Grid, dt_seconds, half_life: f64, epsilon := 0.01) {
	if dt_seconds <= 0 || half_life <= 0 do return
	factor := math.pow(0.5, dt_seconds / half_life)
	for &d in g.danger_cost {
		if d == 0 do continue
		next := f64(d) * factor
		d = next < epsilon ? 0 : f32(next)
	}
}

// ---------------------------------------------------------------- smoothing

segment_walkable :: proc(g: ^Nav_Grid, x0, y0, x1, y1: f64) -> bool {
	cs := g.cell_size
	cxf := math.floor(x0 / cs)
	cyf := math.floor(y0 / cs)
	end_x := math.floor(x1 / cs)
	end_y := math.floor(y1 / cs)
	dx := x1 - x0
	dy := y1 - y0
	step_x := dx > 0 ? 1.0 : dx < 0 ? -1.0 : 0.0
	step_y := dy > 0 ? 1.0 : dy < 0 ? -1.0 : 0.0
	INF :: math.INF_F64
	t_delta_x := step_x == 0 ? INF : cs / abs(dx)
	t_delta_y := step_y == 0 ? INF : cs / abs(dy)
	t_max_x := step_x == 0 ? INF : step_x > 0 ? ((cxf + 1) * cs - x0) / dx : (cxf * cs - x0) / dx
	t_max_y := step_y == 0 ? INF : step_y > 0 ? ((cyf + 1) * cs - y0) / dy : (cyf * cs - y0) / dy
	for {
		if cxf < 0 || cyf < 0 || cxf >= f64(g.width) || cyf >= f64(g.height) do return false
		if g.walkable[ng_index(g, int(cxf), int(cyf))] != 1 do return false
		if cxf == end_x && cyf == end_y do return true
		if t_max_x < t_max_y {
			if t_max_x > 1 do return true
			cxf += step_x
			t_max_x += t_delta_x
		} else {
			if t_max_y > 1 do return true
			cyf += step_y
			t_max_y += t_delta_y
		}
	}
}

corridor_walkable :: proc(g: ^Nav_Grid, ax, ay, bx, by, radius: f64) -> bool {
	if radius <= 0 do return segment_walkable(g, ax, ay, bx, by)
	dx := bx - ax
	dy := by - ay
	l := math.hypot(dx, dy)
	if l == 0 do return ng_is_walkable(g, ng_index_at_point(g, ax, ay))
	nx := (-dy / l) * radius
	ny := (dx / l) * radius
	return segment_walkable(g, ax + nx, ay + ny, bx + nx, by + ny) && segment_walkable(g, ax - nx, ay - ny, bx - nx, by - ny)
}

smooth_path :: proc(g: ^Nav_Grid, cells: []int, radius: f64, start: ^Point) -> Path {
	out: Path
	if len(cells) == 0 do return out
	pts := make([]Point, len(cells), context.temp_allocator)
	for c, i in cells {
		x, y := ng_point_at_index(g, c)
		pts[i] = {x, y}
	}
	start_centre := pts[0]
	if start != nil do pts[0] = start^
	anchor := 0
	idx := make([dynamic]int, 0, 16, context.temp_allocator)
	for anchor < len(pts) - 1 {
		furthest := anchor + 1
		for i := anchor + 2; i < len(pts); i += 1 {
			if !corridor_walkable(g, pts[anchor].x, pts[anchor].y, pts[i].x, pts[i].y, radius) do break
			furthest = i
		}
		append(&idx, furthest)
		anchor = furthest
	}
	if start != nil && len(idx) > 0 && !corridor_walkable(g, pts[0].x, pts[0].y, pts[idx[0]].x, pts[idx[0]].y, radius) {
		append(&out, new_point(start_centre.x, start_centre.y))
	}
	for i in idx do append(&out, new_point(pts[i].x, pts[i].y))
	return out
}

// ---------------------------------------------------------------- scheduler

Path_Priority :: enum int { Patrol = 0, Investigate = 1, Combat = 2 }

Path_Callback :: enum u8 { None, Patrol, Squad_Set_If_Any }

Path_Request :: struct {
	owner:    ^Sprite,
	from, to: Point,
	priority: Path_Priority,
	radius:   f64,
	callback: Path_Callback,
}

Sched_Entry :: struct {
	req:       Path_Request,
	seq:       int,
	cancelled: bool,
}

Nav :: struct {
	grid:           ^Nav_Grid,
	region_map:     ^Region_Map,
	field:          ^Flow_Field,
	field_rebuilds: int,
	queue:          [dynamic]^Sched_Entry,
	seq:            int,
	searches:       int,
	coalesced:      int,
	cells_scratch:  [dynamic]int,
}

nav: Nav

nav_ready :: proc() -> bool { return nav.grid != nil }

nav_build :: proc() {
	nav_reset()
	g := nav_grid_make(grid.width, grid.height, f64(grid.cell_size))
	for i in 0 ..< g.size {
		cell := grid.cells[i]
		if cell == nil do continue
		g.walkable[i] = cell.solid && !cell.door ? 0 : 1
		g.base_cost[i] = cell.restricted ? RESTRICTED_COST : 1
		g.door_cost[i] = cell.door ? DOOR_COST : 0
	}
	g.version += 1
	nav.grid = g
	nav.region_map = label_regions(g, nil)
	nav.field = nil
	nav.field_rebuilds = 0
	sched_clear()
}

nav_reset :: proc() {
	if nav.region_map != nil {
		for &c in nav.region_map.cells do delete(c)
		delete(nav.region_map.cells)
		delete(nav.region_map.labels)
		free(nav.region_map)
	}
	if nav.field != nil {
		delete(nav.field.distance)
		delete(nav.field.dir)
		free(nav.field)
	}
	nav_grid_free(nav.grid)
	nav.grid = nil
	nav.region_map = nil
	nav.field = nil
	sched_clear()
}

nav_regions :: proc() -> ^Region_Map {
	if nav.region_map == nil || nav.region_map.version != nav.grid.version {
		nav.region_map = label_regions(nav.grid, nav.region_map)
	}
	return nav.region_map
}

nav_update :: proc(dt_ms: f64) {
	if nav.grid == nil do return
	decay_danger(nav.grid, dt_ms / 1000, DANGER_HALF_LIFE_S)
	sched_update()
}

nav_request_path :: proc(req: Path_Request) {
	if sched_remove_pending(req.owner) do nav.coalesced += 1
	e := new(Sched_Entry)
	e.req = req
	e.seq = nav.seq
	nav.seq += 1
	append(&nav.queue, e)
}

nav_has_pending_request :: proc(owner: ^Sprite) -> bool {
	for e in nav.queue do if e.req.owner == owner do return true
	return false
}

nav_cancel_request :: proc(owner: ^Sprite) { sched_remove_pending(owner) }

sched_remove_pending :: proc(owner: ^Sprite) -> bool {
	for e, i in nav.queue do if e.req.owner == owner {
		ordered_remove(&nav.queue, i)
		free(e)
		return true
	}
	return false
}

sched_clear :: proc() {
	for e in nav.queue do free(e)
	clear(&nav.queue)
	nav.seq = 0
}

SCHED_MAX_SEARCHES :: 4
SCHED_MAX_MILLIS :: 0.5

sched_update :: proc() {
	start := time.tick_now()
	searches := 0
	for len(nav.queue) > 0 && searches < SCHED_MAX_SEARCHES {
		if searches > 0 && time.duration_milliseconds(time.tick_since(start)) >= SCHED_MAX_MILLIS do break
		best := 0
		for i in 1 ..< len(nav.queue) {
			a := nav.queue[i]
			b := nav.queue[best]
			if a.req.priority > b.req.priority || (a.req.priority == b.req.priority && a.seq < b.seq) do best = i
		}
		e := nav.queue[best]
		ordered_remove(&nav.queue, best)
		req := e.req
		free(e)
		searches += 1
		path, ok := nav_solve(&req)
		if ok && len(path) > 0 {
			path_ready(req, path)
		} else {
			path_failed(req)
		}
	}
	nav.searches = searches
}

nav_solve :: proc(req: ^Path_Request) -> (Path, bool) {
	g := nav.grid
	if g == nil do return nil, false
	start := ng_nearest_walkable(g, ng_index_at_point(g, req.from.x, req.from.y))
	goal := ng_nearest_walkable(g, ng_index_at_point(g, req.to.x, req.to.y))
	if start == -1 || goal == -1 do return nil, false
	if !region_connected(nav_regions(), start, goal) do return nil, false
	if !find_path(g, start, goal, &nav.cells_scratch) do return nil, false
	if len(nav.cells_scratch) == 0 do return nil, false
	return smooth_path(g, nav.cells_scratch[:], req.radius, &req.from), true
}

nav_can_reach :: proc(from, to: Point) -> bool {
	g := nav.grid
	if g == nil do return false
	a := ng_nearest_walkable(g, ng_index_at_point(g, from.x, from.y))
	b := ng_nearest_walkable(g, ng_index_at_point(g, to.x, to.y))
	return region_connected(nav_regions(), a, b)
}

nav_random_destination_near :: proc(from: Point, min_cells_away := 3) -> (Point, bool) {
	g := nav.grid
	if g == nil do return {}, false
	start := ng_nearest_walkable(g, ng_index_at_point(g, from.x, from.y))
	if start == -1 do return {}, false
	sx := ng_cell_x(g, start)
	sy := ng_cell_y(g, start)
	fallback := -1
	for attempt in 0 ..< 8 {
		cell := region_random_cell(nav_regions(), start)
		if cell == -1 do return {}, false
		if cell == start do continue
		fallback = cell
		dx := ng_cell_x(g, cell) - sx
		dy := ng_cell_y(g, cell) - sy
		if abs(dx) >= min_cells_away || abs(dy) >= min_cells_away {
			x, y := ng_point_at_index(g, cell)
			return {x, y}, true
		}
	}
	if fallback == -1 do return {}, false
	x, y := ng_point_at_index(g, fallback)
	return {x, y}, true
}

nav_converge_to :: proc(from, to: Point, radius: f64 = 0) -> Path {
	g := nav.grid
	if g == nil do return nil
	target := ng_nearest_walkable(g, ng_index_at_point(g, to.x, to.y))
	start := ng_nearest_walkable(g, ng_index_at_point(g, from.x, from.y))
	if target == -1 || start == -1 do return nil
	if nav.field == nil || nav.field.target != target || nav.field.version != g.version {
		nav.field = compute_flow_field(g, target, nav.field)
		nav.field_rebuilds += 1
	}
	if !path_from_field(g, nav.field, start, &nav.cells_scratch) do return nil
	f := from
	return smooth_path(g, nav.cells_scratch[:], radius, &f)
}

nav_is_direct_path_clear :: proc(a, b: Point, radius: f64 = 0) -> bool {
	if nav.grid == nil do return true
	return corridor_walkable(nav.grid, a.x, a.y, b.x, b.y, radius)
}

// nav:dirty / cell:destroyed
nav_mark_dirty :: proc(index: int, walkable: bool) {
	g := nav.grid
	if g == nil do return
	if index < 0 || index >= g.size do return
	if !ng_set_walkable(g, index, walkable) do return
	if walkable {
		g.base_cost[index] = RUBBLE_COST
		g.door_cost[index] = 0
	} else {
		g.danger_cost[index] = 0
	}
	nav.field = nav_drop_field()
}

nav_drop_field :: proc() -> ^Flow_Field {
	// JS sets the field to null (garbage collected). Keep the buffers for reuse? No: a
	// null field also means `flowField` is absent for the debug overlay, so free it.
	if nav.field != nil {
		delete(nav.field.distance)
		delete(nav.field.dir)
		free(nav.field)
	}
	return nil
}

// nav:danger
nav_deposit :: proc(x, y, amount: f64, radius: f64 = 1) {
	g := nav.grid
	if g == nil do return
	index := ng_index_at_point(g, x, y)
	if index == -1 do return
	deposit_danger(g, index, amount, radius)
}

emit_nav_danger :: proc(x, y, amount, radius: f64) {
	nav_deposit(x, y, amount, radius)
}
