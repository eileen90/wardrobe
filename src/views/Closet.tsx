import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { drawn, realSize } from '../lib/kind';
import { editPiece } from '../lib/actions';
import { saveSettings, useStore } from '../lib/store';
import { CATEGORIES, catPlural, type Category, type Item } from '../lib/types';
import { Garment, Icon, Mark, Sheet, useViewport } from '../ui';

interface Box { cx: number; cy: number; w: number; h: number; rot: number; z: number }
/** Pieces whose kind is not known yet wait in their own rail, so they do not pose as tops. */
type GroupId = Category | 'sorting';
const unsorted = (i: Item) => i.kindSure === false && i.state !== 'ready';
const groupOf = (i: Item): GroupId => (unsorted(i) ? 'sorting' : i.category);
const groupName = (g: GroupId) => (g === 'sorting' ? 'sorting…' : catPlural(g));
interface Shelf { cat: GroupId; y: number; y1: number; n: number }
interface Layout {
  boxes: Map<string, Box>;
  W: number;
  H: number;
  shelves: Shelf[];
  /** the middle of the floor, which positions are measured from */
  mark: { x: number; y: number } | null;
  cell: number;
  cols: number;
  pad: number;
  gap: number;
  cellH: number;
}

/** Stable pseudo-random numbers from an id: the floor looks the same every visit. */
function seeded(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Where a piece sits in its rail: wherever it was dragged, else newest first. */
const rank = (i: Item) => i.order ?? -i.createdAt;

function gridLayout(items: Item[], vw: number, top: number, keep?: GroupId): Layout {
  const cols = vw < 520 ? 3 : vw < 900 ? 5 : vw < 1300 ? 7 : 9;
  const pad = 20, gap = 6;
  const cell = (vw - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = cell * 1.24;
  const boxes = new Map<string, Box>();
  const shelves: Shelf[] = [];
  let y = top;
  for (const c of [{ id: 'sorting' as GroupId }, ...CATEGORIES]) {
    const group = items.filter((i) => groupOf(i) === c.id);
    // The rail a carried piece came from stays in place while it is in the air, even when
    // that leaves it empty, so nothing shifts under the pointer.
    if (!group.length && c.id !== keep) continue;
    const head = y;
    y += 44;
    // Within a rail pieces keep their relative size, gently: the longest fills its cell and a
    // cropped jacket next to a long coat is visibly shorter without shrinking to a stamp.
    const sizes = group.map((i) => realSize(i));
    const biggest = Math.max(1, ...sizes.map((s) => Math.max(s.w, s.h)));
    group.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const s = sizes[i];
      const fit = Math.min((cell * 0.96) / s.w, (cellH * 0.92) / s.h);
      const k = fit * Math.pow(Math.max(s.w, s.h) / biggest, 0.6);
      boxes.set(item.id, {
        cx: pad + col * (cell + gap) + cell / 2,
        cy: y + row * (cellH + gap) + cellH / 2,
        w: s.w * k, h: s.h * k, rot: 0, z: 1,
      });
    });
    y += Math.max(1, Math.ceil(group.length / cols)) * (cellH + gap);
    shelves.push({ cat: c.id, y: head, y1: y, n: group.length });
    y += 26;
  }
  return { boxes, W: vw, H: y + 120, shelves, mark: null, cell, cols, pad, gap, cellH };
}

function scatterLayout(items: Item[], vw: number, vh: number): Layout {
  const cell = Math.min(vw * 0.6, 300);
  // Pieces lie closer together than their own width: a floor, not a grid.
  const colW = cell * 0.78, rowH = cell * 0.92;
  // One scale for the whole floor, so a long coat really does lie longer than a T-shirt.
  const pxPerCm = cell / 100;
  // Cells ring the middle, nearest first. Sideways counts as further than up/down,
  // so on a tall phone the first pieces land in view above and below the middle.
  const reach = Math.ceil(Math.sqrt(items.length + 1)) + 1;
  const slots: { dx: number; dy: number; d: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx || dy) slots.push({ dx, dy, d: Math.hypot(dx * 1.3, dy) + (dy < 0 ? 0.05 : 0) + (dx < 0 ? 0.02 : 0) });
    }
  }
  slots.sort((p, q) => p.d - q.d);
  // Oldest pieces sit closest in, so adding one never reshuffles the floor.
  const order = [...items].sort((p, q) => p.createdAt - q.createdAt);
  const moved = order.filter((i) => i.spot).sort((p, q) => p.spot!.t - q.spot!.t);
  const boxes = new Map<string, Box>();
  let x0 = -vw / 2, x1 = vw / 2, y0 = -vh * 0.42, y1 = vh * 0.58;
  order.forEach((item, i) => {
    const s = slots[i];
    const { w, h } = drawn(realSize(item), pxPerCm);
    // A piece stays where it was put; one that was never moved gets the next free cell.
    const cx = item.spot ? item.spot.x * cell : s.dx * colW + (seeded(item.id, 3) - 0.5) * colW * 0.2;
    const cy = item.spot ? item.spot.y * cell : s.dy * rowH + (seeded(item.id, 4) - 0.5) * rowH * 0.14;
    boxes.set(item.id, {
      cx, cy, w, h,
      rot: (seeded(item.id, 5) - 0.5) * 26,
      z: item.spot ? 30 + moved.indexOf(item) : Math.round(seeded(item.id, 6) * 20),
    });
    x0 = Math.min(x0, cx - w / 2); x1 = Math.max(x1, cx + w / 2);
    y0 = Math.min(y0, cy - h / 2); y1 = Math.max(y1, cy + h / 2);
  });
  // Room around the outermost pieces, so there is always somewhere to drag one to.
  const mx = Math.max(vw * 0.3, 120), my = Math.max(vh * 0.25, 120);
  const ox = -x0 + mx, oy = -y0 + my;
  for (const b of boxes.values()) { b.cx += ox; b.cy += oy; }
  return { boxes, W: x1 - x0 + mx * 2, H: y1 - y0 + my * 2, shelves: [], mark: { x: ox, y: oy }, cell, cols: 1, pad: 0, gap: 0, cellH: rowH };
}

const place = (b: Box, s = 1) =>
  `translate3d(${(b.cx - b.w / 2).toFixed(1)}px, ${(b.cy - b.h / 2).toFixed(1)}px, 0) rotate(${b.rot.toFixed(2)}deg)` +
  (s === 1 ? '' : ` scale(${s.toFixed(4)})`);

/**
 * Where to scroll the scattered floor when it opens: the middle mark sits a little above centre,
 * nudged so no piece lies half under the top bar or the bottom buttons.
 */
function calmHome(layout: Layout, vw: number, vh: number, topInset: number) {
  const x = Math.max(0, (layout.mark?.x ?? 0) - vw / 2);
  const base = Math.max(0, (layout.mark?.y ?? 0) - vh * 0.42);
  const bottomBand = vh - 96;
  let best = base, bestScore = Infinity;
  for (let d = -400; d <= 400; d += 10) {
    const y = Math.max(0, base + d);
    let score = Math.abs(y - base) * 0.04;
    for (const b of layout.boxes.values()) {
      const t = b.cy - b.h / 2 - y, bt = b.cy + b.h / 2 - y;
      if (bt <= 0 || t >= vh) continue;
      score += 3 * Math.max(0, Math.min(bt, topInset) - Math.max(t, 0));
      score += 3 * Math.max(0, Math.min(bt, vh) - Math.max(t, bottomBand));
      // Pieces that sit fully clear of both bars are worth showing.
      score -= 1.2 * Math.max(0, Math.min(bt, bottomBand) - Math.max(t, topInset));
    }
    if (score < bestScore - 0.5) { bestScore = score; best = y; }
  }
  return { x, y: best };
}

export interface Filters { status: 'all' | 'owned' | 'wish'; cats: Category[] }

/** A piece being carried: where the pointer is, and (lined up) the slot it would drop into. */
interface Carry {
  id: string;
  pid: number;
  /** pointer position when it went down, and the piece centre's offset from it */
  sx: number; sy: number; ox: number; oy: number;
  /** last pointer position on screen */
  px: number; py: number;
  lifted: boolean;
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
  el: HTMLElement;
}

export function Closet({ onOpen, onAdd, hidden }: {
  onOpen: (id: string, from: DOMRect, sequence: string[]) => void;
  onAdd: () => void;
  hidden: boolean;
}) {
  const items = useStore((s) => s.items);
  const mode = useStore((s) => s.settings.closetView);
  const { w: vw, h: vh } = useViewport();
  const [filters, setFilters] = useState<Filters>({ status: 'all', cats: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  /** While a piece is carried over the rails: the slot it would land in. */
  const [target, setTarget] = useState<{ id: string; cat: Category; index: number } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const shown = useMemo(() => {
    const list = items.filter((i) =>
      (filters.status === 'all' || i.status === filters.status) &&
      (!filters.cats.length || filters.cats.includes(i.category)));
    return list.sort((a, b) => rank(a) - rank(b));
  }, [items, filters]);

  /** The same pieces with the carried one moved to where it would land. */
  const arranged = useMemo(() => {
    if (!target) return shown;
    const moving = shown.find((i) => i.id === target.id);
    if (!moving) return shown;
    const rest = shown.filter((i) => i.id !== target.id);
    const group = rest.filter((i) => groupOf(i) === target.cat);
    const before = group[target.index];
    const at = before ? rest.indexOf(before) : group.length ? rest.indexOf(group[group.length - 1]) + 1 : rest.length;
    const out = [...rest];
    out.splice(at, 0, { ...moving, category: target.cat, kindSure: true });
    return out;
  }, [shown, target]);

  const topInset = 52 + 44 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);
  const home = target ? (() => { const m = items.find((i) => i.id === target.id); return m && groupOf(m); })() : undefined;
  const layout = useMemo(
    () => (mode === 'grid' ? gridLayout(arranged, vw, topInset, home) : scatterLayout(arranged, vw, vh)),
    [mode, arranged, vw, vh, topInset, home],
  );
  const live = useRef(layout);
  live.current = layout;

  /** The order pieces are browsed in from the piece view: rail by rail. */
  const sequence = useMemo(
    () => CATEGORIES.flatMap((c) => shown.filter((i) => i.category === c.id).map((i) => i.id)),
    [shown],
  );

  const floor = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const prev = useRef<{ mode: string; boxes: Map<string, Box>; sx: number; sy: number; mark: Layout['mark'] } | null>(null);
  const [morphing, setMorphing] = useState(false);

  // Pieces that have already landed once; anything else drops in.
  const landed = useRef(new Set<string>());
  const firstPaint = useRef(true);

  // Switching between the scattered floor and the tidy rails: every piece glides
  // from where it was on screen to where it now belongs.
  useLayoutEffect(() => {
    const f = floor.current;
    if (!f) return;
    const p = prev.current;
    const home = mode === 'grid'
      ? { x: 0, y: 0 }
      : calmHome(layout, vw, vh, topInset);
    if (!p || p.mode !== mode) {
      f.scrollTo(home.x, home.y);
      if (p && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const dx = home.x - p.sx, dy = home.y - p.sy;
        let i = 0;
        for (const [id, to] of layout.boxes) {
          const from = p.boxes.get(id);
          const el = els.current.get(id);
          if (!from || !el) continue;
          // Only animate what is (or will be) near the screen.
          const near = (b: Box, sx: number, sy: number) =>
            b.cx - sx > -vw && b.cx - sx < vw * 2 && b.cy - sy > -vh && b.cy - sy < vh * 2;
          if (!near(from, p.sx, p.sy) && !near(to, home.x, home.y)) continue;
          const start: Box = { ...from, cx: from.cx + dx, cy: from.cy + dy, w: to.w, h: to.h };
          el.animate(
            [{ transform: place(start, from.w / to.w) }, { transform: place(to) }],
            { duration: 900, delay: Math.min(i++ * 12, 240), easing: 'cubic-bezier(.7,0,.15,1)', fill: 'backwards' },
          );
        }
        setMorphing(true);
        const t = setTimeout(() => setMorphing(false), 1300);
        prev.current = { mode, boxes: layout.boxes, sx: home.x, sy: home.y, mark: layout.mark };
        return () => clearTimeout(t);
      }
    } else if (p.mark && layout.mark && (p.mark.x !== layout.mark.x || p.mark.y !== layout.mark.y)) {
      // The floor grew on its left or top edge: keep everything where it was on screen.
      f.scrollBy(layout.mark.x - p.mark.x, layout.mark.y - p.mark.y);
    }
    prev.current = { mode, boxes: layout.boxes, sx: f.scrollLeft, sy: f.scrollTop, mark: layout.mark };
  }, [mode, layout, vw, vh, topInset]);

  useEffect(() => {
    firstPaint.current = false;
    for (const i of shown) landed.current.add(i.id);
  });

  const onScroll = () => {
    const f = floor.current;
    if (f && prev.current) { prev.current.sx = f.scrollLeft; prev.current.sy = f.scrollTop; }
  };

  /* ----- picking pieces up and putting them down ----- */
  const carry = useRef<Carry | null>(null);
  const justCarried = useRef(false);
  const edge = useRef(0);

  /** Pointer position → position on the floor. */
  const world = (px: number, py: number) => {
    const f = floor.current!;
    const r = f.getBoundingClientRect();
    return { x: px - r.left + f.scrollLeft, y: py - r.top + f.scrollTop };
  };

  const follow = () => {
    const c = carry.current;
    const b = c && live.current.boxes.get(c.id);
    if (!c || !b) return;
    const at = world(c.px, c.py);
    const cx = at.x + c.ox, cy = at.y + c.oy;
    c.el.style.transform = place({ ...b, cx, cy }, 1.06);
    if (mode !== 'grid') return;
    // Which rail, and which place in it, is under the piece.
    const L = live.current;
    const shelf = L.shelves.find((s) => cy >= s.y && cy < s.y1 + 26) ?? (cy < (L.shelves[0]?.y ?? 0) ? L.shelves[0] : L.shelves[L.shelves.length - 1]);
    if (!shelf || shelf.cat === 'sorting') return;
    const cat: Category = shelf.cat;
    const col = Math.min(L.cols - 1, Math.max(0, Math.floor((cx - L.pad + L.gap / 2) / (L.cell + L.gap))));
    const row = Math.max(0, Math.floor((cy - shelf.y - 44) / (L.cellH + L.gap)));
    const others = shelf.n - (target?.cat === shelf.cat || (!target && (() => { const m = items.find((i) => i.id === c.id); return !!m && groupOf(m) === shelf.cat; })()) ? 1 : 0);
    const index = Math.min(others, row * L.cols + col);
    setTarget((t) => (t && t.id === c.id && t.cat === cat && t.index === index ? t : { id: c.id, cat, index }));
  };

  /** Near the edge of the screen the floor keeps scrolling under a carried piece. */
  const autoScroll = () => {
    const c = carry.current, f = floor.current;
    if (!c?.lifted || !f) return;
    const r = f.getBoundingClientRect();
    const zone = 70;
    const push = (d: number) => (d < zone ? -(zone - Math.max(0, d)) / 5 : 0);
    const dx = push(c.px - r.left) - push(r.right - c.px);
    const dy = push(c.py - r.top) - push(r.bottom - c.py);
    if (dx || dy) { f.scrollBy(dx, dy); follow(); }
    edge.current = requestAnimationFrame(autoScroll);
  };

  const lift = () => {
    const c = carry.current;
    if (!c || c.lifted) return;
    c.lifted = true;
    try { c.el.setPointerCapture(c.pid); } catch { /* the pointer is already gone */ }
    if (c.touch) navigator.vibrate?.(8);
    setLifted(c.id);
    follow();
    edge.current = requestAnimationFrame(autoScroll);
  };

  const down = (e: React.PointerEvent<HTMLElement>, item: Item) => {
    if (e.button !== 0 || carry.current) return;
    const b = live.current.boxes.get(item.id);
    if (!b) return;
    const at = world(e.clientX, e.clientY);
    const c: Carry = {
      id: item.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: b.cx - at.x, oy: b.cy - at.y,
      px: e.clientX, py: e.clientY, lifted: false, touch: e.pointerType !== 'mouse', el: e.currentTarget,
    };
    carry.current = c;
    // A finger has to rest on a piece for a moment, so scrolling the floor still works.
    if (c.touch) c.timer = setTimeout(lift, 260);
  };
  const move = (e: React.PointerEvent) => {
    const c = carry.current;
    if (!c || c.pid !== e.pointerId) return;
    c.px = e.clientX; c.py = e.clientY;
    if (c.lifted) return follow();
    const far = Math.hypot(e.clientX - c.sx, e.clientY - c.sy);
    if (c.touch) {
      if (far > 8) { clearTimeout(c.timer); carry.current = null; } // that was a scroll
    } else if (far > 5) lift();
  };
  const drop = (cancelled: boolean) => {
    const c = carry.current;
    if (!c) return;
    clearTimeout(c.timer);
    cancelAnimationFrame(edge.current);
    carry.current = null;
    if (!c.lifted) return;
    justCarried.current = true;
    setTimeout(() => { justCarried.current = false; }, 60);
    const L = live.current;
    const b = L.boxes.get(c.id);
    const item = items.find((i) => i.id === c.id);
    setSettling(true);
    setTimeout(() => setSettling(false), 420);
    setLifted(null);
    if (!cancelled && b && item) {
      if (mode === 'grid' && target) {
        // Its new place: between the neighbours it was dropped between.
        const group = arranged.filter((i) => groupOf(i) === target.cat);
        const at = group.findIndex((i) => i.id === c.id);
        const before = group[at - 1], after = group[at + 1];
        const order = before && after ? (rank(before) + rank(after)) / 2 : before ? rank(before) + 1 : after ? rank(after) - 1 : item.order;
        const moved = target.cat !== item.category || unsorted(item);
        editPiece(c.id, {
          order,
          ...(moved ? { category: target.cat, kindSure: true } : {}),
        }, moved ? { label: `Moved to ${catPlural(target.cat)}`, toast: true } : { label: 'Reordered' });
      } else if (mode !== 'grid' && L.mark) {
        const at = world(c.px, c.py);
        editPiece(c.id, {
          spot: { x: (at.x + c.ox - L.mark.x) / L.cell, y: (at.y + c.oy - L.mark.y) / L.cell, t: Date.now() },
        }, { label: 'Moved' });
      }
    }
    setTarget(null);
    // Let React put the transform back to the piece's (new) place.
    requestAnimationFrame(() => {
      const nb = live.current.boxes.get(c.id);
      if (nb) c.el.style.transform = place(nb);
    });
  };

  // Once a piece is lifted the floor must not scroll under the finger.
  useEffect(() => {
    const f = floor.current;
    if (!f) return;
    const stop = (e: TouchEvent) => { if (carry.current?.lifted) e.preventDefault(); };
    f.addEventListener('touchmove', stop, { passive: false });
    return () => f.removeEventListener('touchmove', stop);
  }, [items.length > 0]);

  // With a mouse, the empty floor can be grabbed and pulled around.
  const pan = useRef<{ pid: number; x: number; y: number } | null>(null);
  const panDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('.piece')) return;
    pan.current = { pid: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const panMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p || p.pid !== e.pointerId) return;
    e.currentTarget.scrollBy(p.x - e.clientX, p.y - e.clientY);
    p.x = e.clientX; p.y = e.clientY;
  };
  const panUp = () => { pan.current = null; };

  const counts = useMemo(() => {
    const c = new Map<Category, number>();
    for (const i of items) c.set(i.category, (c.get(i.category) ?? 0) + 1);
    return c;
  }, [items]);
  const active = (filters.status !== 'all' ? 1 : 0) + filters.cats.length;

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

  return (
    <div className="view" hidden={hidden}>
      <div
        className={`floor is-${mode}` + (morphing ? ' is-morphing' : '') + (lifted || settling ? ' is-sorting' : '')}
        ref={floor} onScroll={onScroll}
        onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}
      >
        <div className="world" style={{ width: layout.W, height: layout.H }}>
          {layout.mark && (
            <div className="wordmark" style={{ transform: `translate(-50%, -50%) translate(${layout.mark.x}px, ${layout.mark.y}px)` }}>
              <Mark />
              {arranged.length < 4 && <p>Everything you own,<br />laid out.</p>}
            </div>
          )}
          {[{ id: 'sorting' as GroupId }, ...CATEGORIES].map((c) => {
            const s = layout.shelves.find((x) => x.cat === c.id);
            if (!s) return null;
            return (
              <div className="shelf" key={c.id} style={{ transform: `translateY(${s.y}px)` }}>
                <h2>{groupName(c.id)}</h2>
                <span className="small muted num">{s.n}</span>
              </div>
            );
          })}
          {shown.map((item, i) => {
            const b = layout.boxes.get(item.id);
            if (!b) return null;
            const isNew = !landed.current.has(item.id);
            const up = lifted === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => { if (el) els.current.set(item.id, el); else els.current.delete(item.id); }}
                className={'piece' + (isNew ? ' is-new' : '') + (up ? ' is-lifted' : '')}
                style={{
                  width: b.w, height: b.h,
                  // While carried, the pointer decides where it is.
                  transform: up && carry.current ? carry.current.el.style.transform : place(b),
                  ['--land' as string]: `${firstPaint.current ? Math.min(i * 40, 600) + 100 : 0}ms`,
                  ['--unrot' as string]: `${-b.rot}deg`,
                  zIndex: up ? 999 : b.z,
                }}
                aria-label={item.name || catPlural(item.category)}
                onPointerDown={(e) => down(e, item)}
                onPointerMove={move}
                onPointerUp={() => drop(false)}
                onPointerCancel={() => drop(true)}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => { if (!justCarried.current) onOpen(item.id, e.currentTarget.getBoundingClientRect(), sequence); }}
              >
                <div className="piece__in">
                  <Garment item={item} small={b.w < 150} />
                  {item.state === 'raw' && <span className="tag">photo</span>}
                  {item.state === 'working' && <span className="tag is-blue">in the studio</span>}
                  {item.state === 'queued' && <span className="tag">waiting</span>}
                  {item.state === 'ready' && item.status === 'wish' && <span className="tag">wishlist</span>}
                </div>
              </button>
            );
          })}
          {!shown.length && (
            <div className="empty" style={{ position: 'fixed' }}>
              <p>Nothing matches these filters.</p>
              <button className="pill" onClick={() => setFilters({ status: 'all', cats: [] })}>Show everything</button>
            </div>
          )}
        </div>
      </div>

      <div className={'dock' + (hidden ? ' is-away' : '')}>
        <button
          className="round glass"
          aria-label={mode === 'grid' ? 'Scatter the pieces' : 'Line the pieces up'}
          onClick={() => void saveSettings({ closetView: mode === 'grid' ? 'scatter' : 'grid' })}
        >
          <Icon name={mode === 'grid' ? 'scatter' : 'grid'} />
        </button>
        <button className="go" onClick={onAdd}><Icon name="plus" />Add</button>
        <button className="round glass" aria-label="Filter" onClick={() => setFilterOpen(true)}>
          <Icon name="filter" />{active > 0 && <span className="dot">{active}</span>}
        </button>
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} label="Filter">
        <div className="sheet__head">
          <h2>Filter</h2>
          {active > 0 && (
            <button className="small link" onClick={() => setFilters({ status: 'all', cats: [] })}>Clear</button>
          )}
        </div>
        <div className="chips">
          {([['all', 'Everything'], ['owned', 'Mine'], ['wish', 'Wishlist']] as const).map(([id, label]) => (
            <button key={id} className="pill" aria-pressed={filters.status === id}
              onClick={() => setFilters({ ...filters, status: id })}>{label}</button>
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
