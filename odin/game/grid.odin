package game

// jo_grid.ts, jo_wall.ts, render/autotile.ts, map/tileset.ts, map/loader.ts, systems/breach.ts
// and the event-bus fan-out for geometry changes.

import "core:math"
import "core:encoding/json"
import "core:os"
import "core:fmt"

Material :: enum u8 { None, Drywall, Brick, Concrete, Steel, Wood, Glass }
Damage_Type :: enum u8 { Bullet, Bomb, Frag, Car }

DAMAGE_AMOUNT := [Damage_Type]f64{.Bullet = 5, .Bomb = 500, .Frag = 500, .Car = 40}

material_takes_damage :: proc(m: Material, t: Damage_Type) -> bool {
	switch t {
	case .Bullet: return m == .Drywall || m == .Wood || m == .Glass
	case .Bomb, .Frag: return m == .Drywall || m == .Brick || m == .Concrete || m == .Wood || m == .Glass
	case .Car: return m == .Drywall || m == .Brick || m == .Wood || m == .Glass
	}
	return false
}

Tile_Def :: struct {
	material:    Material,
	hp:          f64,
	rubble_tile: int,
	ok:          bool,
}
tile_defs: map[int]Tile_Def

material_from_string :: proc(s: string) -> Material {
	switch s {
	case "drywall": return .Drywall
	case "brick": return .Brick
	case "concrete": return .Concrete
	case "steel": return .Steel
	case "wood": return .Wood
	case "glass": return .Glass
	}
	return .None
}

load_tileset :: proc() -> bool {
	data, err := os.read_entire_file(asset_path("data/tileset.json"), context.allocator)
	if err != nil do return false
	v, jerr := json.parse(data)
	if jerr != nil do return false
	tiles := v.(json.Object)["tiles"].(json.Object)
	for key, t in tiles {
		o := t.(json.Object)
		code := 0
		for ch in key do code = code * 10 + int(ch - '0')
		tile_defs[code] = {material_from_string(o["material"].(json.String)), jnum(o["hp"]), int(jnum(o["rubbleTile"])), true}
	}
	return true
}

// ---------------------------------------------------------------- map file

Cam_Spawn :: struct { x, y, swivel_max, swivel_min: f64 }
Patrol_Route :: struct { name: string, points: [][2]f64 }

Map_Data :: struct {
	width, height:      int,
	data:               []int,
	hero:               [2]f64,
	guards:             [][2]f64,
	guard_backup_spawn: [2]f64,
	computer:           [2]f64,
	security_cams:      []Cam_Spawn,
	van:                [2]f64,
	loot:               [2]f64,
	escape:             [4]f64,
	has_escape:         bool,
	patrol_routes:      []Patrol_Route,
	hp_overrides:       map[int]f64,
}

map_data: Map_Data

load_map :: proc(path: string) -> bool {
	data, err := os.read_entire_file(asset_path(path), context.allocator)
	if err != nil {
		fmt.eprintln("map not found:", path)
		return false
	}
	v, jerr := json.parse(data)
	if jerr != nil do return false
	root := v.(json.Object)
	m := &map_data
	m.width = int(jnum(root["width"]))
	m.height = int(jnum(root["height"]))
	arr := root["data"].(json.Array)
	m.data = make([]int, len(arr))
	for t, i in arr do m.data[i] = int(jnum(t))
	pair :: proc(v: json.Value) -> [2]f64 {
		a := v.(json.Array)
		return {jnum(a[0]), jnum(a[1])}
	}
	objs := root["objects"].(json.Object)
	m.hero = pair(objs["hero"])
	if g, ok := objs["guards"].(json.Array); ok {
		m.guards = make([][2]f64, len(g))
		for e, i in g do m.guards[i] = pair(e)
	}
	m.guard_backup_spawn = pair(objs["guard_backup_spawn"])
	m.computer = pair(objs["computer"])
	if cams, ok := objs["security_cams"].(json.Array); ok {
		m.security_cams = make([]Cam_Spawn, len(cams))
		for c, i in cams {
			o := c.(json.Object)
			p := pair(o["pos"])
			m.security_cams[i] = {p.x, p.y, jnum(o["swivel_max"]), jnum(o["swivel_min"])}
		}
	}
	m.van = pair(objs["van"])
	m.loot = pair(objs["loot"])
	if e, ok := objs["escape"].(json.Array); ok && len(e) == 4 {
		m.escape = {jnum(e[0]), jnum(e[1]), jnum(e[2]), jnum(e[3])}
		m.has_escape = true
	}
	if routes, ok := root["patrolRoutes"].(json.Array); ok {
		out := make([dynamic]Patrol_Route)
		for r in routes {
			o, is_obj := r.(json.Object)
			if !is_obj do continue
			pts, has := o["points"].(json.Array)
			if !has do continue
			pr: Patrol_Route
			pr.points = make([][2]f64, len(pts))
			for p, i in pts do pr.points[i] = pair(p)
			append(&out, pr)
		}
		m.patrol_routes = out[:]
	}
	if hp, ok := root["hpOverrides"].(json.Object); ok {
		for key, val in hp {
			idx := 0
			for ch in key do idx = idx * 10 + int(ch - '0')
			m.hp_overrides[idx] = jnum(val)
		}
	}
	return true
}

// ---------------------------------------------------------------- cells

Cell :: struct {
	solid, blocks_vision, restricted, door: bool,
	material:      Material,
	hp, max_hp:    f64,
	rubble_tile:   int,
	image_number:  int,
	rotate_sprite: f64,
	gx, gy:        int,
	offset_x:      f64,
	offset_y:      f64,
	x, y:          f64,
	image_sprite:  ^Node,
}

Grid :: struct {
	width, height:            int,
	cell_size:                int,
	cells:                    []^Cell,
	doors:                    [dynamic]^Cell,
	door_sprites:             [dynamic]^Sprite,
	a_door_is_being_unlocked: bool,
}

grid: Grid
tile_containers: [6]^Node

new_cell :: proc(image_number: int, solid, blocks_vision, restricted: bool, gx, gy: int) -> ^Cell {
	c := new(Cell)
	c.image_number = image_number
	c.solid = solid
	c.blocks_vision = blocks_vision
	c.restricted = restricted
	c.gx = gx
	c.gy = gy
	c.x = f64(gx * grid.cell_size)
	c.y = f64(gy * grid.cell_size)
	return c
}

cell_index :: proc(c: ^Cell) -> int { return grid.width * c.gy + c.gx }

grid_build :: proc(m: ^Map_Data) {
	for i in 0 ..< 6 do tile_containers[i] = new_container()
	grid.width = m.width
	grid.height = m.height
	grid.cell_size = 64
	grid.cells = make([]^Cell, len(m.data))
	grid.doors = nil
	grid.door_sprites = nil
	grid.a_door_is_being_unlocked = false
	for code, i in m.data {
		x := i % grid.width
		y := i / grid.width
		c: ^Cell
		switch code {
		case 1: c = new_cell(0, true, true, false, x, y)
		case 2: c = new_cell(1, false, false, false, x, y)
		case 3: c = new_cell(2, true, false, false, x, y)
		case 4: c = new_cell(3, false, false, true, x, y)
		case 5, 6:
			c = new_cell(4, true, true, true, x, y)
			c.door = true
			append(&grid.doors, c)
			ds := new_door(code == 6, c)
			ds.x += c.x
			ds.y += c.y
			append(&grid.door_sprites, ds)
		case 7: c = new_cell(5, true, false, false, x, y)
		case: c = new_cell(1, false, false, false, x, y)
		}
		if def, ok := tile_defs[code]; ok {
			c.material = def.material
			c.hp = def.hp
			c.rubble_tile = def.rubble_tile
		}
		if hp, ok := m.hp_overrides[i]; ok do c.hp = hp
		c.max_hp = c.hp
		grid.cells[i] = c
	}
}

grid_set_images_for_tiles :: proc() {
	for c in grid.cells do cell_change_image(c, c.image_number)
}

grid_cell_at :: proc(gx, gy: int) -> ^Cell {
	if gx < 0 || gy < 0 do return nil
	if gx >= grid.width || gy >= grid.height do return nil
	return grid.cells[grid.width * gy + gx]
}

// getIndexFromCoords_2d. A NaN coordinate maps to an index that matches no cell.
grid_index_2d :: proc(x, y: f64) -> (int, int) {
	fx := math.floor(x / f64(grid.cell_size))
	fy := math.floor(y / f64(grid.cell_size))
	if fx != fx || fy != fy || abs(fx) > 1e9 || abs(fy) > 1e9 do return -1, -1
	return int(fx), int(fy)
}

grid_cell_at_coords :: proc(x, y: f64) -> ^Cell {
	if x < 0 || y < 0 do return nil
	cs := f64(grid.cell_size)
	if x > cs * f64(grid.width) || y > cs * f64(grid.height) do return nil
	ix, iy := grid_index_2d(x, y)
	return grid_cell_at(ix, iy)
}

is_wall_sight_blocking :: proc(x, y: f64) -> bool { c := grid_cell_at_coords(x, y); return c != nil && c.blocks_vision }
is_wall_door :: proc(x, y: f64) -> bool { c := grid_cell_at_coords(x, y); return c != nil && c.door }
is_wall_solid_and_not_door :: proc(x, y: f64) -> bool { c := grid_cell_at_coords(x, y); return c != nil && c.solid && !c.door }
is_tile_restricted :: proc(x, y: f64) -> bool { c := grid_cell_at_coords(x, y); return c != nil && c.restricted }

// isWallSolid_coords: the particle hot path (every shard, every tick).
is_wall_solid :: #force_inline proc(x, y: f64) -> bool {
	if !(x >= 0) || !(y >= 0) do return false // also rejects NaN
	cs := f64(grid.cell_size)
	if x > cs * f64(grid.width) || y > cs * f64(grid.height) do return false
	gx := int(x / cs)
	gy := int(y / cs)
	if gx >= grid.width || gy >= grid.height do return false
	return grid.cells[grid.width * gy + gx].solid
}

grid_make_wall_solid :: proc(x, y: f64) {
	if x < 0 || y < 0 do return
	cs := f64(grid.cell_size)
	if x > cs * f64(grid.width) || y > cs * f64(grid.height) do return
	ix, iy := grid_index_2d(x, y)
	c := grid_cell_at(ix, iy)
	if c != nil {
		c.solid = true
		c.blocks_vision = true
		emit_nav_dirty(grid.width * iy + ix, false)
	}
}

image_for_tile_code :: proc(code: int) -> int {
	switch code {
	case 1: return 0
	case 2: return 1
	case 3: return 2
	case 4: return 3
	case 5, 6: return 4
	}
	return 1
}

grid_damage_cell :: proc(index: int, amount: f64, type: Damage_Type) {
	if index < 0 || index >= len(grid.cells) do return
	c := grid.cells[index]
	if !c.solid && !c.door do return
	x := index % grid.width
	y := index / grid.width
	if x == 0 || x == grid.width - 1 || y == 0 || y == grid.height - 1 do return
	material := c.material == .None ? Material.Brick : c.material
	if !material_takes_damage(material, type) do return
	// clients replay the damage (and with it the shards and sounds it makes) themselves
	net_ev_cell(index, amount, type)
	net.mute += 1
	defer net.mute -= 1
	c.hp -= amount
	if c.hp > 0 do return
	grid_destroy_cell(index)
}

grid_destroy_cell :: proc(index: int) {
	c := grid.cells[index]
	c.solid = false
	c.blocks_vision = false
	c.door = false
	make_restricted := false
	if is_tile_restricted(c.x - 64, c.y) do make_restricted = true
	if is_tile_restricted(c.x + 64, c.y) do make_restricted = true
	if is_tile_restricted(c.x, c.y - 64) do make_restricted = true
	if is_tile_restricted(c.x, c.y + 64) do make_restricted = true
	if make_restricted do cell_change_image(c, 4)
	else do cell_change_image(c, image_for_tile_code(c.rubble_tile != 0 ? c.rubble_tile : 2))
	for ds in grid.door_sprites {
		if cell_index(ds.door_cell) == index {
			door_open(ds)
			ds.broken = true
		}
	}
	refresh_autotile_around(index)
	emit_cell_destroyed(index)
}

angle_between_points :: proc(ax, ay, bx, by: f64) -> f64 { return math.atan2(by - ay, bx - ax) }

// ---------------------------------------------------------------- wall sprites

wall_image_path :: proc(t: Wall_Type) -> string {
	switch t {
	case .Corner: return "images/wall_black_corner.png"
	case .Long:   return "images/wall_black_long.png"
	case .T:      return "images/wall_black_T.png"
	case .Single: return "images/wall_black_single.png"
	case .Edge:   return "images/wall_black_edge.png"
	case .Four:   return "images/wall_black_four.png"
	}
	return ""
}

// changeImage. The old sprite is removed from the container of the cell's *original*
// image_number (the field is never updated), which is what the web build does.
cell_change_image :: proc(c: ^Cell, n: int) {
	if c.image_sprite != nil do remove_child(tile_containers[c.image_number], c.image_sprite)
	c.rotate_sprite = 0
	c.offset_x = 0
	c.offset_y = 0
	sprite: ^Node
	switch n {
	case 0:
		tile := find_wall_type(c.gx, c.gy)
		c.rotate_sprite = tile.rotation
		sprite = new_sprite(image_tex(wall_image_path(tile.type)))
		if c.rotate_sprite != 0 {
			sprite.rotation = c.rotate_sprite
			if c.rotate_sprite == math.PI / 2 do c.offset_x = 64
			if c.rotate_sprite == -math.PI / 2 do c.offset_y = 64
			if c.rotate_sprite == math.PI {
				c.offset_x = 64
				c.offset_y = 64
			}
		}
	case 1:
		sprite = new_sprite(image_tex("images/tile_white.png"))
	case 2:
		sprite = new_sprite(image_tex("images/tile_brown.png"))
		random_tile := math.round(random() * (10 - 1) + 1)
		doodad: ^Node
		if random_tile == 1 || random_tile == 3 do doodad = new_sprite(img_doodad_paper)
		else if random_tile == 2 do doodad = new_sprite(img_doodad_lamp)
		if display_actors != nil && doodad != nil do new_doodad(doodad, display_actors, c.x, c.y)
	case 3, 4:
		sprite = new_sprite(image_tex("images/tile_red.png"))
	case 5:
		sprite = new_graphics()
		g_begin_fill(sprite, 0xBFE4FF, 0.5)
		g_line_style(sprite, 2, 0xF0F8FF, 0.85)
		g_draw_rect(sprite, 0, 0, 64, 64)
		g_end_fill(sprite)
	}
	c.image_sprite = sprite
	add_child(tile_containers[n], sprite)
}

cell_prepare_for_draw :: #force_inline proc(c: ^Cell) {
	c.image_sprite.x = c.x + c.offset_x
	c.image_sprite.y = c.y + c.offset_y
}

cell_open_door :: proc(c: ^Cell) {
	c.solid = false
	c.blocks_vision = false
	physics_set_door_open(cell_index(c), true)
	fog_invalidate()
}

cell_close_door :: proc(c: ^Cell) {
	c.solid = true
	c.blocks_vision = true
	physics_set_door_open(cell_index(c), false)
	fog_invalidate()
}

// ---------------------------------------------------------------- autotile

Wall_Type :: enum u8 { Single, Edge, Long, Corner, T, Four }
Wall_Tile :: struct { type: Wall_Type, rotation: f64 }

find_wall_type :: proc(x, y: int) -> Wall_Tile {
	is_wall :: proc(cx, cy: int) -> bool {
		c := grid_cell_at(cx, cy)
		return c != nil && c.solid && !c.door && c.blocks_vision
	}
	north := is_wall(x, y - 1)
	south := is_wall(x, y + 1)
	east := is_wall(x + 1, y)
	west := is_wall(x - 1, y)
	count := int(north) + int(south) + int(east) + int(west)
	switch count {
	case 0:
		return {.Single, 0}
	case 1:
		rotation := 0.0
		if west do rotation = math.PI
		if south do rotation = math.PI / 2
		if north do rotation = -math.PI / 2
		return {.Edge, rotation}
	case 2:
		if north && south do return {.Long, math.PI / 2}
		if east && west do return {.Long, 0}
		rotation := 0.0
		if north && west do rotation = math.PI / 2
		if north && east do rotation = -math.PI / 2
		if north && west do rotation = math.PI
		if south && west do rotation = math.PI / 2
		return {.Corner, rotation}
	case 3:
		rotation := 0.0
		if north && south && east do rotation = -math.PI / 2
		if north && south && west do rotation = math.PI / 2
		if north && east && west do rotation = math.PI
		return {.T, rotation}
	}
	return {.Four, 0}
}

refresh_autotile_around :: proc(index: int) {
	ox := index % grid.width
	oy := index / grid.width
	for dy in -1 ..= 1 {
		for dx in -1 ..= 1 {
			c := grid_cell_at(ox + dx, oy + dy)
			if c == nil do continue
			if c.image_number == 0 && c.solid && !c.door && c.blocks_vision do cell_change_image(c, 0)
		}
	}
}

// ---------------------------------------------------------------- event fan-out
// Listener order matches the web build's module import order.

emit_nav_dirty :: proc(index: int, walkable: bool) {
	physics_on_geometry_changed(index, walkable)
	nav_mark_dirty(index, walkable)
	fog_invalidate()
}

emit_cell_destroyed :: proc(index: int) {
	physics_on_geometry_changed(index, true)
	nav_mark_dirty(index, true)
	fog_invalidate()
	breach_on_cell_destroyed(index)
}

// ---------------------------------------------------------------- breach.ts

BREACH_DANGER_AMOUNT :: 3.0
BREACH_DANGER_RADIUS :: 2.0
BREACH_SOUND_COOLDOWN_MS :: 120.0
last_breach_sound_at := math.inf_f64(-1)

breach_on_cell_destroyed :: proc(index: int) {
	cs := f64(grid.cell_size)
	cx := f64(index % grid.width) * cs + cs / 2
	cy := f64(index / grid.width) * cs + cs / 2
	// breachFX
	shard_particle_splatter(0, cx, cy)
	shard_particle_splatter(math.PI, cx, cy)
	now := clock_now()
	if now - last_breach_sound_at >= BREACH_SOUND_COOLDOWN_MS {
		last_breach_sound_at = now
		play_sound(.Explosion)
	}
	// breachAI
	emit_nav_danger(cx, cy, BREACH_DANGER_AMOUNT, BREACH_DANGER_RADIUS)
	squad_on_cell_breached(index)
}
