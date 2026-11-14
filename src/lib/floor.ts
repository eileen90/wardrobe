/**
 * The closet floor: one arrangement that both views show. Every piece has a place on the floor
 * (`pos`, in centimetres) and a place in its rail (`order`); the two agree, because a piece's
 * place in its cluster, read left to right and top to bottom, is its place in the rail.
 *
 * Each kind has its own stretch of floor, side by side, so a cluster can grow without ever
 * running into the next one. Pieces she put down stay exactly there. Only pieces without a
 * place yet (new ones, or ones whose kind changed) are given one: the first free spot in their
 * own cluster, read like a page.
 */
import { between, bounds, hits, readingOrder, seeded, type Box, type Rect } from './canvas';
import { drawn, realSize } from './kind';
import { CATEGORIES, catPlural, type Category, type Item } from './types';

/** Pieces whose kind is not known yet wait apart, so they do not pose as tops. */
export type GroupId = Category | 'sorting';
export const unsorted = (i: Item) => i.kindSure === false && i.state !== 'ready';
export const groupOf = (i: Item): GroupId => (unsorted(i) ? 'sorting' : i.category);
export const groupName = (g: GroupId) => (g === 'sorting' ? 'sorting…' : catPlural(g));
/** Where a piece sits in its rail: wherever it was put, else newest first. */
export const rank = (i: Item) => i.order ?? -i.createdAt;
/** Rails in the order the lined-up view shows them. */
export const GROUPS: GroupId[] = ['sorting', ...CATEGORIES.map((c) => c.id)];

/** World units per centimetre at zoom 1. */
export const PX = 3;
const STEP = 4 * PX;
/** Floor between two clusters. */
const AISLE = 42 * PX;
/**
 * How far a piece may tuck under its neighbours, as a share of its width and height on each
 * side: enough to read as a pile, never enough to hide what a piece is or where to press it.
 */
const TUCK = 0.1;
/** Small things (a pair of socks, a ring) show little of themselves; they barely tuck at all. */
const tuckOf = (cluster: string) => (cluster === 'feet' || cluster === 'extra' ? 0.03 : cluster === 'bag' ? 0.06 : TUCK);

/** The floor, left to right, the way an outfit is put on; each cluster is a pile of one kind. */
const CLUSTERS: { id: string; name: string; cats: GroupId[]; width: number }[] = ([
  { id: 'outer', name: 'jackets & coats', cats: ['outer'], width: 160 },
  { id: 'top', name: 'tops & dresses', cats: ['top', 'dress'], width: 205 },
  { id: 'bottom', name: 'bottoms', cats: ['bottom'], width: 140 },
  { id: 'feet', name: 'socks & shoes', cats: ['socks', 'shoes'], width: 120 },
  { id: 'bag', name: 'bags', cats: ['bag'], width: 100 },
  { id: 'extra', name: 'accessories', cats: ['extra'], width: 115 },
  { id: 'sorting', name: 'sorting…', cats: ['sorting'], width: 125 },
] as { id: string; name: string; cats: GroupId[]; width: number }[]).map((c) => ({ ...c, width: c.width * PX }));
export const clusterOf = (i: Item) => CLUSTERS.find((c) => c.cats.includes(groupOf(i)))!.id;

/** Each cluster's stretch of floor, from x0 to x1 (world units). */
const LANES = (() => {
  let x = 0;
  return CLUSTERS.map((c) => { const l = { id: c.id, x0: x, x1: x + c.width }; x += c.width + AISLE; return l; });
})();
const lane = (id: string) => LANES.find((l) => l.id === id)!;

type Pos = NonNullable<Item['pos']>;
interface FloorBox extends Box { id: string; cluster: string }
export interface FloorLayout {
  boxes: Map<string, FloorBox>;
  /** places worked out just now, to be kept */
  fresh: Map<string, { pos: Pos; order: number }>;
  clusters: { id: string; name: string; n: number; rect: Rect }[];
}

/** Size on the floor: true to scale, small things a little larger, times any resizing by hand. */
function sizeOn(i: Item) {
  const d = drawn(realSize(i), PX);
  const s = i.pos?.s ?? 1;
  return { w: d.w * s, h: d.h * s };
}
const tilt = (id: string) => (seeded(id, 5) - 0.5) * 14;

/** Lightness of a piece's main colour, 0 (black) to 1 (white); unknown colours sit in the middle. */
function lightness(i: Item) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(i.colors?.[0] ?? '');
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const boxFor = (i: Item, cx: number, cy: number, cluster: string): FloorBox => {
  const s = sizeOn(i);
  return { id: i.id, cluster, cx, cy, w: s.w, h: s.h, rot: tilt(i.id), z: i.pos?.z ?? Math.round(seeded(i.id, 6) * 20) };
};
/** A place in the pile: what was laid lower down lies over what is above it, as when laying things out. */
const posOf = (i: Item, x: number, y: number, c: string): Pos => ({ ...(i.pos ?? {}), x: x / PX, y: y / PX, c, z: Math.round(y / PX) });

/** The part of a box no other piece may cover. */
const core = (b: Pick<Box, 'cx' | 'cy' | 'w' | 'h'>, t: number): Rect =>
  ({ x0: b.cx - b.w * (0.5 - t), x1: b.cx + b.w * (0.5 - t), y0: b.cy - b.h * (0.5 - t), y1: b.cy + b.h * (0.5 - t) });

/**
 * Where a piece without a place goes: as high up its cluster's lane as it fits, as if laid down
 * from the top of a pile, tucked a little under the pieces above and beside it, the leftmost
 * such spot when several are as high. A small offset of its own keeps the pile from looking ruled.
 */
function freeSpot(it: Item, cluster: string, boxes: Iterable<FloorBox>) {
  const L = lane(cluster);
  const s = sizeOn(it);
  const all = [...boxes];
  const T = tuckOf(cluster);
  const taken = all.map((b) => core(b, tuckOf(b.cluster)));
  const free = (x: number, y: number) => { const c = core({ cx: x, cy: y, w: s.w, h: s.h }, T); return !taken.some((o) => hits(c, o)); };
  const own = all.filter((b) => b.cx >= L.x0 - AISLE / 2 && b.cx < L.x1 + AISLE / 2).map((b) => core(b, T));
  const top = Math.min(0, ...own.map((o) => o.y0 - s.h * T));
  const half = s.w * (0.5 - T);
  let best: { x: number; y: number } | null = null;
  const x1 = Math.max(L.x0 + s.w / 2, L.x1 - s.w / 2);
  for (let x = L.x0 + s.w / 2; x <= x1 + 0.5; x += STEP) {
    // Dropped from above, it comes to rest on whatever lies under this stretch of the lane.
    let y0 = top;
    for (const o of own) if (o.x0 < x + half && x - half < o.x1) y0 = Math.max(y0, o.y1);
    const y = y0 + s.h * (0.5 - T);
    if (!best || y < best.y - STEP) best = { x, y };
  }
  let { x, y } = best ?? { x: L.x0 + s.w / 2, y: s.h / 2 };
  const jx = (seeded(it.id, 7) - 0.5) * 0.08 * s.w, jy = seeded(it.id, 8) * 0.06 * s.h;
  if (free(x + jx, y + jy)) { x += jx; y += jy; }
  // A piece put down by hand in the way: the next free spot below.
  while (!free(x, y)) y += STEP;
  return { x, y };
}

/** Rail order for a piece at a spot: between its neighbours of the same kind, in reading order. */
function orderAt(id: string, boxes: Iterable<FloorBox>, kindOf: (id: string) => GroupId | undefined, rankOf: (id: string) => number | undefined, cat: GroupId) {
  const read = readingOrder([...boxes].filter((b) => b.id === id || kindOf(b.id) === cat));
  const at = read.findIndex((b) => b.id === id);
  const r = (b?: FloorBox) => (b && b.id !== id ? rankOf(b.id) : undefined);
  return between(r(read[at - 1]), r(read[at + 1]));
}

/** Place every piece without a place: in its cluster's first free spot, in rail order. */
function place(all: Item[], boxes: Map<string, FloorBox>, newcomers: Item[], fresh: FloorLayout['fresh']) {
  const items = new Map(all.map((i) => [i.id, i]));
  const kindOf = (id: string) => { const i = items.get(id); return i && groupOf(i); };
  const rankOf = (id: string) => fresh.get(id)?.order ?? (items.get(id) && rank(items.get(id)!));
  for (const c of CLUSTERS) {
    const list = newcomers
      .filter((i) => clusterOf(i) === c.id)
      // Pieces already in a rail keep that order; the rest are poured in light to dark.
      .sort((p, q) => (p.order !== undefined && q.order !== undefined ? GROUPS.indexOf(groupOf(p)) - GROUPS.indexOf(groupOf(q)) || p.order - q.order
        : p.order !== undefined ? -1 : q.order !== undefined ? 1
        : lightness(q) - lightness(p) || p.createdAt - q.createdAt));
    for (const it of list) {
      const at = freeSpot(it, c.id, boxes.values());
      boxes.set(it.id, boxFor(it, at.x, at.y, c.id));
      const g = groupOf(it);
      const order = it.order ?? orderAt(it.id, boxes.values(), kindOf, rankOf, g);
      fresh.set(it.id, { pos: posOf(it, at.x, at.y, c.id), order });
    }
  }
}

export function layFloor(all: Item[]): FloorLayout {
  const boxes = new Map<string, FloorBox>();
  const fresh: FloorLayout['fresh'] = new Map();
  const newcomers: Item[] = [];
  for (const i of all) {
    const c = clusterOf(i);
    if (i.pos && i.pos.c === c) boxes.set(i.id, boxFor(i, i.pos.x * PX, i.pos.y * PX, c));
    else newcomers.push(i);
  }
  place(all, boxes, newcomers, fresh);
  const clusters = CLUSTERS.flatMap((c) => {
    const own = [...boxes.values()].filter((b) => b.cluster === c.id);
    const rect = bounds(own);
    const L = lane(c.id);
    return rect ? [{ id: c.id, name: c.name, n: own.length, rect: { ...rect, x0: Math.min(rect.x0, L.x0), x1: Math.max(rect.x1, L.x1) } }] : [];
  });
  return { boxes, fresh, clusters };
}

/**
 * The cluster whose stretch of floor (x, y) is in, and the kind a piece put down there takes:
 * that of the nearest piece of the cluster. Null outside every cluster, where it keeps its kind.
 */
export function dropTarget(layout: FloorLayout, items: Item[], x: number, y: number, moving: string[]) {
  const L = LANES.find((l) => x >= l.x0 - AISLE / 2 && x < l.x1 + AISLE / 2);
  if (!L || L.id === 'sorting') return null;
  const c = CLUSTERS.find((k) => k.id === L.id)!;
  let best: Category | null = null, d = Infinity;
  for (const b of layout.boxes.values()) {
    if (b.cluster !== L.id || moving.includes(b.id)) continue;
    const it = items.find((i) => i.id === b.id);
    const e = Math.hypot(b.cx - x, b.cy - y);
    if (it && e < d && it.category) { d = e; best = groupOf(it) === 'sorting' ? null : it.category; }
  }
  return { cluster: L.id, cat: best ?? ((c.cats.includes('shoes') ? 'shoes' : c.cats[0]) as Category) };
}

/** Rail order for a piece at a new floor spot, read among the pieces of its kind. */
export function orderOnFloor(layout: FloorLayout, items: Item[], id: string, cat: Category, x: number, y: number) {
  const m = new Map(items.map((i) => [i.id, i]));
  const boxes = new Map(layout.boxes);
  const b = boxes.get(id);
  if (b) boxes.set(id, { ...b, cx: x, cy: y });
  const kindOf = (k: string) => (k === id ? cat : m.get(k) && groupOf(m.get(k)!));
  const rankOf = (k: string) => { const i = m.get(k); return i && rank(i); };
  return orderAt(id, boxes.values(), kindOf, rankOf, cat);
}

/** Lay a cluster out again in the given order: what reordering the rails does to the floor. */
export function reflow(layout: FloorLayout, cluster: string, inOrder: Item[]): Map<string, Pos> {
  const moving = new Set(inOrder.map((i) => i.id));
  const boxes = new Map([...layout.boxes].filter(([id, b]) => !moving.has(id) && b.cluster !== cluster));
  const out = new Map<string, Pos>();
  for (const it of inOrder) {
    const at = freeSpot(it, cluster, boxes.values());
    boxes.set(it.id, boxFor(it, at.x, at.y, cluster));
    out.set(it.id, posOf(it, at.x, at.y, cluster));
  }
  return out;
}
