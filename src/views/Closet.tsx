import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveSettings, useStore } from '../lib/store';
import { CATEGORIES, catPlural, type Category, type Item } from '../lib/types';
import { Garment, Icon, Mark, Sheet, useViewport } from '../ui';

interface Box { cx: number; cy: number; w: number; h: number; rot: number }
interface Layout {
  boxes: Map<string, Box>;
  W: number;
  H: number;
  shelves: { cat: Category; y: number; n: number }[];
  mark: { x: number; y: number } | null;
}

/** Relative size by kind, so a shoe never sprawls as wide as a coat. */
const SIZE: Record<Category, number> = { outer: 1, top: 0.94, dress: 1, bottom: 0.94, shoes: 0.7, bag: 0.64, extra: 0.58 };

/** Stable pseudo-random numbers from an id: the floor looks the same every visit. */
function seeded(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function fit(item: Item, maxW: number, maxH: number) {
  const k = item.state === 'ready' ? SIZE[item.category] : 0.66;
  const a = item.aspect || 1;
  const w = Math.min(maxW * k, maxH * k * a);
  return { w, h: w / a };
}

function gridLayout(items: Item[], vw: number, top: number): Layout {
  const cols = vw < 520 ? 3 : vw < 900 ? 5 : 7;
  const pad = 14, gap = 6;
  const cell = (vw - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = cell * 1.24;
  const boxes = new Map<string, Box>();
  const shelves: Layout['shelves'] = [];
  let y = top;
  for (const c of CATEGORIES) {
    const group = items.filter((i) => i.category === c.id);
    if (!group.length) continue;
    shelves.push({ cat: c.id, y, n: group.length });
    y += 44;
    group.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const { w, h } = fit(item, cell * 0.96, cellH * 0.92);
      boxes.set(item.id, {
        cx: pad + col * (cell + gap) + cell / 2,
        cy: y + row * (cellH + gap) + cellH / 2,
        w, h, rot: 0,
      });
    });
    y += Math.ceil(group.length / cols) * (cellH + gap) + 26;
  }
  return { boxes, W: vw, H: y + 120, shelves, mark: null };
}

function scatterLayout(items: Item[], vw: number, vh: number): Layout {
  const cell = Math.min(vw * 0.6, 300);
  const rowH = cell * 1.12;
  // Cells ring the wordmark, nearest first. Sideways counts as further than up/down,
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
  const used = slots.slice(0, order.length);
  const minX = Math.min(-1, ...used.map((s) => s.dx)), maxX = Math.max(1, ...used.map((s) => s.dx));
  const minY = Math.min(-1, ...used.map((s) => s.dy)), maxY = Math.max(1, ...used.map((s) => s.dy));
  const mx = vw * 0.18, my = vh * 0.16;
  const W = Math.max(vw, (maxX - minX + 1) * cell + mx * 2);
  const H = Math.max(vh, (maxY - minY + 1) * rowH + my * 2);
  const ox = mx + (-minX + 0.5) * cell, oy = my + (-minY + 0.5) * rowH;
  const boxes = new Map<string, Box>();
  order.forEach((item, i) => {
    const s = used[i];
    const k = 0.9 + seeded(item.id, 2) * 0.24;
    const { w, h } = fit(item, cell * 0.98 * k, rowH * 0.94 * k);
    boxes.set(item.id, {
      cx: ox + s.dx * cell + (seeded(item.id, 3) - 0.5) * cell * 0.2,
      cy: oy + s.dy * rowH + (seeded(item.id, 4) - 0.5) * rowH * 0.14,
      w, h,
      rot: (seeded(item.id, 5) - 0.5) * 30,
    });
  });
  return { boxes, W, H, shelves: [], mark: { x: ox, y: oy } };
}

const place = (b: Box, s = 1) =>
  `translate3d(${(b.cx - b.w / 2).toFixed(1)}px, ${(b.cy - b.h / 2).toFixed(1)}px, 0) rotate(${b.rot.toFixed(2)}deg)` +
  (s === 1 ? '' : ` scale(${s.toFixed(4)})`);

export interface Filters { status: 'all' | 'owned' | 'wish'; cats: Category[] }

export function Closet({ onOpen, onAdd, onConnect, hidden }: {
  onOpen: (id: string, from: DOMRect) => void;
  onAdd: () => void;
  onConnect: () => void;
  hidden: boolean;
}) {
  const hasKey = useStore((s) => !!s.settings.key);
  const items = useStore((s) => s.items);
  const mode = useStore((s) => s.settings.closetView);
  const { w: vw, h: vh } = useViewport();
  const [filters, setFilters] = useState<Filters>({ status: 'all', cats: [] });
  const [filterOpen, setFilterOpen] = useState(false);

  const shown = useMemo(
    () => items.filter((i) =>
      (filters.status === 'all' || i.status === filters.status) &&
      (!filters.cats.length || filters.cats.includes(i.category))),
    [items, filters],
  );

  const topInset = 52 + 44 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);
  const layout = useMemo(
    () => (mode === 'grid' ? gridLayout(shown, vw, topInset) : scatterLayout(shown, vw, vh)),
    [mode, shown, vw, vh, topInset],
  );

  const floor = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const prev = useRef<{ mode: string; boxes: Map<string, Box>; sx: number; sy: number } | null>(null);
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
    const target = mode === 'grid'
      ? { x: 0, y: 0 }
      : { x: Math.max(0, (layout.mark?.x ?? 0) - vw / 2), y: Math.max(0, (layout.mark?.y ?? 0) - vh * 0.42) };
    if (!p || p.mode !== mode) {
      f.scrollTo(target.x, target.y);
      if (p && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const dx = target.x - p.sx, dy = target.y - p.sy;
        let i = 0;
        for (const [id, to] of layout.boxes) {
          const from = p.boxes.get(id);
          const el = els.current.get(id);
          if (!from || !el) continue;
          // Only animate what is (or will be) near the screen.
          const near = (b: Box, sx: number, sy: number) =>
            b.cx - sx > -vw && b.cx - sx < vw * 2 && b.cy - sy > -vh && b.cy - sy < vh * 2;
          if (!near(from, p.sx, p.sy) && !near(to, target.x, target.y)) continue;
          const start: Box = { ...from, cx: from.cx + dx, cy: from.cy + dy, w: to.w, h: to.h };
          el.animate(
            [{ transform: place(start, from.w / to.w) }, { transform: place(to) }],
            { duration: 1150, delay: Math.min(i++ * 16, 360), easing: 'cubic-bezier(.7,0,.15,1)', fill: 'backwards' },
          );
        }
        setMorphing(true);
        const t = setTimeout(() => setMorphing(false), 1600);
        prev.current = { mode, boxes: layout.boxes, sx: target.x, sy: target.y };
        return () => clearTimeout(t);
      }
    }
    prev.current = { mode, boxes: layout.boxes, sx: f.scrollLeft, sy: f.scrollTop };
  }, [mode, layout, vw, vh]);

  useEffect(() => {
    firstPaint.current = false;
    for (const i of shown) landed.current.add(i.id);
  });

  const onScroll = () => {
    const f = floor.current;
    if (f && prev.current) { prev.current.sx = f.scrollLeft; prev.current.sy = f.scrollTop; }
  };

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
          <p>Nothing on the floor yet. Photograph a piece and the studio lays it out clean.</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add your first piece</button>
          {!hasKey && <button className="pill is-quiet" onClick={onConnect}>connect the studio first</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="view" hidden={hidden}>
      <div className={`floor is-${mode}` + (morphing ? ' is-morphing' : '')} ref={floor} onScroll={onScroll}>
        <div className="world" style={{ width: layout.W, height: layout.H }}>
          {layout.mark && (
            <div className="wordmark" style={{ transform: `translate(-50%, -50%) translate(${layout.mark.x}px, ${layout.mark.y}px)` }}>
              <Mark />
              <p>Everything you own,<br />laid out.</p>
            </div>
          )}
          {CATEGORIES.map((c) => {
            const s = layout.shelves.find((x) => x.cat === c.id);
            if (!s) return null;
            return (
              <div className="shelf" key={c.id} style={{ transform: `translateY(${s.y}px)` }}>
                <h2>{catPlural(c.id)}</h2>
                <span className="small muted num">{s.n}</span>
              </div>
            );
          })}
          {shown.map((item, i) => {
            const b = layout.boxes.get(item.id);
            if (!b) return null;
            const isNew = !landed.current.has(item.id);
            return (
              <button
                key={item.id}
                ref={(el) => { if (el) els.current.set(item.id, el); else els.current.delete(item.id); }}
                className={'piece' + (isNew ? ' is-new' : '')}
                style={{
                  width: b.w, height: b.h, transform: place(b),
                  ['--land' as string]: `${firstPaint.current ? Math.min(i * 45, 700) + 120 : 0}ms`,
                  ['--unrot' as string]: `${-b.rot}deg`,
                  zIndex: Math.round(seeded(item.id, 6) * 20),
                }}
                aria-label={item.name || catPlural(item.category)}
                onClick={(e) => onOpen(item.id, e.currentTarget.getBoundingClientRect())}
              >
                <div className="piece__in">
                  <Garment item={item} small={b.w < 150} />
                  {item.state === 'raw' && <span className="tag">photo only</span>}
                  {item.state !== 'raw' && item.state !== 'ready' && <span className="tag is-blue">in the studio</span>}
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
        <button className="go" onClick={() => setFilterOpen(true)}>
          <Icon name="filter" />Filter{active > 0 && <span className="badge">{active}</span>}
        </button>
        <button className="round glass" aria-label="Add a piece" onClick={onAdd}><Icon name="plus" /></button>
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} label="Filter">
        <div className="sheet__head">
          <h2>Filter</h2>
          {active > 0 && (
            <button className="small" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
              onClick={() => setFilters({ status: 'all', cats: [] })}>Clear</button>
          )}
        </div>
        <div className="field">
          <span>Show</span>
          <div className="chips">
            {([['all', 'Everything'], ['owned', 'What I own'], ['wish', 'Wishlist']] as const).map(([id, label]) => (
              <button key={id} className="pill" aria-pressed={filters.status === id}
                onClick={() => setFilters({ ...filters, status: id })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Kind</span>
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
        </div>
        <button className="go is-wide" onClick={() => setFilterOpen(false)}>
          Show {shown.length} {shown.length === 1 ? 'piece' : 'pieces'}
        </button>
      </Sheet>
    </div>
  );
}
