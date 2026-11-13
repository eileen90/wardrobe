import { useEffect, useMemo, useRef, useState } from 'react';
import { arrange, removeMany } from '../lib/actions';
import { between } from '../lib/canvas';
import {
  clusterOf, dropTarget, groupName, groupOf, GROUPS, layFloor, orderOnFloor, rank, reflow, unsorted,
  PX, type FloorLayout, type GroupId,
} from '../lib/floor';
import { realSize } from '../lib/kind';
import { isKey, isPointer } from '../lib/shortcuts';
import { saveSettings, updateItem, useStore } from '../lib/store';
import { CATEGORIES, catPlural, type Category, type Item } from '../lib/types';
import { Garment, Icon, Mark, Sheet, useViewport } from '../ui';
import { Canvas, type CanvasAction, type CanvasApi, type CanvasPiece } from './Canvas';
import { SelectionBar } from './Selection';

export interface Filters { status: 'all' | 'owned' | 'wish'; cats: Category[] }

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(t.tagName);
const clampS = (s: number) => Math.min(4, Math.max(0.3, s));

/* ---------- lined up: one rail per kind ---------- */

interface Cell { cx: number; cy: number; w: number; h: number }
interface Shelf { cat: GroupId; y: number; y1: number; n: number }
interface Grid { boxes: Map<string, Cell>; H: number; shelves: Shelf[]; cell: number; cols: number; pad: number; gap: number; cellH: number }

function gridLayout(items: Item[], vw: number, top: number, keep?: GroupId): Grid {
  const cols = vw < 520 ? 3 : vw < 900 ? 5 : vw < 1300 ? 7 : 9;
  const pad = 20, gap = 6;
  const cell = (vw - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = cell * 1.24;
  const boxes = new Map<string, Cell>();
  const shelves: Shelf[] = [];
  let y = top;
  for (const g of GROUPS) {
    const group = items.filter((i) => groupOf(i) === g);
    // The rail a carried piece came from stays while it is in the air, so nothing shifts under the pointer.
    if (!group.length && g !== keep) continue;
    const head = y;
    y += 44;
    // Within a rail pieces keep their relative size, gently.
    const sizes = group.map((i) => realSize(i));
    const biggest = Math.max(1, ...sizes.map((s) => Math.max(s.w, s.h)));
    group.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const s = sizes[i];
      const fit = Math.min((cell * 0.96) / s.w, (cellH * 0.92) / s.h);
      const k = fit * Math.pow(Math.max(s.w, s.h) / biggest, 0.6);
      boxes.set(item.id, { cx: pad + col * (cell + gap) + cell / 2, cy: y + row * (cellH + gap) + cellH / 2, w: s.w * k, h: s.h * k });
    });
    y += Math.max(1, Math.ceil(group.length / cols)) * (cellH + gap);
    shelves.push({ cat: g, y: head, y1: y, n: group.length });
    y += 26;
  }
  return { boxes, H: y + 120, shelves, cell, cols, pad, gap, cellH };
}

const at = (b: Cell, s = 1) =>
  `translate3d(${(b.cx - b.w / 2).toFixed(1)}px, ${(b.cy - b.h / 2).toFixed(1)}px, 0)` + (s === 1 ? '' : ` scale(${s})`);

interface Carry {
  id: string; pid: number; sx: number; sy: number; ox: number; oy: number; px: number; py: number;
  lifted: boolean; touch: boolean; el: HTMLElement;
  timer?: ReturnType<typeof setTimeout>; press?: ReturnType<typeof setTimeout>;
}

function Rails({ shown, items, floor, sel, setSel, order, onOpen, sequence }: {
  shown: Item[]; items: Item[]; floor: FloorLayout; sel: Set<string>; setSel: (s: Set<string>) => void;
  order: string[]; onOpen: (id: string, from: DOMRect, sequence: string[]) => void; sequence: string[];
}) {
  const { w: vw } = useViewport();
  const [target, setTarget] = useState<{ id: string; cat: Category; index: number } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  /** The same pieces with the carried one moved to where it would land. */
  const arranged = useMemo(() => {
    if (!target) return shown;
    const moving = shown.find((i) => i.id === target.id);
    if (!moving) return shown;
    const rest = shown.filter((i) => i.id !== target.id);
    const group = rest.filter((i) => groupOf(i) === target.cat);
    const before = group[target.index];
    const pos = before ? rest.indexOf(before) : group.length ? rest.indexOf(group[group.length - 1]) + 1 : rest.length;
    const out = [...rest];
    out.splice(pos, 0, { ...moving, category: target.cat, kindSure: true });
    return out;
  }, [shown, target]);

  const topInset = 52 + 44 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);
  const home = target ? (() => { const m = items.find((i) => i.id === target.id); return m && groupOf(m); })() : undefined;
  const L = useMemo(() => gridLayout(arranged, vw, topInset, home), [arranged, vw, topInset, home]);
  const live = useRef(L);
  live.current = L;

  const toggle = (id: string) => {
    const n = new Set(sel);
    if (!n.delete(id)) n.add(id);
    anchor.current = id;
    setSel(n);
  };
  const range = (id: string) => {
    const a = anchor.current ? order.indexOf(anchor.current) : -1;
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return toggle(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSel(new Set([...sel, ...order.slice(lo, hi + 1)]));
  };

  const carry = useRef<Carry | null>(null);
  const skip = useRef(false);
  const edge = useRef(0);
  const world = (px: number, py: number) => {
    const f = box.current!, r = f.getBoundingClientRect();
    return { x: px - r.left + f.scrollLeft, y: py - r.top + f.scrollTop };
  };
  const follow = () => {
    const c = carry.current, b = c && live.current.boxes.get(c.id);
    if (!c || !b) return;
    const p = world(c.px, c.py);
    const cx = p.x + c.ox, cy = p.y + c.oy;
    c.el.style.transform = at({ ...b, cx, cy }, 1.04);
    const G = live.current;
    const shelf = G.shelves.find((s) => cy >= s.y && cy < s.y1 + 26) ?? (cy < (G.shelves[0]?.y ?? 0) ? G.shelves[0] : G.shelves[G.shelves.length - 1]);
    if (!shelf || shelf.cat === 'sorting') return;
    const cat: Category = shelf.cat;
    const col = Math.min(G.cols - 1, Math.max(0, Math.floor((cx - G.pad + G.gap / 2) / (G.cell + G.gap))));
    const row = Math.max(0, Math.floor((cy - shelf.y - 44) / (G.cellH + G.gap)));
    const self = items.find((i) => i.id === c.id);
    const inIt = target ? target.cat === shelf.cat : !!self && groupOf(self) === shelf.cat;
    const index = Math.min(shelf.n - (inIt ? 1 : 0), row * G.cols + col);
    setTarget((t) => (t && t.id === c.id && t.cat === cat && t.index === index ? t : { id: c.id, cat, index }));
  };
  const autoScroll = () => {
    const c = carry.current, f = box.current;
    if (!c?.lifted || !f) return;
    const r = f.getBoundingClientRect();
    const zone = 70;
    const push = (d: number) => (d < zone ? -(zone - Math.max(0, d)) / 5 : 0);
    const dy = push(c.py - r.top) - push(r.bottom - c.py);
    if (dy) { f.scrollBy(0, dy); follow(); }
    edge.current = requestAnimationFrame(autoScroll);
  };
  const lift = () => {
    const c = carry.current;
    if (!c || c.lifted) return;
    c.lifted = true;
    try { c.el.setPointerCapture(c.pid); } catch { /* gone */ }
    if (c.touch) navigator.vibrate?.(8);
    setLifted(c.id);
    follow();
    edge.current = requestAnimationFrame(autoScroll);
  };
  const longPress = () => {
    const c = carry.current;
    if (!c || Math.hypot(c.px - c.sx, c.py - c.sy) > 8) return;
    if (c.lifted) drop(true); else { clearTimeout(c.timer); carry.current = null; }
    skip.current = true;
    navigator.vibrate?.(12);
    toggle(c.id);
  };
  const down = (e: React.PointerEvent<HTMLElement>, item: Item) => {
    if (e.button !== 0 || carry.current) return;
    skip.current = false;
    if (isPointer(e, 'select')) { skip.current = true; return toggle(item.id); }
    if (isPointer(e, 'selectRange')) { skip.current = true; return range(item.id); }
    // Nothing else is dragged with a modifier held (resizing has no meaning in the rails).
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) { skip.current = true; return; }
    const b = live.current.boxes.get(item.id);
    if (!b) return;
    const p = world(e.clientX, e.clientY);
    const c: Carry = {
      id: item.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: b.cx - p.x, oy: b.cy - p.y,
      px: e.clientX, py: e.clientY, lifted: false, touch: e.pointerType !== 'mouse', el: e.currentTarget,
    };
    carry.current = c;
    if (c.touch) { c.timer = setTimeout(lift, 240); c.press = setTimeout(longPress, 480); }
  };
  const move = (e: React.PointerEvent) => {
    const c = carry.current;
    if (!c || c.pid !== e.pointerId) return;
    c.px = e.clientX; c.py = e.clientY;
    if (c.lifted) return follow();
    const far = Math.hypot(e.clientX - c.sx, e.clientY - c.sy);
    if (c.touch) { if (far > 8) { clearTimeout(c.timer); clearTimeout(c.press); carry.current = null; } }
    else if (far > 4) lift();
  };
  const drop = (cancelled: boolean) => {
    const c = carry.current;
    if (!c) return;
    clearTimeout(c.timer); clearTimeout(c.press);
    cancelAnimationFrame(edge.current);
    carry.current = null;
    if (!c.lifted) return;
    skip.current = true;
    setTimeout(() => { skip.current = false; }, 60);
    const item = items.find((i) => i.id === c.id);
    setSettling(true);
    setTimeout(() => setSettling(false), 420);
    setLifted(null);
    if (!cancelled && item && target) {
      // Its new place in the rail: between the neighbours it was dropped between.
      const group = arranged.filter((i) => groupOf(i) === target.cat);
      const pos = group.findIndex((i) => i.id === c.id);
      const order = between(group[pos - 1] && rank(group[pos - 1]), group[pos + 1] && rank(group[pos + 1]), item.order);
      const moved = target.cat !== item.category || unsorted(item);
      const next: Item = { ...item, order, category: target.cat, kindSure: true };
      // The floor follows: the cluster it now belongs to is laid out again in rail order.
      const cluster = clusterOf(next);
      const mates = [...items.filter((i) => i.id !== item.id && clusterOf(i) === cluster), next]
        .sort((p, q) => GROUPS.indexOf(groupOf(p)) - GROUPS.indexOf(groupOf(q)) || rank(p) - rank(q));
      const places = reflow(floor, items, cluster, mates);
      const patches: [string, Partial<Item>][] = [[item.id, {
        order, pos: places.get(item.id),
        ...(moved ? { category: target.cat, kindSure: true, kindByHand: true } : {}),
      }]];
      for (const [id, pos] of places) if (id !== item.id) patches.push([id, { pos }]);
      if (moved || order !== item.order) arrange(patches, moved ? `Moved to ${catPlural(target.cat)}` : 'Reordered');
    }
    setTarget(null);
    requestAnimationFrame(() => {
      const nb = live.current.boxes.get(c.id);
      if (nb) c.el.style.transform = at(nb);
    });
  };

  useEffect(() => {
    const f = box.current;
    if (!f) return;
    const stop = (e: TouchEvent) => { if (carry.current?.lifted) e.preventDefault(); };
    f.addEventListener('touchmove', stop, { passive: false });
    return () => f.removeEventListener('touchmove', stop);
  }, []);

  const dropShelf = target && L.shelves.find((s) => s.cat === target.cat);
  return (
    <div className={'floor is-grid' + (lifted || settling ? ' is-sorting' : '') + (sel.size ? ' is-selecting' : '')} ref={box}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('.piece') && sel.size) setSel(new Set()); }}>
      <div className="world" style={{ position: 'relative', height: L.H }}>
        {dropShelf && target && home !== target.cat && (
          <div className="drop" style={{ transform: `translate(${L.pad - 8}px, ${dropShelf.y - 8}px)`, width: vw - L.pad * 2 + 16, height: dropShelf.y1 - dropShelf.y + 16 }} />
        )}
        {L.shelves.map((s) => (
          <div className={'shelf' + (target?.cat === s.cat && home !== s.cat ? ' is-target' : '')} key={s.cat} style={{ transform: `translateY(${s.y}px)` }}>
            <h2>{groupName(s.cat)}</h2>
            <span className="small muted num">{s.n}</span>
          </div>
        ))}
        {shown.map((item) => {
          const b = L.boxes.get(item.id);
          if (!b) return null;
          const up = lifted === item.id;
          return (
            <div
              key={item.id}
              role="button"
              className={'piece' + (up ? ' is-lifted' : '') + (sel.has(item.id) ? ' is-selected' : '')}
              aria-label={item.name || catPlural(item.category)}
              aria-pressed={sel.size ? sel.has(item.id) : undefined}
              style={{ width: b.w, height: b.h, transform: up && carry.current ? carry.current.el.style.transform : at(b), zIndex: up ? 999 : 1 }}
              onPointerDown={(e) => down(e, item)}
              onPointerMove={move}
              onPointerUp={() => drop(false)}
              onPointerCancel={() => drop(true)}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => {
                if (skip.current) { skip.current = false; return; }
                if (sel.size && carryTouch.current) return toggle(item.id);
                onOpen(item.id, e.currentTarget.getBoundingClientRect(), sequence);
              }}
              onPointerDownCapture={(e) => { carryTouch.current = e.pointerType !== 'mouse'; }}
            >
              <div className="piece__in">
                <div className="piece__pic"><Garment item={item} small={b.w < 150} /></div>
                <Tags item={item} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
const carryTouch = { current: false };

function Tags({ item }: { item: Item }) {
  if (item.state === 'raw') return <span className="tag">photo</span>;
  if (item.state === 'working') return <span className="tag is-blue">in the studio</span>;
  if (item.state === 'queued') return <span className="tag">waiting</span>;
  if (item.status === 'wish') return <span className="tag">wishlist</span>;
  return null;
}

/* ---------- the closet ---------- */

export function Closet({ onOpen, onAdd, hidden, active }: {
  onOpen: (id: string, from: DOMRect, sequence: string[]) => void;
  onAdd: () => void;
  hidden: boolean;
  /** false while something on top has the keyboard */
  active: boolean;
}) {
  const items = useStore((s) => s.items);
  const mode = useStore((s) => s.settings.closetView);
  const { w: vw } = useViewport();
  const [filters, setFilters] = useState<Filters>({ status: 'all', cats: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [drop, setDrop] = useState<{ cluster: string; ids: string[] } | null>(null);
  const api = useRef<CanvasApi | null>(null);

  /** One arrangement for both views. */
  const floor = useMemo(() => layFloor(items), [items]);
  // Pieces given a place just now keep it from here on.
  useEffect(() => {
    for (const [id, f] of floor.fresh) void updateItem(id, f);
  }, [floor]);

  const shown = useMemo(() => items
    .filter((i) => (filters.status === 'all' || i.status === filters.status) && (!filters.cats.length || filters.cats.includes(i.category)))
    .sort((a, b) => rank(a) - rank(b)), [items, filters]);
  /** Reading order, rail by rail: for ranges and for browsing from a piece's page. */
  const order = useMemo(() => GROUPS.flatMap((g) => shown.filter((i) => groupOf(i) === g).map((i) => i.id)), [shown]);

  useEffect(() => {
    setSel((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(shown.map((i) => i.id));
      const keep = [...prev].filter((x) => ids.has(x));
      return keep.length === prev.size ? prev : new Set(keep);
    });
  }, [shown]);
  useEffect(() => { if (hidden) setSel(new Set()); }, [hidden]);

  // The rails have no canvas of their own to listen for these.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (hidden || !active || mode !== 'grid' || e.defaultPrevented || typing(e.target) || document.querySelector('.focus, .sheet, .board')) return;
    if (isKey(e, 'selectAll')) { e.preventDefault(); setSel(new Set(shown.map((i) => i.id))); }
    else if (sel.size && isKey(e, 'close') && !document.querySelector('.selbar__panel')) { e.preventDefault(); setSel(new Set()); }
    else if (sel.size && isKey(e, 'remove')) { e.preventDefault(); removeMany([...sel]); setSel(new Set()); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  /* ----- the floor ----- */
  const pieces: CanvasPiece[] = useMemo(() => shown.flatMap((i) => {
    const b = floor.boxes.get(i.id);
    return b ? [{ id: i.id, item: i, box: b, flip: i.pos?.f }] : [];
  }), [shown, floor]);

  const moved = (ids: string[], dx: number, dy: number, keyed: boolean) => {
    const patches: [string, Partial<Item>][] = [];
    let to: Category | null = null;
    for (const id of ids) {
      const it = items.find((i) => i.id === id), b = floor.boxes.get(id);
      if (!it || !b) continue;
      const x = b.cx + dx, y = b.cy + dy;
      // Put down among another kind, it becomes that kind, as it does between rails.
      const t = keyed ? null : dropTarget(floor, items, x, y, ids);
      const cat = t?.cat && t.cluster !== clusterOf(it) ? t.cat : null;
      const kind = cat ?? it.category;
      const patch: Partial<Item> = {
        pos: { ...(it.pos ?? { c: clusterOf(it) }), x: x / PX, y: y / PX, c: cat ? t!.cluster : (it.pos?.c ?? clusterOf(it)) },
        order: orderOnFloor(floor, items, id, kind, x, y),
      };
      if (cat) { Object.assign(patch, { category: cat, kindSure: true, kindByHand: true }); to = cat; }
      patches.push([id, patch]);
    }
    arrange(patches, to ? `Moved to ${catPlural(to)}` : 'Moved', keyed ? { key: 'nudge:' + ids.join() } : {});
  };
  const resized = (ids: string[], k: number, keyed: boolean) => {
    arrange(ids.flatMap((id) => {
      const it = items.find((i) => i.id === id);
      return it?.pos ? [[id, { pos: { ...it.pos, s: clampS((it.pos.s ?? 1) * k) } }] as [string, Partial<Item>]] : [];
    }), 'Resized', keyed ? { key: 'size:' + ids.join() } : {});
  };
  const acted = (a: CanvasAction, ids: string[]) => {
    if (a === 'remove') { removeMany(ids); setSel(new Set()); return; }
    const zs = [...floor.boxes.values()].map((b) => b.z);
    const top = Math.max(...zs), bottom = Math.min(...zs);
    const patch = (it: Item, k: number): Partial<Item> | null => {
      if (!it.pos) return null;
      if (a === 'forward') return { pos: { ...it.pos, z: top + 1 + k } };
      if (a === 'backward') return { pos: { ...it.pos, z: bottom - ids.length + k } };
      if (a === 'flip') return { pos: { ...it.pos, f: !it.pos.f } };
      return null;
    };
    const patches = ids.flatMap((id, k) => { const it = items.find((i) => i.id === id); const p = it && patch(it, k); return p ? [[id, p] as [string, Partial<Item>]] : []; });
    arrange(patches, a === 'forward' ? 'Brought forward' : a === 'backward' ? 'Sent back' : 'Flipped');
  };
  const dragging = (ids: string[], dx: number, dy: number) => {
    if (!ids.length) return setDrop(null);
    const id = ids[0];
    const it = items.find((i) => i.id === id), b = floor.boxes.get(id);
    const t = it && b ? dropTarget(floor, items, b.cx + dx, b.cy + dy, ids) : null;
    const next = t?.cat && it && t.cluster !== clusterOf(it) ? t.cluster : null;
    setDrop((d) => (d?.cluster === next ? d : next ? { cluster: next, ids } : null));
  };

  /** Lay every cluster out afresh; one undo puts everything back where it was. */
  const tidy = () => {
    arrange(items.map((i) => [i.id, { pos: i.pos ? { ...i.pos, c: '' } : undefined }]), 'Tidied up');
    setTimeout(() => api.current?.fit(true), 120);
  };

  const counts = useMemo(() => {
    const c = new Map<Category, number>();
    for (const i of items) c.set(i.category, (c.get(i.category) ?? 0) + 1);
    return c;
  }, [items]);
  const nActive = (filters.status !== 'all' ? 1 : 0) + filters.cats.length;
  const top = 52 + 10 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);

  if (!items.length) {
    return (
      <div className="view" hidden={hidden}>
        <div className="empty">
          <Mark className="mark" />
          <p>{matchMedia('(pointer: coarse)').matches
            ? 'Your closet starts with one picture. Take a photo of a piece, or choose one you already have.'
            : 'Your closet starts with one picture. Drop it here, paste it, or choose a file.'}</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add a piece</button>
        </div>
      </div>
    );
  }

  const target = drop && floor.clusters.find((c) => c.id === drop.cluster);
  return (
    <div className="view" hidden={hidden}>
      <div className="closet__view" key={mode}>
        {mode === 'grid' ? (
          <Rails shown={shown} items={items} floor={floor} sel={sel} setSel={setSel} order={order} onOpen={onOpen} sequence={order} />
        ) : (
          <Canvas
            className="is-floor"
            api={api}
            pieces={pieces}
            sel={sel}
            onSel={setSel}
            order={order}
            active={active && !hidden && !filterOpen}
            insets={{ top: top + 40, bottom: 96, left: 24, right: 24 }}
            maxFitZ={1}
            minFitZ={vw < 600 ? 0.3 : 0.28}
            fitKey={hidden}
            onOpen={(id, rect) => onOpen(id, rect, order)}
            onMove={moved}
            onDrag={dragging}
            onResize={resized}
            onAction={acted}
            decorate={(p) => <Tags item={p.item} />}
            under={<>
              {target && (
                <div className="drop" style={{
                  transform: `translate(${target.rect.x0 - 28}px, ${target.rect.y0 - 24}px)`,
                  width: target.rect.x1 - target.rect.x0 + 56, height: target.rect.y1 - target.rect.y0 + 52,
                }} />
              )}
              {floor.clusters.map((c) => (
                <div key={c.id} className={'clabel' + (target?.id === c.id ? ' is-target' : '')}
                  style={{ transform: `translate(${c.rect.x0}px, ${c.rect.y0 - 40}px) translate(0, -100%)` }}>
                  {c.name} · {c.n}
                </div>
              ))}
            </>}
          />
        )}
        {!shown.length && (
          <div className="empty" style={{ position: 'fixed' }}>
            <p>Nothing matches these filters.</p>
            <button className="pill" onClick={() => setFilters({ status: 'all', cats: [] })}>Show everything</button>
          </div>
        )}
      </div>

      {sel.size > 0 && <SelectionBar ids={[...sel]} total={shown.length} onAll={() => setSel(new Set(shown.map((i) => i.id)))} onClear={() => setSel(new Set())} />}

      <div className={'dock' + (hidden || sel.size ? ' is-away' : '')}>
        <button className="round glass" aria-label={mode === 'grid' ? 'Scatter the pieces' : 'Line the pieces up'}
          onClick={() => void saveSettings({ closetView: mode === 'grid' ? 'scatter' : 'grid' })}>
          <Icon name={mode === 'grid' ? 'scatter' : 'grid'} />
        </button>
        {mode !== 'grid' && (
          <button className="round glass is-quiet" aria-label="Tidy up" title="Tidy up" onClick={tidy}><Icon name="tidy" /></button>
        )}
        <button className="go" onClick={onAdd}><Icon name="plus" />Add</button>
        {mode !== 'grid' && (
          <button className="round glass is-quiet" aria-label="Fit everything" title="Fit everything" onClick={() => api.current?.fit(true)}><Icon name="fit" /></button>
        )}
        <button className="round glass" aria-label="Filter" onClick={() => setFilterOpen(true)}>
          <Icon name="filter" />{nActive > 0 && <span className="dot">{nActive}</span>}
        </button>
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} label="Filter">
        <div className="sheet__head">
          <h2>Filter</h2>
          {nActive > 0 && <button className="small link" onClick={() => setFilters({ status: 'all', cats: [] })}>Clear</button>}
        </div>
        <div className="chips">
          {([['all', 'Everything'], ['owned', 'Mine'], ['wish', 'Wishlist']] as const).map(([id, label]) => (
            <button key={id} className="pill" aria-pressed={filters.status === id} onClick={() => setFilters({ ...filters, status: id })}>{label}</button>
          ))}
        </div>
        <div className="chips">
          {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => {
            const on = filters.cats.includes(c.id);
            return (
              <button key={c.id} className="pill" aria-pressed={on}
                onClick={() => setFilters({ ...filters, cats: on ? filters.cats.filter((x) => x !== c.id) : [...filters.cats, c.id] })}>
                {c.plural}<span className="num" style={{ opacity: 0.55 }}>{counts.get(c.id)}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
