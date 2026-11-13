import { useEffect, useMemo, useRef, useState } from 'react';
import { keepLook, step } from '../lib/actions';
import { BH, boxOnBoard, BW, fitBoard, flatLay, LAYER, LOOK_CM, newLook } from '../lib/boards';
import { bounds } from '../lib/canvas';
import { realSize } from '../lib/kind';
import { isKey } from '../lib/shortcuts';
import { getState, saveSettings, useStore } from '../lib/store';
import { BOARD_RATIO, uid, type Category, type Item, type Placed, type WorkingLook } from '../lib/types';
import { Icon, Mark, toast } from '../ui';
import { Canvas, type CanvasApi, type CanvasPiece } from './Canvas';
import { editPieces, LABELS } from './Board';
import { Lock, RailPicker } from './RailPicker';

/** The rails an outfit is built from. Tops and dresses share one. */
const RAILS = [
  { id: 'top', label: 'top', title: 'tops & dresses', cats: ['top', 'dress'] as Category[] },
  { id: 'bottom', label: 'bottom', title: 'bottoms', cats: ['bottom'] as Category[] },
  { id: 'shoes', label: 'shoes', title: 'shoes', cats: ['shoes'] as Category[] },
  { id: 'outer', label: 'jacket', title: 'jackets & coats', cats: ['outer'] as Category[] },
  { id: 'socks', label: 'socks', title: 'socks', cats: ['socks'] as Category[] },
  { id: 'extra', label: 'accessory', title: 'accessories', cats: ['extra'] as Category[] },
  { id: 'bag', label: 'bag', title: 'bags', cats: ['bag'] as Category[] },
] as const;
type RailId = (typeof RAILS)[number]['id'];
const RAIL = Object.fromEntries(RAILS.map((r) => [r.id, r])) as Record<RailId, (typeof RAILS)[number]>;
/** The order the rail keys walk through: down the body, then the sides. */
const KEY_ORDER: RailId[] = ['extra', 'outer', 'top', 'bag', 'bottom', 'socks', 'shoes'];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
const EMPTY: WorkingLook = { pieces: [], kept: [], wish: true };
const hf = (p: Placed, item: Item) => (p.w / (item.aspect || 1)) * BOARD_RATIO;

/**
 * Put the chosen pieces on the outfit. Pieces moved by hand stay where she put them (a new piece
 * on that rail takes their place, top edge and middle, at the same size relative to true scale);
 * the rest are laid out as a flat lay.
 */
function rebuild(picks: Map<RailId, Item>, prev: Placed[], items: Item[]): Placed[] {
  const lay = flatLay([...picks].map(([rail, item]) => ({ rail, item })));
  const out: Placed[] = [];
  for (const l of lay) {
    const rail = l.rail as RailId;
    const item = picks.get(rail)!;
    const old = prev.find((p) => p.rail === rail);
    const oldItem = old && items.find((i) => i.id === old.itemId);
    if (old && old.byHand && oldItem) {
      const k = old.w / (realSize(oldItem).w / LOOK_CM);
      const w = (realSize(item).w / LOOK_CM) * k;
      const topEdge = old.y - hf(old, oldItem) / 2;
      out.push({ ...old, itemId: item.id, w, y: topEdge + ((w / (item.aspect || 1)) * BOARD_RATIO) / 2 });
    } else {
      out.push({ id: old?.id ?? uid(), itemId: item.id, x: l.x, y: l.y, w: l.w, rot: 0, flip: old?.flip ?? false, rail });
    }
  }
  // Pieces already there keep their layering; new ones go in at their natural layer.
  const at = (p: Placed) => { const i = prev.findIndex((q) => q.rail === p.rail); return i < 0 ? LAYER.indexOf(p.rail!) - 0.5 : i; };
  return prev.length ? out.sort((a, b) => at(a) - at(b)) : out;
}

/** The looks page: the outfit being put together, on the same canvas as a saved board. */
export function Mix({ startWith, active, onSaved, onFocus, onAdd, children }: {
  startWith: string | null;
  /** true while this is what the keyboard is talking to */
  active: boolean;
  onSaved: (lookId: string) => void;
  onFocus: (id: string, from: DOMRect, sequence: string[]) => void;
  onAdd: () => void;
  children?: React.ReactNode;
}) {
  const items = useStore((s) => s.items);
  const nLooks = useStore((s) => s.looks.length);
  const stored = useStore((s) => s.settings.working);
  const work = stored ?? EMPTY;
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [cur, setCur] = useState<RailId | null>(null);
  const [picking, setPicking] = useState<RailId | null>(null);
  const api = useRef<CanvasApi | null>(null);

  const pools = useMemo(() => {
    const ready = items.filter((i) => i.state === 'ready' && (work.wish || i.status === 'owned'));
    return Object.fromEntries(RAILS.map((r) => [r.id, ready.filter((i) => r.cats.includes(i.category))])) as Record<RailId, Item[]>;
  }, [items, work.wish]);
  const anything = RAILS.some((r) => pools[r.id].length);

  /** What is worn, rail by rail (only pieces still in the closet and still on their rail). */
  const worn = useMemo(() => {
    const m = new Map<RailId, Item>();
    for (const p of work.pieces) {
      const it = items.find((i) => i.id === p.itemId);
      if (it && p.rail && RAIL[p.rail as RailId]?.cats.includes(it.category)) m.set(p.rail as RailId, it);
    }
    return m;
  }, [work.pieces, items]);

  /** Every change to the outfit is one step back. */
  const set = (next: WorkingLook, label: string, opts: { key?: string; quiet?: boolean } = {}) => {
    const before = getState().settings.working ?? EMPTY;
    void saveSettings({ working: next });
    step(label, () => void saveSettings({ working: before }), opts);
  };
  const wear = (picks: Map<RailId, Item>, label: string, opts: { key?: string; quiet?: boolean; kept?: string[] } = {}) => {
    const cur = getState().settings.working ?? EMPTY;
    // A dress is worn without a bottom.
    if (picks.get('top')?.category === 'dress') picks.delete('bottom');
    set({ ...cur, kept: (opts.kept ?? cur.kept).filter((r) => picks.has(r as RailId)), pieces: rebuild(picks, cur.pieces, items) }, label, opts);
  };

  // A first visit starts with a top, a bottom and shoes.
  useEffect(() => {
    if (stored || !anything) return;
    const picks = new Map<RailId, Item>();
    for (const r of ['top', 'bottom', 'shoes'] as RailId[]) if (pools[r][0]) picks.set(r, pools[r][0]);
    void saveSettings({ working: { ...EMPTY, pieces: rebuild(picks, [], items) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anything, !!stored]);

  // Opened from a piece: put it on its rail.
  useEffect(() => {
    if (!startWith) return;
    const it = items.find((i) => i.id === startWith);
    const rail = it && RAILS.find((r) => r.cats.includes(it.category));
    if (!it || !rail) return;
    const picks = new Map(worn);
    picks.set(rail.id, it);
    wear(picks, 'Put on');
    if (it.status === 'wish' && !work.wish) void saveSettings({ working: { ...(getState().settings.working ?? EMPTY), wish: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  const indexOf = (r: RailId) => Math.max(0, pools[r].findIndex((i) => i.id === worn.get(r)?.id));
  const go = (r: RailId, to: number, label = 'Changed', key?: string) => {
    const pool = pools[r];
    if (!pool.length) return;
    const picks = new Map(worn);
    picks.set(r, pool[((to % pool.length) + pool.length) % pool.length]);
    wear(picks, label, { key, quiet: true });
  };
  const stepRail = (r: RailId, d: number) => go(r, indexOf(r) + d, `Changed the ${RAIL[r].label}`, 'rail:' + r);
  const free = () => RAILS.filter((r) => worn.has(r.id) && !work.kept.includes(r.id)).map((r) => r.id);
  const stepAll = (d: number) => {
    const picks = new Map(worn);
    for (const r of free()) { const p = pools[r]; if (p.length > 1) picks.set(r, p[(((indexOf(r) + d) % p.length) + p.length) % p.length]); }
    wear(picks, 'Changed', { key: 'rail:all', quiet: true });
  };
  const shuffle = () => {
    const picks = new Map(worn);
    for (const r of free()) {
      const p = pools[r], i = indexOf(r);
      if (p.length < 2) continue;
      let k = i;
      while (k === i) k = Math.floor(Math.random() * p.length);
      picks.set(r, p[k]);
    }
    wear(picks, 'Shuffled');
  };
  const keep = (r: RailId) => {
    const kept = work.kept.includes(r) ? work.kept.filter((x) => x !== r) : [...work.kept, r];
    set({ ...work, kept }, kept.includes(r) ? `Kept the ${RAIL[r].label}` : `Let go of the ${RAIL[r].label}`);
  };
  const clear = (rails: RailId[]) => {
    const picks = new Map(worn);
    rails.forEach((r) => picks.delete(r));
    wear(picks, rails.length === 1 ? `Took off the ${RAIL[rails[0]].label}` : 'Took off');
    if (picking && rails.includes(picking)) setPicking(null);
    setSel(new Set());
  };
  const add = (r: RailId) => {
    const picks = new Map(worn);
    picks.set(r, pools[r][0]);
    wear(picks, `Added a ${RAIL[r].label}`);
    setCur(r);
  };
  const save = async () => {
    const pieces = work.pieces.filter((p) => items.some((i) => i.id === p.itemId)).map((p) => ({ ...p, id: uid(), rail: undefined, byHand: undefined }));
    if (!pieces.length) return;
    const look = newLook(nLooks, fitBoard(pieces, items, 1.4));
    await keepLook(look);
    toast('Saved', { label: 'Open', run: () => onSaved(look.id) });
  };

  const railOf = (pid: string) => work.pieces.find((p) => p.id === pid)?.rail as RailId | undefined;
  const pieces: CanvasPiece[] = useMemo(() => work.pieces.flatMap((p, z) => {
    const item = items.find((i) => i.id === p.itemId);
    return item && p.rail && worn.get(p.rail as RailId)?.id === item.id ? [{ id: p.id, item, box: boxOnBoard(p, item, z + 1), flip: p.flip }] : [];
  }), [work.pieces, items, worn]);
  const edit = (a: Parameters<typeof editPieces>[1], ids: string[], arg: { dx?: number; dy?: number; k?: number } = {}, key?: string) => {
    if (a === 'remove') return clear(ids.map(railOf).filter((r): r is RailId => !!r));
    if (a === 'duplicate') return;
    const next = editPieces(work.pieces, a, ids, arg);
    if (next) set({ ...work, pieces: next }, LABELS[a], { key });
  };

  // Keys for building, when no piece is selected (a selection takes the canvas keys).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!active || e.defaultPrevented || typing(e.target) || document.querySelector('.sheet, .focus, .board')) return;
    const order = KEY_ORDER.filter((r) => worn.has(r));
    const target = picking ?? (cur && order.includes(cur) ? cur : null);
    const handled = () => e.preventDefault();
    if (isKey(e, 'next') || isKey(e, 'prev')) {
      handled();
      const d = isKey(e, 'next') ? 1 : -1;
      if (target) stepRail(target, d); else stepAll(d);
    } else if (isKey(e, 'railDown') || isKey(e, 'railUp')) {
      handled();
      const i = order.findIndex((r) => r === target);
      const next = order[isKey(e, 'railDown') ? i + 1 : i < 0 ? order.length - 1 : i - 1] ?? null;
      setCur(next);
      if (picking) setPicking(next);
    } else if (isKey(e, 'close')) {
      if (picking) { handled(); setPicking(null); } else if (cur) { handled(); setCur(null); }
    } else if (isKey(e, 'shuffle')) { handled(); shuffle(); }
    else if (isKey(e, 'keep') && target) { handled(); keep(target); }
    else if (isKey(e, 'clear') && target) { handled(); clear([target]); }
    else if (isKey(e, 'pickAll') && target && !(e.target instanceof HTMLButtonElement)) { handled(); setPicking(picking === target ? null : target); }
    else if (isKey(e, 'save')) { handled(); void save(); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!anything) {
    return (
      <div className="mix">
        <div className="empty">
          <Mark className="mark" />
          <p>Outfits are mixed here from the pieces in your closet.</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add a piece</button>
        </div>
        {children}
      </div>
    );
  }

  const missing = RAILS.filter((r) => pools[r.id].length && !worn.has(r.id) && !(r.id === 'bottom' && worn.get('top')?.category === 'dress'));
  const pickRail = picking && pools[picking].length ? RAIL[picking] : null;
  const top = 52 + 10 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);
  // The outfit is framed as if it were a whole outfit, so a single piece is not blown up.
  const all = bounds(pieces.map((p) => p.box));
  const cx = all ? (all.x0 + all.x1) / 2 : BW / 2, cy = all ? (all.y0 + all.y1) / 2 : BH / 2;
  const room = { x0: cx - BW * 0.36, x1: cx + BW * 0.36, y0: cy - BH * 0.42, y1: cy + BH * 0.42 };
  const railsKey = [...worn.keys()].sort().join() + (pickRail ? '|pick' : '');

  return (
    <div className={'mix' + (pickRail ? ' is-picking' : '')}>
      <Canvas
        className="is-look"
        api={api}
        full
        pieces={pieces}
        sel={sel}
        onSel={setSel}
        active={active}
        insets={{ top: top + 64, bottom: pickRail ? 270 : 104, left: 28, right: 28 }}
        maxFitZ={2}
        frameAlso={room}
        fitKey={railsKey}
        onOpen={(pid, rect) => { const r = railOf(pid); const p = pieces.find((x) => x.id === pid); if (r && p) onFocus(p.item.id, rect, pools[r].map((i) => i.id)); }}
        onMove={(ids, dx, dy, keyed) => edit('move', ids, { dx, dy }, keyed ? 'nudge:' + ids.join() : undefined)}
        onResize={(ids, k, keyed) => edit('resize', ids, { k }, keyed ? 'size:' + ids.join() : undefined)}
        onAction={(a, ids) => edit(a, ids)}
        hud={(p, at, s) => {
          const r = railOf(p.id);
          if (!r || s.lifted) return null;
          const kept = work.kept.includes(r);
          const n = pools[r].length;
          const show = s.hover || s.selected || picking === r || (!s.anyHover && !sel.size && cur === r);
          if (!show) return kept ? <span className="hud__kept" style={{ left: at.x + at.w - 10, top: at.y - 6 }}><Lock shut /></span> : null;
          const midY = at.y + at.h / 2;
          return (
            <>
              {n > 1 && <button className="hud__arrow" style={{ left: Math.max(4, at.x - 34), top: midY - 18 }} aria-label={`Previous ${RAIL[r].label}`}
                onClick={() => { setCur(r); stepRail(r, -1); }}><Icon name="left" /></button>}
              {n > 1 && <button className="hud__arrow" style={{ left: Math.min(innerWidth - 40, at.x + at.w - 2), top: midY - 18 }} aria-label={`Next ${RAIL[r].label}`}
                onClick={() => { setCur(r); stepRail(r, 1); }}><Icon name="right" /></button>}
              <span className="hud__bar" style={{ left: at.x + at.w / 2, top: Math.max(at.y - 8, top + 96) }}>
                <button className="hud__btn" aria-label={`All ${RAIL[r].title}`} aria-pressed={picking === r} onClick={() => { setCur(r); setPicking(picking === r ? null : r); }}><Icon name="grid" /></button>
                <button className="hud__btn" aria-label={kept ? `Let go of this ${RAIL[r].label}` : `Keep this ${RAIL[r].label}`} aria-pressed={kept} onClick={() => keep(r)}><Lock shut={kept} /></button>
                <button className="hud__btn" aria-label={`Take off the ${RAIL[r].label}`} onClick={() => clear([r])}><Icon name="x" /></button>
              </span>
            </>
          );
        }}
        onEmpty={() => { setCur(null); setPicking(null); }}
      >
        <div className="mix__layers">
          <button className={'pill' + (work.wish ? ' is-on' : '')} aria-pressed={work.wish}
            onClick={() => set({ ...work, wish: !work.wish }, work.wish ? 'Wishlist hidden' : 'Wishlist shown', { quiet: true })}>wishlist</button>
          {work.kept.length > 0 && <button className="pill" onClick={() => set({ ...work, kept: [] }, 'Let go')}><Lock shut={false} />let go</button>}
          {missing.map((r) => (
            <button key={r.id} className="pill is-add" onClick={() => add(r.id)} aria-label={`Add a ${r.label}`}><Icon name="plus" />{r.label}</button>
          ))}
        </div>
      </Canvas>

      {pickRail && (
        <RailPicker
          title={pickRail.title}
          pool={pools[pickRail.id]}
          current={indexOf(pickRail.id)}
          on={worn.has(pickRail.id)}
          kept={work.kept.includes(pickRail.id)}
          onPick={(i) => go(pickRail.id, i, `Changed the ${pickRail.label}`, 'rail:' + pickRail.id)}
          onKeep={() => keep(pickRail.id)}
          onClear={() => clear([pickRail.id])}
          onClose={() => setPicking(null)}
        />
      )}

      <div className="mix__dock">
        {children}
        <button className="round glass" aria-label="Shuffle" title="Shuffle what is not kept" onClick={shuffle}><Icon name="shuffle" /></button>
        <button className="go" onClick={save} disabled={!pieces.length}>Save this look</button>
        <button className="round glass is-quiet" aria-label="Fit everything" title="Fit everything" onClick={() => api.current?.fit(true)}><Icon name="fit" /></button>
      </div>
    </div>
  );
}

