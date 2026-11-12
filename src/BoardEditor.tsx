import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as db from './db';
import { DOT_STEP, FONT, GRID_STEP, LINE, saveBoardThumb, shareBoard } from './exportBoard';
import { alphaMask, peekMask } from './images';
import {
  createBoard, getBoard, getItem, imgKey, itemAspect, removeBoard, showsCut, updateBoard,
  useBlobUrl, useStore,
} from './store';
import {
  BACKDROPS, BOARD_H, BOARD_W, CATEGORIES, backdrop, uid,
  type Category, type Item, type ItemLayer, type Layer, type TextLayer,
} from './types';
import { Icon, ItemImage, Sheet, say } from './ui';

interface Doc {
  name: string;
  bg: string;
  layers: Layer[];
}
type Pt = { x: number; y: number };
type Gesture =
  | { mode: 'drag'; id: string; start: Pt; orig: Layer; snap: Doc; moved: boolean; wasSel: boolean }
  | { mode: 'pinch'; id: string; dist0: number; ang0: number; mid0: Pt; orig: Layer; snap: Doc }
  | { mode: 'handle'; id: string; dist0: number; ang0: number; orig: Layer; snap: Doc };

const TEXT_COLORS = ['#1B1A17', '#FFFFFF', '#B5432E', '#6B5B4B', '#3F5A48', '#35507A'];

/** Where a freshly added piece lands, so a first draft already reads as an outfit. */
const PLACE: Record<Category, { x: number; y: number; w: number; maxH: number }> = {
  Tops: { x: 500, y: 400, w: 440, maxH: 520 },
  Bottoms: { x: 500, y: 880, w: 380, maxH: 620 },
  Dresses: { x: 500, y: 640, w: 440, maxH: 900 },
  Outerwear: { x: 300, y: 480, w: 460, maxH: 640 },
  Shoes: { x: 500, y: 1240, w: 280, maxH: 240 },
  Bags: { x: 800, y: 760, w: 250, maxH: 320 },
  Accessories: { x: 200, y: 220, w: 200, maxH: 240 },
  Other: { x: 500, y: 700, w: 360, maxH: 480 },
};

/** A new layer for `item`; `n` (pieces already on the board) nudges repeats apart. */
export function placeItem(item: Item, n = 0): ItemLayer {
  const pl = PLACE[item.category];
  const jitter = (k: number) => (n ? ((n * 37 + k * 53) % 60) - 30 : 0);
  return {
    id: uid(), kind: 'item', itemId: item.id, rot: 0, flip: false,
    w: Math.min(pl.w, pl.maxH * itemAspect(item)),
    x: clamp(pl.x + jitter(1), 80, BOARD_W - 80),
    y: clamp(pl.y + jitter(2), 80, BOARD_H - 80),
  };
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
function snapRot(r: number) {
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  const near = Math.round(r / 90) * 90;
  return Math.abs(r - near) < 3.5 ? near : r;
}
const sizeOf = (l: Layer) => (l.kind === 'item' ? l.w : l.size);
const withSize = (l: Layer, v: number): Layer =>
  l.kind === 'item' ? { ...l, w: clamp(v, 50, 2200) } : { ...l, size: clamp(v, 18, 520) };

function ItemLayerView({ layer, item, s }: { layer: ItemLayer; item: Item; s: number }) {
  const full = useBlobUrl(imgKey(item), item.rev);
  const thumb = useBlobUrl(imgKey(item, true), item.rev);
  const url = full ?? thumb;
  const w = layer.w * s;
  const h = w / itemAspect(item);
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className={showsCut(item) ? 'cut' : 'photo'}
      style={{
        width: w,
        height: h,
        transform: layer.flip ? 'scaleX(-1)' : undefined,
        filter: `drop-shadow(0 ${5 * s}px ${11 * s}px rgba(40,28,16,${showsCut(item) ? 0.24 : 0.18}))`,
      }}
    />
  ) : (
    <div style={{ width: w, height: h }} />
  );
}

export default function BoardEditor({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const { items } = useStore();
  const [doc, setDoc] = useState<Doc>(() => {
    const b = getBoard(boardId)!;
    return { name: b.name, bg: b.bg, layers: b.layers };
  });
  const docRef = useRef(doc);
  docRef.current = doc;
  const [sel, setSel] = useState<string | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const past = useRef<Doc[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [panel, setPanel] = useState<'pieces' | 'backdrop'>('pieces');
  const [filter, setFilter] = useState<'All' | 'Wishlist' | Category>('All');
  const [editText, setEditText] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [sharing, setSharing] = useState(false);

  // ---- artboard sizing ----
  const stageRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(0.3);
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const fit = () => {
      const pad = 12;
      setS(Math.min((el.clientWidth - pad * 2) / BOARD_W, (el.clientHeight - pad * 2) / BOARD_H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- history & saving ----
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const d = docRef.current;
    const b = getBoard(boardId);
    if (!b) return;
    await saveBoardThumb(boardId, d.bg, d.layers).catch(() => {});
    await updateBoard(boardId, { ...d, rev: b.rev + 1 });
  }, [boardId]);
  const touch = useCallback(() => {
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 900);
  }, [save]);
  useEffect(() => {
    const onHide = () => void save();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void save();
    };
  }, [save]);

  const pushHistory = (snap: Doc) => {
    past.current.push(snap);
    if (past.current.length > 60) past.current.shift();
    setCanUndo(true);
    touch();
  };
  /** Apply a change as one undoable step. */
  const commit = (fn: (d: Doc) => Doc) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    docRef.current = next;
    setDoc(next);
    pushHistory(prev);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    docRef.current = prev;
    setDoc(prev);
    setCanUndo(past.current.length > 0);
    if (!prev.layers.some((l) => l.id === selRef.current)) setSel(null);
    touch();
  };
  const patchLayer = (id: string, fn: (l: Layer) => Layer) =>
    setDoc((d) => {
      const next = { ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) };
      docRef.current = next;
      return next;
    });

  // Layers whose piece was since removed from the closet are skipped.
  const visible = useMemo(
    () => doc.layers.filter((l) => l.kind === 'text' || items.some((i) => i.id === l.itemId)),
    [doc.layers, items],
  );

  // ---- hit testing ----
  const els = useRef(new Map<string, HTMLDivElement>());
  const maskKey = (i: Item) => `${imgKey(i, true)}@${i.rev}`;
  useEffect(() => {
    for (const l of visible) {
      if (l.kind !== 'item') continue;
      const item = getItem(l.itemId);
      if (!item || !showsCut(item) || peekMask(maskKey(item))) continue;
      void db.blobUrl(imgKey(item, true)).then((u) => { if (u) void alphaMask(maskKey(item), u); });
    }
  }, [visible]);

  const dims = (l: Layer) => {
    if (l.kind === 'item') {
      const item = getItem(l.itemId);
      return { w: l.w, h: l.w / (item ? itemAspect(item) : 1) };
    }
    const el = els.current.get(l.id);
    return el ? { w: el.offsetWidth / s, h: el.offsetHeight / s } : { w: l.size * 4, h: l.size };
  };
  const toBoard = (cx: number, cy: number): Pt => {
    const r = artRef.current!.getBoundingClientRect();
    return { x: (cx - r.left) / s, y: (cy - r.top) / s };
  };
  function hitTest(p: Pt): Layer | null {
    const layers = docRef.current.layers;
    let box: Layer | null = null;
    let selBox = false;
    const slop = 14 / s; // finger-friendly margin around small things
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const item = l.kind === 'item' ? getItem(l.itemId) : null;
      if (l.kind === 'item' && !item) continue;
      const { w, h } = dims(l);
      const a = (-l.rot * Math.PI) / 180;
      const dx = p.x - l.x;
      const dy = p.y - l.y;
      let lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) > w / 2 + slop || Math.abs(ly) > h / 2 + slop) continue;
      if (l.id === selRef.current) selBox = true;
      box ??= l;
      if (l.kind === 'text') return l;
      const m = item && showsCut(item) ? peekMask(maskKey(item)) : null;
      if (!m) return l;
      if (l.flip) lx = -lx;
      const u = Math.floor(((lx + w / 2) / w) * m.w);
      const v = Math.floor(((ly + h / 2) / h) * m.h);
      if (u >= 0 && v >= 0 && u < m.w && v < m.h && m.a[v * m.w + u] > 24) return l;
    }
    // Missed every garment's actual pixels: keep the current selection if the
    // tap is inside its box, otherwise take the topmost box.
    if (selBox) return layers.find((l) => l.id === selRef.current) ?? box;
    return box;
  }

  // ---- gestures ----
  const pts = useRef(new Map<number, Pt>());
  const g = useRef<Gesture | null>(null);
  const layerById = (id: string) => docRef.current.layers.find((l) => l.id === id);
  const two = () => {
    const [a, b] = [...pts.current.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      ang: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      mid: toBoard((a.x + b.x) / 2, (a.y + b.y) / 2),
    };
  };

  function onDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stageRef.current!.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toBoard(e.clientX, e.clientY);
    const snap = g.current?.snap ?? docRef.current;
    if (pts.current.size === 1) {
      const onHandle = (e.target as HTMLElement).dataset.handle && selRef.current;
      const l = onHandle ? layerById(selRef.current!) : hitTest(p);
      if (!l) {
        setSel(null);
        g.current = null;
      } else if (onHandle) {
        g.current = {
          mode: 'handle', id: l.id, orig: l, snap,
          dist0: Math.hypot(p.x - l.x, p.y - l.y) || 1,
          ang0: (Math.atan2(p.y - l.y, p.x - l.x) * 180) / Math.PI,
        };
      } else {
        g.current = { mode: 'drag', id: l.id, start: p, orig: l, snap, moved: false, wasSel: selRef.current === l.id };
        setSel(l.id);
      }
    } else if (pts.current.size === 2) {
      // Second finger: pinch whatever is selected (or under the fingers).
      const t = two();
      const l = (selRef.current && layerById(selRef.current)) || hitTest(t.mid);
      if (l) {
        setSel(l.id);
        g.current = { mode: 'pinch', id: l.id, orig: l, snap, dist0: t.dist, ang0: t.ang, mid0: t.mid };
      }
    }
  }
  function onMove(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = g.current;
    if (!cur) return;
    if (cur.mode === 'drag') {
      const p = toBoard(e.clientX, e.clientY);
      const dx = p.x - cur.start.x;
      const dy = p.y - cur.start.y;
      if (!cur.moved && Math.hypot(dx, dy) * s < 4) return;
      cur.moved = true;
      patchLayer(cur.id, (l) => ({
        ...l,
        x: clamp(cur.orig.x + dx, 0, BOARD_W),
        y: clamp(cur.orig.y + dy, 0, BOARD_H),
      }));
    } else if (cur.mode === 'pinch' && pts.current.size >= 2) {
      const t = two();
      patchLayer(cur.id, (l) => ({
        ...withSize(l, sizeOf(cur.orig) * (t.dist / cur.dist0)),
        rot: snapRot(cur.orig.rot + t.ang - cur.ang0),
        x: clamp(cur.orig.x + t.mid.x - cur.mid0.x, 0, BOARD_W),
        y: clamp(cur.orig.y + t.mid.y - cur.mid0.y, 0, BOARD_H),
      }));
    } else if (cur.mode === 'handle') {
      const p = toBoard(e.clientX, e.clientY);
      const dist = Math.hypot(p.x - cur.orig.x, p.y - cur.orig.y) || 1;
      const ang = (Math.atan2(p.y - cur.orig.y, p.x - cur.orig.x) * 180) / Math.PI;
      patchLayer(cur.id, (l) => ({
        ...withSize(l, sizeOf(cur.orig) * (dist / cur.dist0)),
        rot: snapRot(cur.orig.rot + ang - cur.ang0),
      }));
    }
  }
  function onUp(e: React.PointerEvent) {
    if (!pts.current.delete(e.pointerId)) return;
    const cur = g.current;
    if (!cur) return;
    if (pts.current.size === 1 && cur.mode === 'pinch') {
      // One finger lifted: carry on dragging with the other.
      const [rest] = [...pts.current.values()];
      const l = layerById(cur.id);
      if (l) g.current = { mode: 'drag', id: l.id, start: toBoard(rest.x, rest.y), orig: l, snap: cur.snap, moved: true, wasSel: true };
      return;
    }
    if (pts.current.size > 0) return;
    g.current = null;
    if (cur.snap !== docRef.current) pushHistory(cur.snap);
    else if (cur.mode === 'drag' && cur.wasSel && cur.orig.kind === 'text') setEditText(cur.id);
  }

  // ---- actions ----
  function addItem(item: Item) {
    const layer = placeItem(item, docRef.current.layers.filter((l) => l.kind === 'item').length);
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSel(layer.id);
  }
  function addText() {
    const dark = backdrop(docRef.current.bg).dark;
    const layer: TextLayer = {
      id: uid(), kind: 'text', text: 'Note', x: BOARD_W / 2, y: 130, size: 84, rot: 0,
      font: 'serif', color: dark ? '#FFFFFF' : '#1B1A17',
    };
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSel(layer.id);
    setEditText(layer.id);
  }
  const selected = sel ? doc.layers.find((l) => l.id === sel) ?? null : null;
  const reorder = (to: 'front' | 'back') =>
    selected &&
    commit((d) => {
      const rest = d.layers.filter((l) => l.id !== selected.id);
      const cur = d.layers.find((l) => l.id === selected.id)!;
      return { ...d, layers: to === 'front' ? [...rest, cur] : [cur, ...rest] };
    });
  const change = (fn: (l: Layer) => Layer) =>
    selected && commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === selected.id ? fn(l) : l)) }));
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: uid(), x: clamp(selected.x + 40, 0, BOARD_W), y: clamp(selected.y + 40, 0, BOARD_H) };
    commit((d) => ({ ...d, layers: [...d.layers, copy] }));
    setSel(copy.id);
  };
  const remove = () => {
    if (!selected) return;
    commit((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== selected.id) }));
    setSel(null);
  };

  async function close() {
    await save();
    // An untouched, empty board isn't worth keeping.
    const b = getBoard(boardId);
    if (b && !b.layers.length && !b.name) await removeBoard(boardId);
    onClose();
  }
  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      await shareBoard(doc.name, doc.bg, visible);
    } catch {
      say("Couldn't create the picture.");
    } finally {
      setSharing(false);
    }
  }
  async function duplicateBoard() {
    await save();
    const d = docRef.current;
    const copy = await createBoard({
      name: d.name ? `${d.name} copy` : '',
      bg: d.bg,
      layers: d.layers.map((l) => ({ ...l, id: uid() })),
    });
    await saveBoardThumb(copy.id, copy.bg, copy.layers).catch(() => {});
    await updateBoard(copy.id, { rev: 1 });
    setMenu(false);
    say('Duplicated — find the copy in Outfits.');
  }

  const bd = backdrop(doc.bg);
  const artStyle: React.CSSProperties = {
    width: BOARD_W * s,
    height: BOARD_H * s,
    backgroundColor: bd.color,
    ...(bd.pattern === 'grid' && {
      backgroundImage:
        'linear-gradient(rgba(27,26,23,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(27,26,23,.07) 1px, transparent 1px)',
      backgroundSize: `${GRID_STEP * s}px ${GRID_STEP * s}px`,
      backgroundPosition: '-0.5px -0.5px',
    }),
    ...(bd.pattern === 'dots' && {
      backgroundImage: `radial-gradient(rgba(27,26,23,.16) ${2 * s}px, transparent ${2 * s + 0.5}px)`,
      backgroundSize: `${DOT_STEP * s}px ${DOT_STEP * s}px`,
    }),
  };

  const drawer = items.filter((i) =>
    filter === 'All' ? true : filter === 'Wishlist' ? i.status === 'wish' : i.category === filter,
  );
  const usedCats = CATEGORIES.filter((c) => items.some((i) => i.category === c));
  const editing = editText ? (doc.layers.find((l) => l.id === editText) as TextLayer | undefined) : undefined;

  return (
    <div className="editor">
      <div className="ed-top">
        <button className="icon-btn" onClick={close} aria-label="Back to outfits">
          <Icon name="back" />
        </button>
        <input
          className="ed-name"
          placeholder="Untitled outfit"
          value={doc.name}
          onChange={(e) => {
            const name = e.target.value;
            setDoc((d) => (docRef.current = { ...d, name }));
            touch();
          }}
          aria-label="Outfit name"
        />
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={share} disabled={sharing} aria-label="Share picture">
          <Icon name="share" />
        </button>
        <button className="icon-btn" onClick={() => { setConfirmDel(false); setMenu(true); }} aria-label="More">
          <Icon name="more" />
        </button>
      </div>

      <div
        className="stage"
        ref={stageRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="artboard" ref={artRef} style={artStyle}>
          {visible.length === 0 && (
            <p className={`art-hint ${bd.dark ? 'dark' : ''}`}>Tap pieces below to drop them on the board</p>
          )}
          {visible.map((l) => {
            const item = l.kind === 'item' ? items.find((i) => i.id === l.itemId)! : null;
            return (
              <div
                key={l.id}
                ref={(el) => {
                  if (el) els.current.set(l.id, el);
                  else els.current.delete(l.id);
                }}
                className={`layer ${l.id === sel ? 'sel' : ''}`}
                style={{
                  transform: `translate(${l.x * s}px, ${l.y * s}px) translate(-50%, -50%) rotate(${l.rot}deg)`,
                }}
              >
                {l.kind === 'item' ? (
                  <ItemLayerView layer={l} item={item!} s={s} />
                ) : (
                  <div
                    className="text-layer"
                    style={{ fontFamily: FONT[l.font], fontSize: l.size * s, color: l.color, lineHeight: LINE }}
                  >
                    {l.text || ' '}
                  </div>
                )}
                {l.id === sel && <span className="handle" data-handle="1" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ed-panel">
        {selected ? (
          <div className="ed-tabs acts">
            {selected.kind === 'text' && (
              <button onClick={() => setEditText(selected.id)}>
                <Icon name="pen" size={19} /> Edit
              </button>
            )}
            <button onClick={() => reorder('front')}>
              <Icon name="front" size={19} /> Front
            </button>
            <button onClick={() => reorder('back')}>
              <Icon name="backward" size={19} /> Back
            </button>
            {selected.kind === 'item' && (
              <button onClick={() => change((l) => ({ ...(l as ItemLayer), flip: !(l as ItemLayer).flip }))}>
                <Icon name="flip" size={19} /> Flip
              </button>
            )}
            <button onClick={duplicate}>
              <Icon name="copy" size={19} /> Copy
            </button>
            <button onClick={remove}>
              <Icon name="trash" size={19} /> Remove
            </button>
          </div>
        ) : (
        <div className="ed-tabs">
            <button className={panel === 'pieces' ? 'on' : ''} onClick={() => setPanel('pieces')}>
              Pieces
            </button>
            <button className={panel === 'backdrop' ? 'on' : ''} onClick={() => setPanel('backdrop')}>
              Backdrop
            </button>
            <button onClick={addText}>
              <Icon name="text" size={16} /> Text
            </button>
          </div>
        )}
        {panel === 'pieces' ? (
          items.length === 0 ? (
            <p className="hint center">Your closet is empty — add a few pieces first.</p>
          ) : (
            <>
              <div className="chips slim">
                {(['All', ...(items.some((i) => i.status === 'wish') ? ['Wishlist'] : []), ...usedCats] as (typeof filter)[]).map((c) => (
                  <button key={c} className={`chip ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="strip">
                {drawer.map((i) => (
                  <button key={i.id} className="strip-item" onClick={() => addItem(i)} aria-label={`Add ${i.name || i.category}`}>
                    <ItemImage item={i} />
                    {i.status === 'wish' && <span className="dot" />}
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <div className="strip backdrops">
            {BACKDROPS.map((b) => (
              <button
                key={b.id}
                className={`bd ${b.pattern ?? ''} ${doc.bg === b.id ? 'on' : ''}`}
                style={{ backgroundColor: b.color }}
                onClick={() => commit((d) => (d.bg === b.id ? d : { ...d, bg: b.id }))}
                aria-label={`Backdrop ${b.id}`}
              />
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!editing} onClose={() => setEditText(null)} label="Edit text">
        {editing && (
          <div className="sheet-body">
            <textarea
              className="text-edit"
              autoFocus
              rows={2}
              value={editing.text}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const text = e.target.value;
                patchLayer(editing.id, (l) => ({ ...(l as TextLayer), text }));
                touch();
              }}
              style={{ fontFamily: FONT[editing.font] }}
            />
            <div className="text-opts">
              <div className="seg">
                {(['serif', 'sans'] as const).map((f) => (
                  <button
                    key={f}
                    className={editing.font === f ? 'on' : ''}
                    style={{ fontFamily: FONT[f] }}
                    onClick={() => { patchLayer(editing.id, (l) => ({ ...(l as TextLayer), font: f })); touch(); }}
                  >
                    {f === 'serif' ? 'Serif' : 'Sans'}
                  </button>
                ))}
              </div>
              <div className="swatches pick">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    className={editing.color === c ? 'on' : ''}
                    style={{ background: c }}
                    onClick={() => { patchLayer(editing.id, (l) => ({ ...(l as TextLayer), color: c })); touch(); }}
                    aria-label={`Colour ${c}`}
                  />
                ))}
              </div>
            </div>
            <button className="btn primary wide" onClick={() => setEditText(null)}>
              Done
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} label="Outfit options">
        <div className="sheet-body stack">
          <button className="btn wide" onClick={() => { setMenu(false); void share(); }}>
            <Icon name="share" size={18} /> Save or share as a picture
          </button>
          <button className="btn wide" onClick={duplicateBoard}>
            <Icon name="copy" size={18} /> Duplicate this outfit
          </button>
          <button
            className="btn wide"
            disabled={!doc.layers.length}
            onClick={() => { commit((d) => ({ ...d, layers: [] })); setSel(null); setMenu(false); }}
          >
            <Icon name="retry" size={18} /> Clear the board
          </button>
          {confirmDel ? (
            <button
              className="btn danger wide"
              onClick={async () => {
                clearTimeout(saveTimer.current);
                dirty.current = false;
                await removeBoard(boardId);
                onClose();
              }}
            >
              Yes, delete this outfit
            </button>
          ) : (
            <button className="btn ghost wide" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" size={18} /> Delete outfit
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
