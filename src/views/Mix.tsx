/**
 * The outfit being put together on the looks board: what is worn, what each kind offers, and
 * every way of changing it. Each change is one step in the history.
 */
import { useEffect, useMemo } from 'react';
import { changeBoard } from '../lib/actions';
import { editPieces, labelOf, type Edit, type EditArg } from '../lib/boards';
import { addTo, anyOther, type B, EMPTY, finder, layout, nextOf, RAIL, RAILS, railOf, swap, upgradeWorking, type RailId } from '../lib/outfit';
import { getState, saveSettings, useStore } from '../lib/store';
import type { Item, Placed, WorkingLook } from '../lib/types';

export type Pools = Record<RailId, Item[]>;
/**
 * Every piece of each kind, the wishlist's too, whether or not its cut-out is ready yet (a photo
 * lies there as a print until it is): nothing is hidden from the looks.
 */
export const poolsOf = (items: Item[]): Pools =>
  Object.fromEntries(RAILS.map((r) => [r.id, items.filter((i) => (r.cats as readonly string[]).includes(i.category))])) as Pools;

export function useOutfit(shown = true) {
  const items = useStore((s) => s.items);
  const stored = useStore((s) => s.settings.working);
  const find = useMemo(() => finder(items), [items]);
  const work = useMemo(() => upgradeWorking(stored ?? EMPTY, find), [stored, find]);
  const pools = useMemo(() => poolsOf(items), [items]);
  const anything = RAILS.some((r) => pools[r.id].length);
  /** What is worn: only pieces still in the closet. */
  const pieces = useMemo(() => work.pieces.filter((p) => find(p.itemId)), [work.pieces, find]);

  const cur = () => upgradeWorking(getState().settings.working ?? EMPTY, find);
  const set = (next: WorkingLook, label: string, opts: { key?: string; quiet?: boolean } = {}) => changeBoard({ working: next }, label, opts);
  const setPieces = (ps: Placed[], label: string, opts: { key?: string; quiet?: boolean } = {}) => {
    const w = cur();
    const ids = new Set(ps.map((p) => p.id));
    set({ ...w, pieces: ps, kept: w.kept.filter((k) => ids.has(k)) }, label, opts);
  };
  const worn = (ps: Placed[], but?: string) => new Set(ps.filter((p) => p.id !== but).map((p) => p.itemId));
  const rail = (p: Placed): RailId | null => { const it = find(p.itemId); return it ? railOf(it) : null; };

  // A first visit starts with a top, a bottom and shoes.
  const start = () => {
    let ps: Placed[] = [];
    for (const r of ['top', 'bottom', 'shoes'] as RailId[]) {
      // Something of her own, cut out, before a wish or a photo.
      const rank = (i: Item) => (i.status === 'owned' ? 0 : 2) + (i.state === 'ready' ? 0 : 1);
      const it = [...pools[r]].sort((a, b) => rank(a) - rank(b)).find((i) => i.category !== 'dress') ?? pools[r][0];
      if (it) ps = addTo(ps, it, find).pieces;
    }
    return ps;
  };
  useEffect(() => {
    // (Only once the page is seen, so pieces still arriving are there to choose from.)
    if (stored || !anything || !shown) return;
    void saveSettings({ working: { ...EMPTY, pieces: start() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anything, !!stored, shown]);

  return {
    work, pieces, pools, anything, find, rail,
    start: () => setPieces(start(), 'Started an outfit'),
    /** Put another piece on (at a point on the board, in shares of it). Returns its id. */
    add: (item: Item, at?: { x: number; y: number }, avoid: B[] = []) => {
      const r = addTo(cur().pieces, item, find, at, avoid);
      setPieces(r.pieces, `Put on the ${RAIL[railOf(item)].label}`);
      return r.id;
    },
    /** The next piece of a kind nobody is wearing yet. */
    unworn: (r: RailId): Item | null => pools[r].find((i) => !worn(cur().pieces).has(i.id)) ?? null,
    /** Put a piece on from its page: in place of the first of its kind not kept, else beside it. */
    wear: (item: Item, avoid: B[] = []): string => {
      const w = cur();
      const r = railOf(item);
      const p = w.pieces.find((q) => rail(q) === r && !w.kept.includes(q.id));
      if (!p) {
        const a = addTo(w.pieces, item, find, undefined, avoid);
        setPieces(a.pieces, `Put on the ${RAIL[r].label}`);
        return a.id;
      }
      setPieces(swap(w.pieces, p.id, item, find), `Put on the ${RAIL[r].label}`);
      return p.id;
    },
    /** Swap these pieces for the next (or previous) of their kind. */
    step: (ids: string[], d: number) => {
      let ps = cur().pieces;
      for (const id of ids) {
        const p = ps.find((q) => q.id === id), r = p && rail(p);
        if (!p || !r) continue;
        const it = nextOf(pools[r], p.itemId, d, worn(ps, id));
        if (it) ps = swap(ps, id, it, find);
      }
      setPieces(ps, 'Changed', { key: 'swap:' + ids.join(), quiet: true });
    },
    /** Put this item on in place of a piece. */
    replace: (pid: string, item: Item) => setPieces(swap(cur().pieces, pid, item, find), 'Changed', { key: 'swap:' + pid, quiet: true }),
    /** Every piece not kept, one step along its kind. */
    stepAll: (d: number) => {
      const w = cur();
      let ps = w.pieces;
      for (const p of w.pieces) {
        const r = rail(p);
        if (!r || w.kept.includes(p.id)) continue;
        const it = nextOf(pools[r], p.itemId, d, worn(ps, p.id));
        if (it) ps = swap(ps, p.id, it, find);
      }
      setPieces(ps, 'Changed', { key: 'swap:all', quiet: true });
    },
    shuffle: () => {
      const w = cur();
      let ps = w.pieces;
      for (const p of w.pieces) {
        const r = rail(p);
        if (!r || w.kept.includes(p.id)) continue;
        const it = anyOther(pools[r], p.itemId, worn(ps, p.id));
        if (it) ps = swap(ps, p.id, it, find);
      }
      setPieces(ps, 'Shuffled');
    },
    keep: (ids: string[]) => {
      const w = cur();
      const all = ids.every((id) => w.kept.includes(id));
      const kept = all ? w.kept.filter((k) => !ids.includes(k)) : [...new Set([...w.kept, ...ids])];
      const one = ids.length === 1 ? w.pieces.find((p) => p.id === ids[0]) : null;
      const what = one && rail(one) ? `the ${RAIL[rail(one)!].label}` : `${ids.length}`;
      set({ ...w, kept }, all ? `Let go of ${what}` : `Kept ${what}`);
    },
    letGo: () => set({ ...cur(), kept: [] }, 'Let go'),
    /** Take off every piece showing one of these items. */
    takeOff: (itemIds: string[]) => setPieces(cur().pieces.filter((p) => !itemIds.includes(p.itemId)), 'Took off'),
    edit: (a: Edit, ids: string[], arg: EditArg = {}, key?: string) => {
      const ps = editPieces(cur().pieces, a, ids, arg);
      if (!ps) return null;
      // A piece taken off gives the next of its kind the outfit's place.
      setPieces(a === 'remove' ? layout(ps, find) : ps, a === 'remove' ? (ids.length === 1 ? 'Took off' : `Took off ${ids.length}`) : labelOf(a, arg), { key });
      return ps;
    },
  };
}
export type Outfit = ReturnType<typeof useOutfit>;
