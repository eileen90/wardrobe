/**
 * The outfit on the looks page: any number of pieces of any kind, laid out as a flat lay at
 * true size. The first piece of each kind that nobody moved by hand sits where a flat lay puts
 * it; every other piece stays where it was put (a second top lands beside the first, to compare).
 */
import { fitBoard, flatLay, LAYER, LOOK_CM } from './boards';
import { realSize } from './kind';
import { BOARD_RATIO, uid, type Category, type Item, type Placed, type WorkingLook } from './types';

/** The kinds an outfit is built from. Tops and dresses share one. */
export const RAILS = [
  { id: 'top', label: 'top', title: 'tops & dresses', cats: ['top', 'dress'] as Category[] },
  { id: 'bottom', label: 'bottom', title: 'bottoms', cats: ['bottom'] as Category[] },
  { id: 'shoes', label: 'shoes', title: 'shoes', cats: ['shoes'] as Category[] },
  { id: 'outer', label: 'jacket', title: 'jackets & coats', cats: ['outer'] as Category[] },
  { id: 'socks', label: 'socks', title: 'socks', cats: ['socks'] as Category[] },
  { id: 'extra', label: 'accessory', title: 'accessories', cats: ['extra'] as Category[] },
  { id: 'bag', label: 'bag', title: 'bags', cats: ['bag'] as Category[] },
] as const;
export type RailId = (typeof RAILS)[number]['id'];
export const RAIL = Object.fromEntries(RAILS.map((r) => [r.id, r])) as Record<RailId, (typeof RAILS)[number]>;
/** Reading order down the body, then the sides: the order the up and down keys walk. */
export const KEY_ORDER: RailId[] = ['extra', 'outer', 'top', 'bag', 'bottom', 'socks', 'shoes'];
export const railOf = (item: Pick<Item, 'category'>): RailId => RAILS.find((r) => r.cats.includes(item.category))!.id;

export const EMPTY: WorkingLook = { pieces: [], kept: [], wish: true };
export type Find = (id: string) => Item | undefined;
export const finder = (items: Item[]): Find => {
  const m = new Map(items.map((i) => [i.id, i]));
  return (id) => m.get(id);
};

/** Height as a share of the board's height, for a width given as a share of its width. */
const hOf = (w: number, item: Item) => (w / (item.aspect || 1)) * BOARD_RATIO;
const trueW = (item: Item) => realSize(item).w / LOOK_CM;

/** Bring an outfit saved by an earlier version (one piece per kind, kept kinds) up to date. */
export function upgradeWorking(w: WorkingLook, find: Find): WorkingLook {
  const rails = new Set<string>(RAILS.map((r) => r.id));
  const ids = new Set(w.pieces.map((p) => p.id));
  if (w.kept.every((k) => ids.has(k)) && w.pieces.every((p) => p.rail)) return w;
  const pieces = w.pieces.map((p) => { const it = find(p.itemId); return p.rail || !it ? p : { ...p, rail: railOf(it) }; });
  const kept = w.kept.flatMap((k) => (ids.has(k) ? [k] : rails.has(k) ? pieces.filter((p) => p.rail === k).map((p) => p.id) : []));
  return { ...w, pieces, kept };
}

/** Put the pieces nobody moved by hand back where a flat lay puts them. */
export function layout(pieces: Placed[], find: Find): Placed[] {
  const lead = new Map<string, Placed>();
  for (const p of pieces) {
    const it = find(p.itemId);
    if (!it || p.byHand) continue;
    const r = railOf(it);
    if (!lead.has(r)) lead.set(r, p);
  }
  const lay = flatLay([...lead].map(([rail, p]) => ({ rail, item: find(p.itemId)! })));
  const at = new Map(lay.map((l) => [lead.get(l.rail)!.id, l]));
  return pieces.map((p) => { const l = at.get(p.id); return l ? { ...p, x: l.x, y: l.y, w: l.w, rot: 0 } : p; });
}

/** A box in shares of the board, for finding room. */
interface B { x: number; y: number; w: number; h: number }
const boxOf = (p: Placed, it: Item): B => ({ x: p.x, y: p.y, w: p.w, h: hOf(p.w, it) });
function overlap(a: B, b: B) {
  // Cut-outs have empty corners, so the boxes are trimmed a little before they count as touching.
  const t = 0.42;
  const ox = Math.min(a.x + a.w * t, b.x + b.w * t) - Math.max(a.x - a.w * t, b.x - b.w * t);
  const oy = Math.min(a.y + a.h * t, b.y + b.h * t) - Math.max(a.y - a.h * t, b.y - b.h * t);
  return ox > 0 && oy > 0 ? (ox * oy) / (a.w * a.h) : 0;
}

/** Room for another piece beside `near`, its top edge level with near's: right first, then left. */
function beside(pieces: Placed[], find: Find, w: number, h: number, near: B): { x: number; y: number } {
  const others = pieces.flatMap((p) => { const it = find(p.itemId); return it ? [boxOf(p, it)] : []; });
  const y = near.y - near.h / 2 + h / 2;
  const gap = 0.02;
  let best = { x: near.x + near.w / 2 + gap + w / 2, y, hit: Infinity };
  for (let i = 0; i < 8; i++) {
    for (const side of [1, -1]) {
      const x = near.x + side * (near.w / 2 + gap + w / 2 + i * (w + gap) * 0.5);
      const hit = others.reduce((s, o) => s + overlap({ x, y, w, h }, o), 0);
      if (hit < 0.04) return { x, y };
      if (hit < best.hit) best = { x, y, hit };
    }
  }
  return best;
}

/** Where a new piece goes in the stack: at its natural layer among the pieces there. */
function insert(pieces: Placed[], p: Placed, find: Find): Placed[] {
  const layer = (q: Placed) => { const it = find(q.itemId); return it ? LAYER.indexOf(railOf(it)) : 0; };
  const me = layer(p);
  const i = pieces.findIndex((q) => layer(q) > me);
  return i < 0 ? [...pieces, p] : [...pieces.slice(0, i), p, ...pieces.slice(i)];
}

/**
 * Put another piece on: dropped at a point (shares of the board), or, when none of its kind is
 * worn yet, where a flat lay puts it; otherwise beside the last one of its kind, to compare.
 */
export function addTo(pieces: Placed[], item: Item, find: Find, at?: { x: number; y: number }): { pieces: Placed[]; id: string } {
  const rail = railOf(item);
  const w = trueW(item);
  const id = uid();
  const base: Placed = { id, itemId: item.id, x: 0.5, y: 0.5, w, rot: 0, flip: false, rail };
  if (at) return { pieces: insert(pieces, { ...base, ...at, byHand: true }, find), id };
  const same = pieces.filter((p) => { const it = find(p.itemId); return it && railOf(it) === rail; });
  if (!same.length) return { pieces: layout(insert(pieces, base, find), find), id };
  const last = same[same.length - 1];
  const spot = beside(pieces, find, w, hOf(w, item), boxOf(last, find(last.itemId)!));
  return { pieces: insert(pieces, { ...base, ...spot, byHand: true }, find), id };
}

/**
 * Swap one piece for another of its kind, in the same place: a piece moved by hand keeps its
 * top edge and middle, at the same size relative to true scale; the rest are laid out again.
 */
export function swap(pieces: Placed[], pid: string, item: Item, find: Find, relayout = true): Placed[] {
  const next = pieces.map((p) => {
    if (p.id !== pid) return p;
    const old = find(p.itemId);
    if (!old) return { ...p, itemId: item.id };
    const w = p.w * (realSize(item).w / realSize(old).w);
    const top = p.y - hOf(p.w, old) / 2;
    return { ...p, itemId: item.id, w, y: top + hOf(w, item) / 2 };
  });
  return relayout ? layout(next, find) : next;
}

/** The next piece of a kind after `cur`, going `d` steps, skipping what is already worn. */
export function nextOf(pool: Item[], cur: string, d: number, worn: Set<string>): Item | null {
  if (!pool.length) return null;
  const i = Math.max(0, pool.findIndex((x) => x.id === cur));
  for (let n = 1; n <= pool.length; n++) {
    const c = pool[(((i + d * n) % pool.length) + pool.length) % pool.length];
    if (c.id !== cur && !worn.has(c.id)) return c;
  }
  return null;
}

/** Any other piece of a kind, not already worn. */
export function anyOther(pool: Item[], cur: string, worn: Set<string>): Item | null {
  const free = pool.filter((x) => x.id !== cur && !worn.has(x.id));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

/** The outfit as a saved look's pieces: laid out to fill the board. */
export function asLook(pieces: Placed[], items: Item[]): Placed[] {
  const find = finder(items);
  const on = pieces.filter((p) => find(p.itemId)).map((p) => ({ ...p, id: uid(), rail: undefined, byHand: undefined }));
  return fitBoard(on, items, 1.4);
}
