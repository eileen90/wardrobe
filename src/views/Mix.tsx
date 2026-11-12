import { useEffect, useMemo, useRef, useState } from 'react';
import { saveLook, useStore } from '../lib/store';
import { BOARD_RATIO, uid, type Category, type Item, type Look, type Placed } from '../lib/types';
import { Garment, Icon, Mark, toast } from '../ui';

/** The rails you can swipe, top to bottom. Tops and dresses share one rail. */
const RAILS = [
  { id: 'outer', label: 'jacket', cats: ['outer'] as Category[], weight: 1, width: 78 },
  { id: 'top', label: 'top', cats: ['top', 'dress'] as Category[], weight: 1, width: 78 },
  { id: 'bottom', label: 'bottom', cats: ['bottom'] as Category[], weight: 1.12, width: 78 },
  { id: 'shoes', label: 'shoes', cats: ['shoes'] as Category[], weight: 0.46, width: 52 },
  { id: 'bag', label: 'bag', cats: ['bag', 'extra'] as Category[], weight: 0.46, width: 44 },
] as const;
type RailId = (typeof RAILS)[number]['id'];

interface Moving { key: number; item: Item; role: 'in' | 'out'; sgn: number; from: number; delay: number }

/** One rail: the current piece plus whatever is still sliding in or out. */
function Rail({ pool, index, top, height, width, label, onStep, registerSlide }: {
  pool: Item[];
  index: number;
  top: number;
  height: number;
  width: number;
  label: string;
  onStep: (delta: number, from: number) => void;
  registerSlide: (fn: (to: Item, exitSign: number, from: number, delay: number) => void) => void;
}) {
  const current = pool[index];
  const [layers, setLayers] = useState<Moving[]>(() => (current ? [{ key: 0, item: current, role: 'in', sgn: 0, from: 0, delay: 0 }] : []));
  const n = useRef(1);
  const els = useRef(new Map<number, HTMLDivElement>());

  // Called by the parent whenever this rail should show a different piece.
  registerSlide((to, exitSign, from, delay) => {
    setLayers((old) => [
      ...old.filter((l) => l.role === 'out'),
      ...old.filter((l) => l.role === 'in').map((l) => ({ ...l, role: 'out' as const, sgn: exitSign, from, delay })),
      { key: n.current++, item: to, role: 'in', sgn: -exitSign, from: 0, delay },
    ]);
  });

  // If the pool changes under us (filter toggled, piece removed), just show the right piece.
  const shownId = layers.find((l) => l.role === 'in')?.item.id;
  useEffect(() => {
    if (current?.id !== shownId) {
      setLayers(current ? [{ key: n.current++, item: current, role: 'in', sgn: 0, from: 0, delay: 0 }] : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const animate = (el: HTMLDivElement | null, l: Moving) => {
    if (!el) return void els.current.delete(l.key);
    if (els.current.get(l.key) === el && el.dataset.role === l.role) return;
    els.current.set(l.key, el);
    el.dataset.role = l.role;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (l.role === 'out') setLayers((old) => old.filter((x) => x.key !== l.key));
      return;
    }
    if (l.role === 'out') {
      el.style.pointerEvents = 'none';
      el.animate(
        [
          { transform: `translateX(${l.from}%) rotate(${(l.from / 100) * 8}deg)` },
          { transform: `translateX(${l.sgn * 150}%) rotate(${l.sgn * 9}deg)` },
        ],
        { duration: 520, delay: l.delay, easing: 'cubic-bezier(.55,0,.75,.35)', fill: 'both' },
      ).onfinish = () => setLayers((old) => old.filter((x) => x.key !== l.key));
    } else if (l.sgn) {
      // Wait off-stage while the old piece leaves, then land with a small wobble.
      el.animate(
        [
          { transform: `translateX(${l.sgn * 150}%) rotate(${l.sgn * 10}deg)`, offset: 0 },
          { transform: `translateX(${l.sgn * 150}%) rotate(${l.sgn * 10}deg)`, offset: 0.42 },
          { transform: `translateX(${-l.sgn * 3}%) rotate(${-l.sgn * 3.5}deg)`, offset: 0.78 },
          { transform: `translateX(${l.sgn * 0.8}%) rotate(${l.sgn * 1.4}deg)`, offset: 0.9 },
          { transform: 'none', offset: 1 },
        ],
        { duration: 1250, delay: l.delay, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'backwards' },
      );
    }
  };

  // Drag a piece sideways to swipe it; a tap moves on to the next one.
  const drag = useRef<{ id: number; x: number; w: number; dx: number } | null>(null);
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pool.length < 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.getAnimations().forEach((a) => a.cancel());
    drag.current = { id: e.pointerId, x: e.clientX, w: e.currentTarget.offsetWidth, dx: 0 };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x;
    const p = d.dx / d.w;
    e.currentTarget.style.transform = `translateX(${p * 100}%) rotate(${p * 8}deg)`;
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    const p = d.dx / d.w;
    if (Math.abs(d.dx) < 5) {
      el.style.transform = '';
      onStep(1, 0);
    } else if (Math.abs(p) > 0.14) {
      // The piece carries on from where it was let go.
      el.style.transform = '';
      onStep(p < 0 ? 1 : -1, p * 100);
    } else {
      const fromT = el.style.transform;
      el.style.transform = '';
      el.animate([{ transform: fromT }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    }
  };
  return (
    <div className="row" style={{ top, height }}>
      {!pool.length && <div className="row__none">No {label === 'shoes' ? 'shoes' : label + 's'} in the closet yet</div>}
      {layers.map((l) => (
        <div
          key={l.key}
          className="row__g"
          ref={(el) => animate(el, l)}
          onPointerDown={l.role === 'in' ? down : undefined}
          onPointerMove={l.role === 'in' ? move : undefined}
          onPointerUp={l.role === 'in' ? up : undefined}
          onPointerCancel={l.role === 'in' ? up : undefined}
          style={{ touchAction: 'pan-y', width: `${width}%`, marginLeft: `${-width / 2}%` }}
        >
          <Garment item={l.item} size="full" />
          {l.item.status === 'wish' && <span className="tag">wishlist</span>}
        </div>
      ))}
      {pool.length > 1 && (
        <span className="row__count">{String(index + 1).padStart(2, '0')} / {String(pool.length).padStart(2, '0')}</span>
      )}
    </div>
  );
}

/** Where each rail's piece lands when a mix is saved as a look. */
function arrange(picks: Partial<Record<RailId, Item>>): Placed[] {
  const out: Placed[] = [];
  const put = (item: Item | undefined, cx: number, cy: number, maxW: number, maxH: number) => {
    if (!item) return;
    // Height as a fraction of the board is w / aspect * BOARD_RATIO.
    const w = Math.min(maxW, (maxH * item.aspect) / BOARD_RATIO);
    out.push({ id: uid(), itemId: item.id, x: cx, y: cy, w, rot: 0, flip: false });
  };
  const dress = picks.top?.category === 'dress';
  const hasOuter = !!picks.outer;
  if (dress) {
    put(picks.top, hasOuter ? 0.6 : 0.5, 0.44, 0.52, 0.66);
  } else {
    put(picks.bottom, hasOuter ? 0.56 : 0.5, 0.66, 0.46, 0.5);
    put(picks.top, hasOuter ? 0.62 : 0.5, 0.27, 0.54, 0.42);
  }
  put(picks.outer, 0.3, 0.3, 0.5, 0.46);
  put(picks.shoes, 0.76, 0.88, 0.3, 0.16);
  put(picks.bag, 0.19, 0.74, 0.26, 0.24);
  return out;
}

export function Mix({ startWith, onSaved, onAdd }: {
  startWith: string | null;
  onSaved: (lookId: string) => void;
  onAdd: () => void;
}) {
  const items = useStore((s) => s.items);
  const nLooks = useStore((s) => s.looks.length);
  const [withWish, setWithWish] = useState(true);
  const [on, setOn] = useState<RailId[]>(['top', 'bottom', 'shoes']);
  const [idx, setIdx] = useState<Record<RailId, number>>({ outer: 0, top: 0, bottom: 0, shoes: 0, bag: 0 });
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const slides = useRef(new Map<RailId, (to: Item, exitSign: number, from: number, delay: number) => void>());
  const lastAll = useRef(0);

  const pools = useMemo(() => {
    const ready = items.filter((i) => i.state === 'ready' && (withWish || i.status === 'owned'));
    return Object.fromEntries(RAILS.map((r) => [r.id, ready.filter((i) => r.cats.includes(i.category))])) as Record<RailId, Item[]>;
  }, [items, withWish]);

  // Opened from a piece: put that piece on its rail.
  useEffect(() => {
    if (!startWith) return;
    const it = items.find((i) => i.id === startWith);
    const rail = it && RAILS.find((r) => r.cats.includes(it.category));
    if (!it || !rail) return;
    if (it.status === 'wish') setWithWish(true);
    setOn((o) => (o.includes(rail.id) ? o : [...o, rail.id]));
    setIdx((x) => ({ ...x, [rail.id]: Math.max(0, pools[rail.id].findIndex((p) => p.id === it.id)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clamp = (r: RailId) => Math.min(idx[r], Math.max(0, pools[r].length - 1));
  const dressOn = pools.top[clamp('top')]?.category === 'dress' && on.includes('top');
  const visible = RAILS.filter((r) => on.includes(r.id) && !(r.id === 'bottom' && dressOn));
  const total = visible.reduce((t, r) => t + r.weight * (r.id === 'top' && dressOn ? 2 : 1), 0) || 1;

  const go = (r: RailId, to: number, exitSign: number, from = 0, delay = 0) => {
    const pool = pools[r];
    if (pool.length < 2) return;
    const next = ((to % pool.length) + pool.length) % pool.length;
    if (next === clamp(r)) return;
    slides.current.get(r)?.(pool[next], exitSign, from, delay);
    setIdx((x) => ({ ...x, [r]: next }));
  };
  const step = (r: RailId, delta: number, from: number) => {
    // The old piece leaves the way it was pushed; a tap sends it left.
    go(r, clamp(r) + delta, from ? Math.sign(from) : -1, from);
  };
  /** Every rail changes at once; neighbours leave in opposite directions so they cross. */
  const all = (pick: (r: RailId, n: number, cur: number) => number, dir: number) => {
    const now = Date.now();
    if (now - lastAll.current < 700) return;
    lastAll.current = now;
    visible.forEach((r, i) => {
      const n = pools[r.id].length;
      if (n > 1) go(r.id, pick(r.id, n, clamp(r.id)), (i % 2 ? 1 : -1) * dir, 0, i * 110);
    });
  };
  const shuffle = () => all((_r, n, cur) => {
    let k = cur;
    while (k === cur) k = Math.floor(Math.random() * n);
    return k;
  }, 1);

  const save = async () => {
    const picks: Partial<Record<RailId, Item>> = {};
    for (const r of visible) picks[r.id] = pools[r.id][clamp(r.id)];
    const pieces = arrange(picks);
    if (!pieces.length) return;
    const look: Look = {
      id: uid(), name: `Look ${String(nLooks + 1).padStart(2, '0')}`, createdAt: Date.now(), updatedAt: Date.now(),
      paper: '#ECECEC', pieces,
    };
    await saveLook(look);
    toast('Saved to looks');
    onSaved(look.id);
  };

  const anything = RAILS.some((r) => pools[r.id].length);
  if (!anything) {
    return (
      <div className="view">
        <div className="empty">
          <Mark className="mark" />
          <p>Mix swipes through your tops, bottoms and shoes to find what goes together. It needs a few cleaned pieces first.</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add a piece</button>
        </div>
      </div>
    );
  }

  let y = 0;
  return (
    <div className="mix">
      <div className="mix__layers" role="group" aria-label="Rails">
        {RAILS.map((r) => (
          <button key={r.id} className={'pill' + (on.includes(r.id) ? ' is-on' : '')} aria-pressed={on.includes(r.id)}
            onClick={() => setOn((o) => (o.includes(r.id) ? o.filter((x) => x !== r.id) : [...o, r.id]))}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="mix__rows" ref={box}>
        {h > 0 && visible.map((r) => {
          const share = (r.weight * (r.id === 'top' && dressOn ? 2 : 1)) / total;
          const top = y;
          y += share * h;
          // Rails overlap a little, the way clothes do on a body.
          const over = h * 0.035;
          return (
            <Rail
              key={r.id}
              label={r.label}
              width={r.width}
              pool={pools[r.id]}
              index={clamp(r.id)}
              top={top - over}
              height={share * h + over * 2}
              onStep={(d, from) => step(r.id, d, from)}
              registerSlide={(fn) => slides.current.set(r.id, fn)}
            />
          );
        })}
        {visible.length > 0 && (
          <>
            <button className="arrow is-prev" aria-label="Previous outfit" onClick={() => all((_r, _n, c) => c - 1, -1)}>
              <Icon name="prev" box="0 0 24 34" />
            </button>
            <button className="arrow is-next" aria-label="Next outfit" onClick={() => all((_r, _n, c) => c + 1, 1)}>
              <Icon name="next" box="0 0 24 34" />
            </button>
          </>
        )}
        {!visible.length && <div className="row__none">Turn a rail on above</div>}
      </div>

      <div className="dock">
        <button className="round glass" aria-label="Shuffle" onClick={shuffle}><Icon name="shuffle" /></button>
        <button className="go" onClick={save} disabled={!visible.some((r) => pools[r.id].length)}>Save this look</button>
        <button className={'pill' + (withWish ? ' is-on' : '')} aria-pressed={withWish} onClick={() => setWithWish(!withWish)}
          style={{ minHeight: 52, borderRadius: 16 }}>
          wishlist
        </button>
      </div>
    </div>
  );
}
