"""Construit src/core/griddata.json : la France en grille de cases de 6 km.

Entrées : départements + régions (gregoiredavid/france-geojson, IGN Admin Express COG 2018)
          pays voisins (Natural Earth 1:50m, domaine public) pour distinguer mer et terre étrangère.
Sortie  : terrain (0 mer, 1 France, 2 terre étrangère), département par case, région par case.

Usage : python3 -I build_grid.py <departements.geojson> <regions.geojson> <ne50.geojson> <sortie.json>
"""
import json, math, sys, base64, collections
from PIL import Image, ImageDraw

dep_p, reg_p, ne_p, out_p = sys.argv[1:5]
CELL = 6.0          # km par case
MARGIN = 54.0       # km de mer/terre étrangère autour de la France
LAT0 = 46.5
KX = 111.32 * math.cos(math.radians(LAT0)); KY = 110.57

dep = json.load(open(dep_p))['features']
reg = json.load(open(reg_p))['features']
ne = json.load(open(ne_p))['features']

def proj(lon, lat): return (lon * KX, -lat * KY)

def polys(g):
    return g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]

# bornes : celles des départements
xs, ys = [], []
for f in dep:
    for poly in polys(f['geometry']):
        for lon, lat in poly[0]:
            x, y = proj(lon, lat); xs.append(x); ys.append(y)
minx, miny = min(xs) - MARGIN, min(ys) - MARGIN
maxx, maxy = max(xs) + MARGIN, max(ys) + MARGIN
W = int(math.ceil((maxx - minx) / CELL)); H = int(math.ceil((maxy - miny) / CELL))
print('grille', W, 'x', H)

def to_px(ring):
    out = []
    for lon, lat in ring:
        x, y = proj(lon, lat)
        out.append(((x - minx) / CELL, (y - miny) / CELL))
    return out

def draw_poly(dr, ring, val):
    pts = to_px(ring)
    if len(pts) >= 3:
        dr.polygon(pts, fill=val, outline=val)

# --- terre étrangère (tout ce qui n'est pas la France, dans la fenêtre)
foreign = Image.new('L', (W, H), 0)
dfo = ImageDraw.Draw(foreign)
lon_min, lon_max = minx / KX, maxx / KX
lat_max, lat_min = -miny / KY, -maxy / KY
used = []
for f in ne:
    adm = f['properties'].get('ADMIN', '')
    if adm == 'France': continue
    g = f['geometry']
    hit = False
    for poly in polys(g):
        ring = poly[0]
        lo = [p[0] for p in ring]; la = [p[1] for p in ring]
        if max(lo) < lon_min or min(lo) > lon_max or max(la) < lat_min or min(la) > lat_max: continue
        hit = True
        draw_poly(dfo, ring, 1)
        for hole in poly[1:]: draw_poly(dfo, hole, 0)
    if hit: used.append(adm)
print('pays voisins dans la fenêtre :', sorted(set(used)))

# --- départements (grands d'abord, petits dessinés par-dessus : gère les enclaves)
def area(f):
    a = 0
    for poly in polys(f['geometry']):
        r = poly[0]
        for i in range(len(r) - 1):
            a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return abs(a)
dept_img = Image.new('L', (W, H), 0)
dd = ImageDraw.Draw(dept_img)
order = sorted(range(len(dep)), key=lambda i: -area(dep[i]))
for i in order:
    for poly in polys(dep[i]['geometry']):
        draw_poly(dd, poly[0], i + 1)

# --- régions : on dessine aussi leurs contours, puis chaque département prend la région majoritaire
reg_img = Image.new('L', (W, H), 0)
dr = ImageDraw.Draw(reg_img)
for j, f in enumerate(sorted(reg, key=lambda f: -area(f))):
    pass
rorder = sorted(range(len(reg)), key=lambda i: -area(reg[i]))
for i in rorder:
    for poly in polys(reg[i]['geometry']):
        draw_poly(dr, poly[0], i + 1)

D = list(dept_img.getdata()); R = list(reg_img.getdata())
votes = collections.defaultdict(collections.Counter)
for d, r in zip(D, R):
    if d > 0 and r > 0: votes[d - 1][r - 1] += 1
dept_region = []
for i in range(len(dep)):
    r = votes[i].most_common(1)[0][0]
    tot = sum(votes[i].values())
    share = votes[i][r] / tot
    dept_region.append(r)
    if share < 0.85: print('  ! département partagé entre régions :', dep[i]['properties']['code'], dep[i]['properties']['nom'], dict(votes[i]))
print('départements par région :')
for j, f in enumerate(reg):
    names = [dep[i]['properties']['code'] for i in range(len(dep)) if dept_region[i] == j]
    print(f"  {f['properties']['nom']:28s} {len(names):2d} : {' '.join(names)}")

# --- terrain final
F = list(foreign.getdata())
terrain = bytearray(W * H)
land = 0
for k in range(W * H):
    if D[k] > 0: terrain[k] = 1; land += 1
    elif F[k]: terrain[k] = 2
dept_arr = bytes(D)
print('cases France :', land, '| km² ~', int(land * CELL * CELL))

# cases France isolées d'une seule case : on les efface (bruit de rasterisation)
def idx(x, y): return y * W + x
removed = 0
for y in range(1, H - 1):
    for x in range(1, W - 1):
        k = idx(x, y)
        if terrain[k] == 1 and all(terrain[idx(x + dx, y + dy)] != 1 for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))):
            terrain[k] = 0; removed += 1
if removed:
    dept_arr = bytearray(dept_arr)
    for k in range(W * H):
        if terrain[k] != 1: dept_arr[k] = 0
    dept_arr = bytes(dept_arr)
print('cases isolées supprimées :', removed)

data = {
    'w': W, 'h': H, 'cell': CELL,
    'deptNames': [f['properties']['nom'] for f in dep],
    'deptCodes': [f['properties']['code'] for f in dep],
    'regionNames': [f['properties']['nom'] for f in reg],
    'deptRegion': dept_region,
    'terrain': base64.b64encode(bytes(terrain)).decode(),
    'dept': base64.b64encode(dept_arr).decode(),
}
json.dump(data, open(out_p, 'w'), separators=(',', ':'), ensure_ascii=False)
import os
print('fichier', os.path.getsize(out_p) // 1024, 'Ko')

# aperçu
pal = {0: (14, 30, 52), 1: (96, 140, 80), 2: (70, 66, 62)}
im = Image.new('RGB', (W, H))
im.putdata([pal[t] for t in terrain])
im = im.resize((W * 4, H * 4), Image.NEAREST)
im.save('/tmp/rts/grid_preview.png')
