#!/usr/bin/env python3
"""Builds maps/*.jomap from the ASCII sources in maps/src/*.txt.

Run from anywhere: python3 maps/build_maps.py. It checks each map (borders, reachability) and fails loudly.

Source format: a header of `key: value` lines, a blank line, then the grid (one character per 64 px cell).

Tiles:     #  brick wall      .  floor          ,  off-limits floor (restricted)
           d  desk/drywall    g  glass          D  door in a vertical wall    =  door in a horizontal wall
Objects (placed on a tile, which the object character stands in for):
           @  robber spawn (floor)              G  guard on floor     Q  guard on off-limits floor
           C  security camera on a wall cell (mounted on a free corner of that cell)
           P  security computer (off-limits)    $  loot (off-limits)
           V  getaway van (floor)               B  police backup spawn (floor)
           E  escape zone (floor); the zone is the bounding box of all E cells
Header keys: name, backup (number of police in the backup wave).
"""
import json, math, os, sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
TILE = {'#': 1, '.': 2, ',': 4, 'd': 3, 'g': 7, 'D': 5, '=': 6,
        '@': 2, 'G': 2, 'Q': 4, 'C': 1, 'P': 4, '$': 4, 'V': 2, 'B': 2, 'E': 2}
CS = 64
WALKABLE = {2, 4, 5, 6}           # doors are lock-picked, so they count as passable
VISION_BLOCKING = {1, 5, 6}


def load(path):
    text = open(path).read().rstrip('\n').split('\n')
    header, i = {}, 0
    while text[i].strip():
        k, v = text[i].split(':', 1)
        header[k.strip()] = v.strip()
        i += 1
    rows = [r for r in text[i + 1:]]
    return header, rows


def fail(name, msg):
    sys.exit(f'{name}: {msg}')


def bfs(cells, w, h, start, ok):
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if 0 <= n[0] < w and 0 <= n[1] < h and n not in seen and ok(*n):
                seen.add(n)
                q.append(n)
    return seen


def camera(name, data, w, x, y):
    # A camera hangs on a wall corner that has open space on its other three sides. The game pushes it
    # off the wall and sweeps the 270 degrees away from it (see camera_find_corner in sprite.odin).
    blocks = lambda cx, cy: data[cy * w + cx] in VISION_BLOCKING
    # (corner point, the other three cells around it, swivel min, max)
    options = [
        ((x, y), [(x - 1, y - 1), (x, y - 1), (x - 1, y)], math.pi / 2, 2 * math.pi),              # wall is BR of point
        ((x + 1, y), [(x, y - 1), (x + 1, y - 1), (x + 1, y)], math.pi, math.pi / 2),             # wall is BL
        ((x, y + 1), [(x - 1, y), (x - 1, y + 1), (x, y + 1)], 0.0, 3 * math.pi / 2),             # wall is TR
        ((x + 1, y + 1), [(x + 1, y), (x, y + 1), (x + 1, y + 1)], 3 * math.pi / 2, math.pi),     # wall is TL
    ]
    for (px, py), others, lo, hi in options:
        if not any(blocks(cx, cy) for cx, cy in others):
            return {'swivel_max': hi, 'swivel_min': lo, 'pos': [px * CS, py * CS]}
    fail(name, f'camera at {x},{y} has no free corner')


def build(src):
    name = os.path.splitext(os.path.basename(src))[0]
    header, rows = load(src)
    h, w = len(rows), len(rows[0])
    for i, r in enumerate(rows):
        if len(r) != w:
            fail(name, f'row {i} is {len(r)} wide, expected {w}')
    data, objs = [], {'guards': [], 'security_cams': []}
    escape, cams = [], []
    centre = lambda x, y: [x * CS + CS // 2, y * CS + CS // 2]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch not in TILE:
                fail(name, f'unknown character {ch!r} at {x},{y}')
            if (x in (0, w - 1) or y in (0, h - 1)) and ch != '#':
                fail(name, f'the border must be wall, found {ch!r} at {x},{y}')
            data.append(TILE[ch])
            if ch == '@': objs['hero'] = centre(x, y)
            elif ch in 'GQ': objs['guards'].append(centre(x, y))
            elif ch == 'C': cams.append((x, y))
            elif ch == 'P': objs['computer'] = centre(x, y)
            elif ch == '$': objs['loot'] = centre(x, y)
            elif ch == 'V': objs['van'] = centre(x, y)
            elif ch == 'B': objs['guard_backup_spawn'] = centre(x, y)
            elif ch == 'E': escape.append((x, y))
    for key in ('hero', 'computer', 'loot', 'van', 'guard_backup_spawn'):
        if key not in objs:
            fail(name, f'missing {key}')
    if not escape:
        fail(name, 'missing escape zone (E)')
    objs['security_cams'] = [camera(name, data, w, x, y) for x, y in cams]
    ex = [p[0] for p in escape]
    ey = [p[1] for p in escape]
    objs['escape'] = [min(ex) * CS, min(ey) * CS, (max(ex) - min(ex) + 1) * CS, (max(ey) - min(ey) + 1) * CS]

    # reachability: robber -> loot, van, every guard; van -> escape with room for the van (3x3 clear)
    walk = lambda x, y: data[y * w + x] in WALKABLE
    cell = lambda p: (p[0] // CS, p[1] // CS)
    reach = bfs(data, w, h, cell(objs['hero']), walk)
    for key in ('loot', 'van'):
        if cell(objs[key]) not in reach:
            fail(name, f'the robber cannot reach the {key}')
    lx, ly = cell(objs['loot'])
    for gx, gy in [cell(g) for g in objs['guards']]:
        if (gx, gy) not in reach:
            fail(name, f'guard at {gx},{gy} is walled off')
    roomy = lambda x, y: all(0 <= x + dx < w and 0 <= y + dy < h and data[(y + dy) * w + x + dx] == 2
                             for dx in (-1, 0, 1) for dy in (-1, 0, 1))
    if not roomy(*cell(objs['van'])):
        fail(name, 'the van needs a 3x3 patch of open floor')
    drive = bfs(data, w, h, cell(objs['van']), roomy)
    near = lambda a, b: abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1
    if not any(near(d, e) for d in drive for e in escape):
        fail(name, 'the van cannot drive to the escape zone')

    out = {'data': data, 'height': h, 'width': w, 'objects': objs,
           'name': header.get('name', name), 'backupGuards': int(header.get('backup', 7))}
    dst = os.path.join(HERE, name + '.jomap')
    with open(dst, 'w') as f:
        json.dump(out, f)
    print(f'{name}: {w}x{h}, {len(objs["guards"])} guards, {len(cams)} cameras -> {os.path.relpath(dst)}')


if __name__ == '__main__':
    srcs = sorted(os.path.join(HERE, 'src', f) for f in os.listdir(os.path.join(HERE, 'src')) if f.endswith('.txt'))
    for s in srcs:
        build(s)
