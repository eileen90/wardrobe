/**
 * The closet floor: one arrangement that both views show. Every piece has a place on the floor
 * (`pos`, in centimetres) and a place in its rail (`order`); the two agree, because a piece's
 * place in its bubble, read left to right and top to bottom, is its place in the rail.
 *
 * Each kind lies as a bubble: a roundish group of its pieces at their true sizes, close but never
 * on top of one another, with an aisle around it and its name just above. Pieces she put down
 * stay exactly there. Only pieces without a place yet (new ones, or ones whose kind changed) are
 * given one: the free spot nearest the middle of their own bubble, which grows around it.
 */
import { between, hits, readingOrder, seeded, type Box, type Rect } from './canvas';
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
/** Floor between two pieces of a bubble. */
const GAP = 4 * PX;
/** Floor between two bubbles. */
const AISLE = 34 * PX;
/** Room above a bubble for its name, as large as it is drawn when zoomed far out. */
const LABEL_H = 32 * PX;
/** World width of one letter of a bubble's name at its largest. */
const LETTER = 26;
/** The floor's shape, as wide as a laptop screen is. */
const ASPECT = 1.7;
/** How far a piece lies turned, either way, in degrees. */
const TURN = 4;
/** Air left loose in a bubble, as a share of a piece's size. */
const LOOSE = 0.1;

/** Bubbles in the order an outfit is put on; the kinds not sorted yet come last. */
const BUBBLES: GroupId[] = [...CATEGORIES.map((c) => c.id), 'sorting'];
/** A piece's bubble is its kind. */
export const clusterOf = (i: Item): string => groupOf(i);

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
const tilt = (id: string) => (seeded(id, 5) - 0.5) * 2 * TURN;
/** The upright rectangle a piece takes up once turned. */
function extent(w: number, h: number, rot: number) {
  const t = (rot * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  return { w: w * c + h * s, h: w * s + h * c };
}
const extentOf = (i: Item) => { const s = sizeOn(i); return extent(s.w, s.h, tilt(i.id)); };
const rectOf = (b: Box): Rect => { const e = extent(b.w, b.h, b.rot); return { x0: b.cx - e.w / 2, x1: b.cx + e.w / 2, y0: b.cy - e.h / 2, y1: b.cy + e.h / 2 }; };
const grow = (r: Rect, x: number, top = x, bottom = x): Rect => ({ x0: r.x0 - x, x1: r.x1 + x, y0: r.y0 - top, y1: r.y1 + bottom });
function boundsOf(boxes: Iterable<Box>): Rect | null {
  let r: Rect | null = null;
  for (const b of boxes) {
    const e = rectOf(b);
    r = r ? { x0: Math.min(r.x0, e.x0), y0: Math.min(r.y0, e.y0), x1: Math.max(r.x1, e.x1), y1: Math.max(r.y1, e.y1) } : e;
  }
  return r;
}
const nameOf = (g: string) => groupName(g as GroupId);
/** How wide a bubble's name can be drawn. */
const labelW = (g: string, n: number) => (nameOf(g).length + 3 + String(n).length) * LETTER;

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
const posOf = (i: Item, x: number, y: number, c: string): Pos => {
  const e = extentOf(i);
  return { ...(i.pos ?? {}), x: x / PX, y: y / PX, c, z: i.pos?.z ?? Math.round(seeded(i.id, 6) * 20), at: { w: Math.round(e.w / PX), h: Math.round(e.h / PX) } };
};

/* ---------- a bubble ---------- */

interface Packed { id: string; w: number; h: number; spots: Map<string, { x: number; y: number }> }

/**
 * Pieces in rail order, packed as a round bubble: rows as wide as a circle is at that height,
 * read left to right and top to bottom, each piece a little off its row's line.
 * Spots are centres, from the bubble's top left corner.
 */
function pack(id: string, list: Item[]): Packed {
  const ext = list.map(extentOf);
  const cw = ext.map((e) => e.w + GAP), ch = ext.map((e) => e.h + GAP);
  // However many rows make the roundest bubble, each holding as many pieces as a circle is wide there.
  let rows: number[][] = [];
  let best = Infinity;
  for (let m = 1; m <= list.length; m++) {
    const cap = Array.from({ length: m }, (_, r) => Math.sqrt(1 - ((r + 0.5 - m / 2) / (m / 2 + 0.5)) ** 2));
    const sum = cap.reduce((s, c) => s + c, 0);
    // Largest remainder, at least one each.
    const want = cap.map((c) => Math.max(1, (c / sum) * list.length));
    const take = want.map(Math.floor);
    let left = list.length - take.reduce((s, t) => s + t, 0);
    const byRest = want.map((w, r) => [w - Math.floor(w), r]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; left > 0; k = (k + 1) % m, left--) take[byRest[k][1]]++;
    for (let k = m - 1; left < 0; k = (k + m - 1) % m) if (take[byRest[k][1]] > 1) { take[byRest[k][1]]--; left++; }
    const trial: number[][] = [];
    let k = 0;
    for (const t of take) { trial.push(Array.from({ length: t }, () => k++)); }
    const W = Math.max(...trial.map((row) => row.reduce((s, j) => s + cw[j], 0)));
    const H = trial.reduce((s, row) => s + Math.max(...row.map((j) => ch[j])), 0);
    const score = Math.abs(Math.log(W / H));
    if (score < best) { best = score; rows = trial; }
    if (H > W * 1.5) break;
  }
  // A little air of its own around each piece, and each row nudged to one side, so the bubble
  // reads as laid down by hand rather than ruled.
  const spots = new Map<string, { x: number; y: number }>();
  const air = list.map((it, j) => seeded(it.id, 10) * cw[j] * LOOSE);
  const widths = rows.map((row) => row.reduce((s, j) => s + cw[j] + air[j], 0));
  const W = Math.max(0, ...widths);
  let top = 0;
  rows.forEach((row, r) => {
    const rowH = Math.max(...row.map((j) => ch[j]));
    const breath = rowH * LOOSE;
    const mean = widths[r] / row.length;
    let x = (W - widths[r]) / 2 + (rows.length > 1 ? (seeded(id + r, 9) - 0.5) * mean * 0.35 : 0);
    for (const j of row) {
      x += air[j] / 2;
      const y = top + GAP / 2 + ext[j].h / 2 + (rowH + breath - ch[j]) * seeded(list[j].id, 8);
      spots.set(list[j].id, { x: x + cw[j] / 2, y });
      x += cw[j] + air[j] / 2;
    }
    top += rowH + breath;
  });
  // The bubble's own bounds, without the half gaps around its edge.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  list.forEach((it, j) => {
    const s = spots.get(it.id)!;
    x0 = Math.min(x0, s.x - ext[j].w / 2); x1 = Math.max(x1, s.x + ext[j].w / 2);
    y0 = Math.min(y0, s.y - ext[j].h / 2); y1 = Math.max(y1, s.y + ext[j].h / 2);
  });
  for (const s of spots.values()) { s.x -= x0; s.y -= y0; }
  return { id, w: list.length ? x1 - x0 : 0, h: list.length ? y1 - y0 : 0, spots };
}

/**
 * Bubbles in a loose row or a few, in outfit order, each row's bubbles level at the top so their
 * names line up, each row centred. The number of rows that brings the floor nearest a laptop
 * screen's shape wins. Returns each bubble's top left corner.
 */
function plan(bubbles: (Packed & { n: number })[]) {
  const slot = (b: Packed & { n: number }) => Math.max(b.w, labelW(b.id, b.n));
  const total = bubbles.reduce((s, b) => s + slot(b), 0) + AISLE * (bubbles.length - 1);
  let best: { rows: (Packed & { n: number })[][]; score: number } | null = null;
  for (let r = 1; r <= Math.min(4, bubbles.length); r++) {
    const target = total / r;
    const rows: (Packed & { n: number })[][] = [[]];
    let w = 0;
    for (const b of bubbles) {
      const row = rows[rows.length - 1];
      const add = slot(b) + (row.length ? AISLE : 0);
      if (row.length && w + add / 2 > target && rows.length < r) { rows.push([b]); w = slot(b); }
      else { row.push(b); w += add; }
    }
    const W = Math.max(...rows.map((row) => row.reduce((s, b) => s + slot(b), 0) + AISLE * (row.length - 1)));
    const H = rows.reduce((s, row) => s + Math.max(...row.map((b) => b.h)) + LABEL_H, 0) + AISLE * (rows.length - 1);
    const score = Math.abs(Math.log(W / H / ASPECT));
    if (!best || score < best.score - 0.01) best = { rows, score };
  }
  const at = new Map<string, { x: number; y: number }>();
  if (!best) return at;
  const widths = best.rows.map((row) => row.reduce((s, b) => s + slot(b), 0) + AISLE * (row.length - 1));
  const W = Math.max(...widths);
  let y = LABEL_H;
  best.rows.forEach((row, k) => {
    let x = (W - widths[k]) / 2;
    for (const b of row) {
      at.set(b.id, { x: x + (slot(b) - b.w) / 2, y });
      x += slot(b) + AISLE;
    }
    y += Math.max(...row.map((b) => b.h)) + LABEL_H + AISLE;
  });
  return at;
}

/** Floor that belongs to the other bubbles: each with its aisle and the room for its name. */
function zonesBut(cluster: string, boxes: Iterable<FloorBox>) {
  const by = new Map<string, FloorBox[]>();
  for (const b of boxes) if (b.cluster !== cluster) by.set(b.cluster, [...(by.get(b.cluster) ?? []), b]);
  return [...by.values()].map((l) => grow(boundsOf(l)!, AISLE / 2, LABEL_H + AISLE / 2, AISLE / 2));
}

/**
 * Where a piece without a place goes in a bubble that has pieces: the free spot nearest its
 * middle, just beside one of its pieces, never over a piece, another bubble or its name. Spots
 * above the bubble count as further, so its name stays where it is.
 */
function freeSpot(it: Item, cluster: string, boxes: Iterable<FloorBox>) {
  const all = [...boxes];
  const own = all.filter((b) => b.cluster === cluster).map(rectOf);
  const taken = all.map(rectOf);
  const zones = zonesBut(cluster, all);
  const e = extentOf(it);
  const B = own.length ? own.reduce((r, o) => ({ x0: Math.min(r.x0, o.x0), x1: Math.max(r.x1, o.x1), y0: Math.min(r.y0, o.y0), y1: Math.max(r.y1, o.y1) })) : null;
  const cx = B ? (B.x0 + B.x1) / 2 : 0, cy = B ? (B.y0 + B.y1) / 2 : 0;
  const box = (x: number, y: number): Rect => ({ x0: x - e.w / 2, x1: x + e.w / 2, y0: y - e.h / 2, y1: y + e.h / 2 });
  const free = (x: number, y: number) => {
    const r = box(x, y), g = grow(r, GAP - 0.01);
    // Above the bubble, its name moves up too.
    const named = B && r.y0 < B.y0 ? { ...r, y0: r.y0 - LABEL_H } : r;
    return !taken.some((o) => hits(g, o)) && !zones.some((z) => hits(named, z));
  };
  const cost = (x: number, y: number) => Math.hypot(x - cx, y - cy) + (B ? Math.max(0, B.y0 - (y - e.h / 2)) * 3 : 0);
  let best: { x: number; y: number; c: number } | null = null;
  const consider = (x: number, y: number) => {
    const c = cost(x, y);
    if ((!best || c < best.c) && free(x, y)) best = { x, y, c };
  };
  for (const o of own) {
    const ocx = (o.x0 + o.x1) / 2, ocy = (o.y0 + o.y1) / 2;
    for (const y of [ocy, o.y0 + e.h / 2, o.y1 - e.h / 2]) {
      consider(o.x1 + GAP + e.w / 2, y);
      consider(o.x0 - GAP - e.w / 2, y);
    }
    for (const x of [ocx, o.x0 + e.w / 2, o.x1 - e.w / 2]) {
      consider(x, o.y1 + GAP + e.h / 2);
      consider(x, o.y0 - GAP - e.h / 2);
    }
  }
  if (!best) {
    // Hemmed in: the nearest free floor, further and further out.
    for (let r = STEP; r < 400 * STEP && !best; r += STEP) {
      for (let a = 0; a < 360; a += 10) consider(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180));
    }
  }
  const b = best as { x: number; y: number } | null;
  return b ?? { x: cx, y: cy };
}

/** Where a new bubble goes when the floor already has others: beside them or under them, whichever keeps the floor nearer a screen's shape. */
function newBubbleAt(p: Packed, boxes: Iterable<FloorBox>) {
  const all = boundsOf(boxes);
  if (!all) return { x: 0, y: LABEL_H };
  const right = { x: all.x1 + AISLE, y: all.y0 };
  const below = { x: all.x0, y: all.y1 + AISLE + LABEL_H };
  const shape = (x1: number, y1: number) => Math.abs(Math.log((Math.max(all.x1, x1) - all.x0) / (Math.max(all.y1, y1) - all.y0 + LABEL_H) / ASPECT));
  return shape(right.x + p.w, right.y + p.h) <= shape(below.x + p.w, below.y + p.h) ? right : below;
}

/** Rail order for a piece at a spot: between its neighbours of the same kind, in reading order. */
function orderAt(id: string, boxes: Iterable<FloorBox>, kindOf: (id: string) => GroupId | undefined, rankOf: (id: string) => number | undefined, cat: GroupId) {
  const read = readingOrder([...boxes].filter((b) => b.id === id || kindOf(b.id) === cat));
  const at = read.findIndex((b) => b.id === id);
  const r = (b?: FloorBox) => (b && b.id !== id ? rankOf(b.id) : undefined);
  return between(r(read[at - 1]), r(read[at + 1]));
}

/** Place every piece without a place: into its bubble, or as a new bubble, in rail order. */
function place(all: Item[], boxes: Map<string, FloorBox>, newcomers: Item[], fresh: FloorLayout['fresh']) {
  const items = new Map(all.map((i) => [i.id, i]));
  const kindOf = (id: string) => { const i = items.get(id); return i && groupOf(i); };
  const rankOf = (id: string) => fresh.get(id)?.order ?? (items.get(id) && rank(items.get(id)!));
  const put = (it: Item, x: number, y: number, c: string) => {
    boxes.set(it.id, boxFor(it, x, y, c));
    const order = it.order ?? orderAt(it.id, boxes.values(), kindOf, rankOf, groupOf(it));
    fresh.set(it.id, { pos: posOf(it, x, y, c), order });
  };
  const byBubble = BUBBLES.map((c) => ({
    c,
    list: newcomers
      .filter((i) => clusterOf(i) === c)
      // Pieces already in a rail keep that order; the rest are poured in light to dark.
      .sort((p, q) => (p.order !== undefined && q.order !== undefined ? p.order - q.order
        : p.order !== undefined ? -1 : q.order !== undefined ? 1
        : lightness(q) - lightness(p) || p.createdAt - q.createdAt)),
  })).filter((b) => b.list.length);
  const has = (c: string) => [...boxes.values()].some((b) => b.cluster === c);
  const fromScratch = boxes.size === 0;
  const fresh_ = byBubble.filter((b) => !has(b.c)).map((b) => ({ ...pack(b.c, b.list), n: b.list.length, list: b.list }));
  if (fromScratch) {
    // The whole floor at once: bubbles in rows.
    const at = plan(fresh_);
    for (const p of fresh_) {
      const o = at.get(p.id)!;
      for (const it of p.list) { const s = p.spots.get(it.id)!; put(it, o.x + s.x, o.y + s.y, p.id); }
    }
  } else {
    for (const p of fresh_) {
      const o = newBubbleAt(p, boxes.values());
      for (const it of p.list) { const s = p.spots.get(it.id)!; put(it, o.x + s.x, o.y + s.y, p.id); }
    }
  }
  for (const b of byBubble) {
    if (fresh_.some((p) => p.id === b.c)) continue;
    for (const it of b.list) { const at = freeSpot(it, b.c, boxes.values()); put(it, at.x, at.y, b.c); }
  }
}

export function layFloor(all: Item[]): FloorLayout {
  const boxes = new Map<string, FloorBox>();
  const fresh: FloorLayout['fresh'] = new Map();
  const newcomers: Item[] = [];
  const regrown: Item[] = [];
  for (const i of all) {
    const c = clusterOf(i);
    if (i.pos && i.pos.c === c) {
      boxes.set(i.id, boxFor(i, i.pos.x * PX, i.pos.y * PX, c));
      const e = extentOf(i), at = i.pos.at;
      if (at && (Math.abs(e.w / PX - at.w) > 1 || Math.abs(e.h / PX - at.h) > 1)) regrown.push(i);
    } else newcomers.push(i);
  }
  // A piece the floor placed that has since grown (its picture came in) and now lies on a
  // neighbour is given a new place; one that still fits stays.
  for (const i of regrown) {
    const r = grow(rectOf(boxes.get(i.id)!), GAP - 0.01);
    if ([...boxes.values()].some((b) => b.id !== i.id && hits(r, rectOf(b)))) { boxes.delete(i.id); newcomers.push(i); }
  }
  place(all, boxes, newcomers, fresh);
  const clusters = BUBBLES.flatMap((c) => {
    const own = [...boxes.values()].filter((b) => b.cluster === c);
    const rect = boundsOf(own);
    return rect ? [{ id: c, name: nameOf(c), n: own.length, rect }] : [];
  });
  return { boxes, fresh, clusters };
}

/**
 * The bubble (x, y) is in or beside, and the kind a piece put down there takes: the bubble's own.
 * Null outside every bubble, where it keeps its kind.
 */
export function dropTarget(layout: FloorLayout, _items: Item[], x: number, y: number, _moving: string[]) {
  let best: { cluster: string; cat: Category } | null = null, d = Infinity;
  for (const c of layout.clusters) {
    if (c.id === 'sorting') continue;
    const r = grow(c.rect, AISLE / 2, LABEL_H, AISLE / 2);
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const e = Math.hypot((c.rect.x0 + c.rect.x1) / 2 - x, (c.rect.y0 + c.rect.y1) / 2 - y);
    if (e < d) { d = e; best = { cluster: c.id, cat: c.id as Category }; }
  }
  return best;
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

/**
 * Lay a bubble out again in the given order: what reordering the rails does to the floor. It
 * keeps its place (top and middle); a piece that would land on another bubble finds free floor.
 */
export function reflow(layout: FloorLayout, cluster: string, inOrder: Item[]): Map<string, Pos> {
  const moving = new Set(inOrder.map((i) => i.id));
  const old = boundsOf([...layout.boxes.values()].filter((b) => b.cluster === cluster && moving.has(b.id)));
  const boxes = new Map([...layout.boxes].filter(([id, b]) => !moving.has(id) && b.cluster !== cluster));
  const p = pack(cluster, inOrder);
  const o = old ? { x: (old.x0 + old.x1) / 2 - p.w / 2, y: old.y0 } : newBubbleAt(p, boxes.values());
  const zones = zonesBut(cluster, boxes.values());
  const others = [...boxes.values()].map(rectOf);
  const out = new Map<string, Pos>();
  for (const it of inOrder) {
    const s = p.spots.get(it.id)!;
    let x = o.x + s.x, y = o.y + s.y;
    const r = rectOf(boxFor(it, x, y, cluster));
    if (others.some((q) => hits(grow(r, GAP - 0.01), q)) || zones.some((z) => hits(r, z))) ({ x, y } = freeSpot(it, cluster, boxes.values()));
    const b = boxFor(it, x, y, cluster);
    boxes.set(it.id, b);
    others.push(rectOf(b));
    out.set(it.id, posOf(it, x, y, cluster));
  }
  return out;
}
