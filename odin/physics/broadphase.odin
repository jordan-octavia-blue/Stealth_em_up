package physics

// planck's DynamicTree + BroadPhase. Node ids are handed out monotonically
// (never reused), exactly like planck, because the pair order a contact gets
// (which fixture is "A") comes from comparing those ids.

Tree_Node :: struct {
	id:        int,
	aabb:      AABB,
	user_data: ^Fixture_Proxy,
	parent:    ^Tree_Node,
	child1:    ^Tree_Node,
	child2:    ^Tree_Node,
	height:    int,
	next_free: ^Tree_Node,
}

Dynamic_Tree :: struct {
	root:          ^Tree_Node,
	last_proxy_id: int,
	free_list:     ^Tree_Node,
	stack:         [dynamic]^Tree_Node,
}

node_is_leaf :: #force_inline proc(n: ^Tree_Node) -> bool {return n.child1 == nil}

tree_allocate_node :: proc(t: ^Dynamic_Tree) -> ^Tree_Node {
	n := t.free_list
	if n != nil {
		t.free_list = n.next_free
		n^ = {}
	} else {
		n = new(Tree_Node)
	}
	n.height = -1
	t.last_proxy_id += 1
	n.id = t.last_proxy_id
	return n
}

tree_free_node :: proc(t: ^Dynamic_Tree, n: ^Tree_Node) {
	n^ = {}
	n.height = -1
	n.next_free = t.free_list
	t.free_list = n
}

tree_create_proxy :: proc(t: ^Dynamic_Tree, aabb: AABB, user: ^Fixture_Proxy) -> ^Tree_Node {
	node := tree_allocate_node(t)
	node.aabb = aabb
	aabb_extend(&node.aabb, AABB_EXTENSION)
	node.user_data = user
	node.height = 0
	tree_insert_leaf(t, node)
	return node
}

tree_destroy_proxy :: proc(t: ^Dynamic_Tree, node: ^Tree_Node) {
	tree_remove_leaf(t, node)
	tree_free_node(t, node)
}

tree_move_proxy :: proc(t: ^Dynamic_Tree, node: ^Tree_Node, aabb: AABB, d: Vec2) -> bool {
	if aabb_contains(node.aabb, aabb) do return false
	tree_remove_leaf(t, node)
	node.aabb = aabb
	a := &node.aabb
	aabb_extend(a, AABB_EXTENSION)
	if d.x < 0.0 {
		a.lower.x += d.x * AABB_MULTIPLIER
	} else {
		a.upper.x += d.x * AABB_MULTIPLIER
	}
	if d.y < 0.0 {
		a.lower.y += d.y * AABB_MULTIPLIER
	} else {
		a.upper.y += d.y * AABB_MULTIPLIER
	}
	tree_insert_leaf(t, node)
	return true
}

tree_insert_leaf :: proc(t: ^Dynamic_Tree, leaf: ^Tree_Node) {
	if t.root == nil {
		t.root = leaf
		t.root.parent = nil
		return
	}
	leaf_aabb := leaf.aabb
	index := t.root
	for !node_is_leaf(index) {
		child1 := index.child1
		child2 := index.child2
		area := aabb_perimeter(index.aabb)
		combined_area := aabb_combined_perimeter(index.aabb, leaf_aabb)
		cost := 2.0 * combined_area
		inheritance_cost := 2.0 * (combined_area - area)
		new_area1 := aabb_combined_perimeter(leaf_aabb, child1.aabb)
		cost1 := new_area1 + inheritance_cost
		if !node_is_leaf(child1) {
			cost1 -= aabb_perimeter(child1.aabb)
		}
		new_area2 := aabb_combined_perimeter(leaf_aabb, child2.aabb)
		cost2 := new_area2 + inheritance_cost
		if !node_is_leaf(child2) {
			cost2 -= aabb_perimeter(child2.aabb)
		}
		if cost < cost1 && cost < cost2 do break
		if cost1 < cost2 {
			index = child1
		} else {
			index = child2
		}
	}
	sibling := index
	old_parent := sibling.parent
	new_parent := tree_allocate_node(t)
	new_parent.parent = old_parent
	new_parent.user_data = nil
	new_parent.aabb = aabb_combine(leaf_aabb, sibling.aabb)
	new_parent.height = sibling.height + 1
	if old_parent != nil {
		if old_parent.child1 == sibling {
			old_parent.child1 = new_parent
		} else {
			old_parent.child2 = new_parent
		}
	} else {
		t.root = new_parent
	}
	new_parent.child1 = sibling
	new_parent.child2 = leaf
	sibling.parent = new_parent
	leaf.parent = new_parent

	index = leaf.parent
	for index != nil {
		index = tree_balance(t, index)
		child1 := index.child1
		child2 := index.child2
		index.height = 1 + max(child1.height, child2.height)
		index.aabb = aabb_combine(child1.aabb, child2.aabb)
		index = index.parent
	}
}

tree_remove_leaf :: proc(t: ^Dynamic_Tree, leaf: ^Tree_Node) {
	if leaf == t.root {
		t.root = nil
		return
	}
	parent := leaf.parent
	grand_parent := parent.parent
	sibling := parent.child1 == leaf ? parent.child2 : parent.child1
	if grand_parent != nil {
		if grand_parent.child1 == parent {
			grand_parent.child1 = sibling
		} else {
			grand_parent.child2 = sibling
		}
		sibling.parent = grand_parent
		tree_free_node(t, parent)
		index := grand_parent
		for index != nil {
			index = tree_balance(t, index)
			child1 := index.child1
			child2 := index.child2
			index.aabb = aabb_combine(child1.aabb, child2.aabb)
			index.height = 1 + max(child1.height, child2.height)
			index = index.parent
		}
	} else {
		t.root = sibling
		sibling.parent = nil
		tree_free_node(t, parent)
	}
}

tree_balance :: proc(t: ^Dynamic_Tree, A: ^Tree_Node) -> ^Tree_Node {
	if node_is_leaf(A) || A.height < 2 do return A
	B := A.child1
	C := A.child2
	balance := C.height - B.height
	if balance > 1 {
		F := C.child1
		G := C.child2
		C.child1 = A
		C.parent = A.parent
		A.parent = C
		if C.parent != nil {
			if C.parent.child1 == A {
				C.parent.child1 = C
			} else {
				C.parent.child2 = C
			}
		} else {
			t.root = C
		}
		if F.height > G.height {
			C.child2 = F
			A.child2 = G
			G.parent = A
			A.aabb = aabb_combine(B.aabb, G.aabb)
			C.aabb = aabb_combine(A.aabb, F.aabb)
			A.height = 1 + max(B.height, G.height)
			C.height = 1 + max(A.height, F.height)
		} else {
			C.child2 = G
			A.child2 = F
			F.parent = A
			A.aabb = aabb_combine(B.aabb, F.aabb)
			C.aabb = aabb_combine(A.aabb, G.aabb)
			A.height = 1 + max(B.height, F.height)
			C.height = 1 + max(A.height, G.height)
		}
		return C
	}
	if balance < -1 {
		D := B.child1
		E := B.child2
		B.child1 = A
		B.parent = A.parent
		A.parent = B
		if B.parent != nil {
			if B.parent.child1 == A {
				B.parent.child1 = B
			} else {
				B.parent.child2 = B
			}
		} else {
			t.root = B
		}
		if D.height > E.height {
			B.child2 = D
			A.child1 = E
			E.parent = A
			A.aabb = aabb_combine(C.aabb, E.aabb)
			B.aabb = aabb_combine(A.aabb, D.aabb)
			A.height = 1 + max(C.height, E.height)
			B.height = 1 + max(A.height, D.height)
		} else {
			B.child2 = E
			A.child1 = D
			D.parent = A
			A.aabb = aabb_combine(C.aabb, D.aabb)
			B.aabb = aabb_combine(A.aabb, E.aabb)
			A.height = 1 + max(C.height, D.height)
			B.height = 1 + max(A.height, E.height)
		}
		return B
	}
	return A
}

// Visits leaves overlapping `aabb`; the callback returns false to stop.
tree_query :: proc(t: ^Dynamic_Tree, aabb: AABB, cb: proc(data: rawptr, node: ^Tree_Node) -> bool, data: rawptr) {
	stack := &t.stack
	base := len(stack)
	append(stack, t.root)
	for len(stack) > base {
		node := pop(stack)
		if node == nil do continue
		if aabb_overlap(node.aabb, aabb) {
			if node_is_leaf(node) {
				if !cb(data, node) {
					resize(stack, base)
					return
				}
			} else {
				append(stack, node.child1)
				append(stack, node.child2)
			}
		}
	}
}

tree_ray_cast :: proc(
	t: ^Dynamic_Tree,
	input: Ray_Cast_Input,
	cb: proc(data: rawptr, sub: Ray_Cast_Input, node: ^Tree_Node) -> f64,
	data: rawptr,
) {
	p1 := input.p1
	p2 := input.p2
	r := normalize(p2 - p1)
	v := cross_sv(1.0, r)
	abs_v := Vec2{abs(v.x), abs(v.y)}
	max_fraction := input.max_fraction
	tt := combine2(1 - max_fraction, p1, max_fraction, p2)
	segment := AABB {
		lower = {min(p1.x, tt.x), min(p1.y, tt.y)},
		upper = {max(p1.x, tt.x), max(p1.y, tt.y)},
	}
	stack := &t.stack
	base := len(stack)
	append(stack, t.root)
	for len(stack) > base {
		node := pop(stack)
		if node == nil do continue
		if !aabb_overlap(node.aabb, segment) do continue
		c := Vec2{0.5 * (node.aabb.lower.x + node.aabb.upper.x), 0.5 * (node.aabb.lower.y + node.aabb.upper.y)}
		h := Vec2{0.5 * (node.aabb.upper.x - node.aabb.lower.x), 0.5 * (node.aabb.upper.y - node.aabb.lower.y)}
		separation := abs(dot(v, p1 - c)) - dot(abs_v, h)
		if separation > 0.0 do continue
		if node_is_leaf(node) {
			sub := Ray_Cast_Input {
				p1           = input.p1,
				p2           = input.p2,
				max_fraction = max_fraction,
			}
			value := cb(data, sub, node)
			if value == 0.0 {
				break
			} else if value > 0.0 {
				max_fraction = value
				tt = combine2(1 - max_fraction, p1, max_fraction, p2)
				segment = AABB {
					lower = {min(p1.x, tt.x), min(p1.y, tt.y)},
					upper = {max(p1.x, tt.x), max(p1.y, tt.y)},
				}
			}
		} else {
			append(stack, node.child1)
			append(stack, node.child2)
		}
	}
	resize(stack, base)
}

// --- BroadPhase -------------------------------------------------------------

Broad_Phase :: struct {
	tree:        Dynamic_Tree,
	move_buffer: [dynamic]^Tree_Node, // nil entries are "unbuffered"
	query_node:  ^Tree_Node,
	world:       ^World,
}

bp_create_proxy :: proc(bp: ^Broad_Phase, aabb: AABB, user: ^Fixture_Proxy) -> ^Tree_Node {
	n := tree_create_proxy(&bp.tree, aabb, user)
	append(&bp.move_buffer, n)
	return n
}

bp_destroy_proxy :: proc(bp: ^Broad_Phase, n: ^Tree_Node) {
	for &m in bp.move_buffer {
		if m == n do m = nil
	}
	tree_destroy_proxy(&bp.tree, n)
}

bp_move_proxy :: proc(bp: ^Broad_Phase, n: ^Tree_Node, aabb: AABB, d: Vec2) {
	if tree_move_proxy(&bp.tree, n, aabb, d) {
		append(&bp.move_buffer, n)
	}
}

bp_touch_proxy :: proc(bp: ^Broad_Phase, n: ^Tree_Node) {
	append(&bp.move_buffer, n)
}

bp_update_pairs :: proc(bp: ^Broad_Phase) {
	for len(bp.move_buffer) > 0 {
		bp.query_node = pop(&bp.move_buffer)
		if bp.query_node == nil do continue
		fat := bp.query_node.aabb
		tree_query(&bp.tree, fat, bp_query_callback, bp)
	}
}

@(private)
bp_query_callback :: proc(data: rawptr, node: ^Tree_Node) -> bool {
	bp := cast(^Broad_Phase)data
	if node == bp.query_node do return true
	a, b := node, bp.query_node
	if b.id < a.id do a, b = b, a
	world_create_contact(bp.world, a.user_data, b.user_data)
	return true
}
