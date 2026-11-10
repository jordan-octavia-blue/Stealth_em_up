package game

// src/ai/squad.ts: the shared blackboard (fused belief, entry-point assignment, kill-box
// danger). Same greedy assignment, same tunables, same tie-breaking.

import "core:math"
import "core:slice"

Room_Map :: struct {
	labels:  []i32,
	version: int,
}

label_rooms :: proc(g: ^Nav_Grid, entry: ^map[int]bool, into: ^Room_Map) {
	if len(into.labels) != g.size {
		delete(into.labels)
		into.labels = make([]i32, g.size)
	}
	for &l in into.labels do l = -1
	stack := make([dynamic]int, 0, 64, context.temp_allocator)
	label: i32 = 0
	for seed in 0 ..< g.size {
		if g.walkable[seed] != 1 || seed in entry^ || into.labels[seed] != -1 do continue
		current := label
		label += 1
		into.labels[seed] = current
		append(&stack, seed)
		for len(stack) > 0 {
			cell := pop(&stack)
			for dir in 0 ..< ALL_DIRS {
				next := ng_neighbor(g, cell, dir)
				if next == -1 || next in entry^ || into.labels[next] != -1 do continue
				into.labels[next] = current
				append(&stack, next)
			}
		}
	}
	into.version = g.version
}

room_of_point :: proc(g: ^Nav_Grid, rooms: ^Room_Map, x, y: f64) -> int {
	index := ng_index_at_point(g, x, y)
	if index == -1 do return -1
	if rooms.labels[index] != -1 do return int(rooms.labels[index])
	near := ng_nearest_walkable(g, index)
	if near == -1 do return -1
	if rooms.labels[near] != -1 do return int(rooms.labels[near])
	for dir in 0 ..< ALL_DIRS {
		n := ng_neighbor(g, near, dir)
		if n != -1 && rooms.labels[n] != -1 do return int(rooms.labels[n])
	}
	return -1
}

Entry_Candidate :: struct {
	cell, approach_cell: int,
	danger:              f64,
}

candidate_entries :: proc(g: ^Nav_Grid, rooms: ^Room_Map, target_room: int, entry_list: []int, entry: ^map[int]bool) -> [dynamic]Entry_Candidate {
	out := make([dynamic]Entry_Candidate, context.temp_allocator)
	for cell in entry_list {
		if g.walkable[cell] != 1 do continue
		borders := false
		approach := -1
		for dir in 0 ..< ALL_DIRS {
			n := ng_neighbor(g, cell, dir)
			if n == -1 do continue
			label := int(rooms.labels[n])
			if label == target_room do borders = true
			else if label != -1 && !(n in entry^) && approach == -1 do approach = n
		}
		if borders && approach != -1 do append(&out, Entry_Candidate{cell, approach, f64(g.danger_cost[cell])})
	}
	slice.sort_by(out[:], proc(a, b: Entry_Candidate) -> bool { return a.cell < b.cell })
	return out
}

octile_distance :: proc(g: ^Nav_Grid, a, b: int) -> f64 {
	dx := f64(abs(ng_cell_x(g, a) - ng_cell_x(g, b)))
	dy := f64(abs(ng_cell_y(g, a) - ng_cell_y(g, b)))
	return dx + dy + (math.SQRT_TWO - 2) * min(dx, dy)
}

witness_danger_amount :: proc(at_entry: bool, witness_count: int) -> (amount, radius: f64) {
	w := max(0, min(witness_count, 3))
	amount = min(6 + 2 * f64(w) + (at_entry ? 3 : 0), MAX_DANGER)
	radius = at_entry ? 3 : 2
	return
}

Squad_Belief :: struct {
	x, y, t: f64,
	valid:   bool,
}

REASSIGN_INTERVAL_MS :: 1000.0
DANGER_WEIGHT :: 2.0
SPIKE_PER_CLAIM :: DOOR_COST * 2
ENTRY_SPIKE :: DOOR_COST

Squad :: struct {
	grid:             ^Nav_Grid,
	entry_set:        map[int]bool,
	entry_list:       [dynamic]int,
	room_map:         Room_Map,
	has_rooms:        bool,
	rooms_dirty:      bool,
	guards:           [dynamic]^Sprite,
	belief:           Squad_Belief,
	routes:           []Patrol_Route,
	route_cursor:     int,
	last_reassign_at: f64,
	spikes:           map[int]f64,
	built:            bool,
}

squad: Squad

squad_build :: proc(g: ^Nav_Grid, door_cells: []int) {
	squad_reset()
	squad.grid = g
	for cell in door_cells {
		if g.walkable[cell] == 1 && !(cell in squad.entry_set) {
			squad.entry_set[cell] = true
			append(&squad.entry_list, cell)
		}
	}
	squad.rooms_dirty = true
	squad.built = true
}

squad_on_cell_breached :: proc(index: int) {
	if !squad.built || squad.grid == nil || squad.grid.walkable[index] != 1 do return
	if !(index in squad.entry_set) {
		squad.entry_set[index] = true
		append(&squad.entry_list, index)
		squad.rooms_dirty = true
		squad.last_reassign_at = math.inf_f64(-1)
	}
}

squad_reset :: proc() {
	squad_restore_spikes()
	squad.built = false
	squad.grid = nil
	clear(&squad.entry_set)
	clear(&squad.entry_list)
	squad.has_rooms = false
	squad.rooms_dirty = true
	clear(&squad.guards)
	squad.belief = {}
	squad.routes = nil
	squad.route_cursor = 0
	squad.last_reassign_at = math.inf_f64(-1)
}

squad_add_guard :: proc(g: ^Sprite) {
	for x in squad.guards do if x == g do return
	append(&squad.guards, g)
}

squad_remove_guard :: proc(g: ^Sprite) {
	for x, i in squad.guards do if x == g {
		ordered_remove(&squad.guards, i)
		break
	}
	g.assigned_entry = -1
	squad.last_reassign_at = math.inf_f64(-1)
}

squad_set_patrol_routes :: proc(routes: []Patrol_Route) {
	squad.routes = routes
	squad.route_cursor = 0
}

squad_update_belief :: proc(x, y, now: f64) {
	prev := squad.belief
	squad.belief = {x, y, now, true}
	if !prev.valid {
		squad.last_reassign_at = math.inf_f64(-1)
		return
	}
	if squad.grid != nil {
		rooms := squad_rooms()
		if room_of_point(squad.grid, rooms, prev.x, prev.y) != room_of_point(squad.grid, rooms, x, y) {
			squad.last_reassign_at = math.inf_f64(-1)
		}
	}
}

squad_update :: proc(now: f64) {
	if squad.grid == nil || !squad.belief.valid do return
	if now - squad.last_reassign_at >= REASSIGN_INTERVAL_MS {
		squad_reassign_entries()
		squad.last_reassign_at = now
	}
}

no_route :: #force_inline proc(g: ^Sprite) -> bool { return len(g.path) == 0 && g.target.null }

squad_steer_alarmed :: proc(guard: ^Sprite, now: f64) {
	g := squad.grid
	if g == nil || !squad.belief.valid do return
	rooms := squad_rooms()
	target_room := room_of_point(g, rooms, squad.belief.x, squad.belief.y)
	guard_room := room_of_point(g, rooms, guard.x, guard.y)
	if target_room == -1 || guard_room == target_room || guard.assigned_entry == -1 {
		if guard_room == target_room do guard.assigned_entry = -1
		squad_converge_on_belief(guard)
		return
	}
	guard.moving = true
	guard.chasing_hero = true
	goal_cell := guard.assigned_entry
	if nav_has_pending_request(guard) do return
	if guard.has_approach_goal && guard.approach_goal == goal_cell && !no_route(guard) do return
	guard.approach_goal = goal_cell
	guard.has_approach_goal = true
	gx, gy := ng_point_at_index(g, goal_cell)
	nav_request_path({owner = guard, from = {guard.x, guard.y}, to = {gx, gy}, radius = guard.radius, priority = .Combat, callback = .Squad_Set_If_Any})
}

squad_patrol_path_for :: proc(guard: ^Sprite) -> bool {
	if len(squad.routes) == 0 || squad.grid == nil do return false
	if guard.patrol_route_index < 0 {
		guard.patrol_route_index = squad.route_cursor % len(squad.routes)
		squad.route_cursor += 1
		guard.patrol_leg = 0
	}
	route := squad.routes[guard.patrol_route_index]
	if len(route.points) == 0 do return false
	if len(guard.path) > 0 || !guard.target.null do return true
	leg := route.points[guard.patrol_leg % len(route.points)]
	dest := Point{leg.x, leg.y}
	if !nav_can_reach({guard.x, guard.y}, dest) do return false
	guard.patrol_leg = (guard.patrol_leg + 1) % len(route.points)
	guard.moving = true
	if !nav_has_pending_request(guard) {
		nav_request_path({owner = guard, from = {guard.x, guard.y}, to = dest, radius = guard.radius, priority = .Patrol, callback = .Squad_Set_If_Any})
	}
	return true
}

squad_report_death :: proc(dead: ^Sprite, now: f64) {
	g := squad.grid
	witnesses := 0
	at_entry := false
	if g != nil {
		for other in squad.guards {
			if other == dead || !other.alive do continue
			if physics_can_see(other.x, other.y, dead.x, dead.y) do witnesses += 1
		}
		cell := ng_index_at_point(g, dead.x, dead.y)
		at_entry = cell != -1 && (cell in squad.entry_set || squad_is_next_to_entry(cell))
	}
	amount, radius := witness_danger_amount(at_entry, witnesses)
	emit_nav_danger(dead.x, dead.y, amount, radius)
	squad.last_reassign_at = math.inf_f64(-1)
}

squad_converge_on_belief :: proc(guard: ^Sprite) {
	b := squad.belief
	if !b.valid do return
	guard.moving = true
	guard.chasing_hero = true
	if no_route(guard) || !guard.has_converge_at || guard.converge_at != b.t {
		path := nav_converge_to({guard.x, guard.y}, {b.x, b.y}, guard.radius)
		if len(path) > 0 {
			set_path(guard, path)
			guard.converge_at = b.t
			guard.has_converge_at = true
		} else {
			delete(path)
		}
	}
}

squad_reassign_entries :: proc() {
	g := squad.grid
	if g == nil do return
	squad_restore_spikes()
	for guard in squad.guards do if guard.alive do guard.assigned_entry = -1
	if !squad.belief.valid do return
	rooms := squad_rooms()
	target_room := room_of_point(g, rooms, squad.belief.x, squad.belief.y)
	if target_room == -1 do return
	candidates := candidate_entries(g, rooms, target_room, squad.entry_list[:], &squad.entry_set)
	if len(candidates) == 0 do return

	approaching := make([dynamic]^Sprite, context.temp_allocator)
	for guard in squad.guards {
		if guard.alive && guard.alarmed && room_of_point(g, rooms, guard.x, guard.y) != target_room do append(&approaching, guard)
	}
	if len(approaching) == 0 do return
	guard_cells := make([]int, len(approaching), context.temp_allocator)
	for guard, i in approaching do guard_cells[i] = ng_nearest_walkable(g, ng_index_at_point(g, guard.x, guard.y))

	// assignEntriesRoundRobin
	Order :: struct { gi: int, d: f64 }
	order := make([]Order, len(guard_cells), context.temp_allocator)
	for gc, i in guard_cells {
		m := math.inf_f64(1)
		for c in candidates {
			d := octile_distance(g, gc, c.approach_cell)
			if d < m do m = d
		}
		order[i] = {i, m}
	}
	slice.stable_sort_by(order, proc(a, b: Order) -> bool { return a.d < b.d })
	spike := make([]f64, len(candidates), context.temp_allocator)
	claimed := make([dynamic]int, context.temp_allocator)
	for o in order {
		gc := guard_cells[o.gi]
		best := -1
		best_cost := math.inf_f64(1)
		for c, ci in candidates {
			cost := octile_distance(g, gc, c.approach_cell) + DANGER_WEIGHT * (c.danger + spike[ci])
			if cost < best_cost {
				best_cost = cost
				best = ci
			}
		}
		if best == -1 do continue
		approaching[o.gi].assigned_entry = candidates[best].cell
		spike[best] += SPIKE_PER_CLAIM
		dup := false
		for c in claimed do if c == candidates[best].cell do dup = true
		if !dup do append(&claimed, candidates[best].cell)
	}
	for cell in claimed {
		g.door_cost[cell] += f32(ENTRY_SPIKE)
		squad.spikes[cell] = squad.spikes[cell] + ENTRY_SPIKE
	}
}

squad_restore_spikes :: proc() {
	if squad.grid != nil {
		for cell, added in squad.spikes do squad.grid.door_cost[cell] -= f32(added)
	}
	clear(&squad.spikes)
}

squad_rooms :: proc() -> ^Room_Map {
	if !squad.has_rooms || squad.rooms_dirty || squad.room_map.version != squad.grid.version {
		label_rooms(squad.grid, &squad.entry_set, &squad.room_map)
		squad.has_rooms = true
		squad.rooms_dirty = false
	}
	return &squad.room_map
}

squad_is_next_to_entry :: proc(cell: int) -> bool {
	if squad.grid == nil do return false
	for dir in 0 ..< ALL_DIRS {
		n := ng_neighbor(squad.grid, cell, dir)
		if n != -1 && n in squad.entry_set do return true
	}
	return false
}
