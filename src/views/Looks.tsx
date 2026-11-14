/**
 * Looks: one big board to live on. The outfit being put together lies in the middle; every saved
 * look lies around it as its own area, drawn small, to be moved, resized and gone into. Inside
 * a look (double-click it, or zoom in on it) its pieces are edited in place with the same tools
 * as the outfit; Esc, Done or a click outside steps back out.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { changeBoard, keepLook } from '../lib/actions';
import {
  addPiece, AREA_S, areaRect, areaScale, BH, BW, editPieces, freeSpot, labelOf, LOOK_CM, newLook, widthOn,
  type Edit, type EditArg, type PieceAction, type Rect,
} from '../lib/boards';
import { bounds, type Box, type View } from '../lib/canvas';
import { shareLook } from '../lib/exportBoard';
import { realSize } from '../lib/kind';
import { asLook, KEY_ORDER, nextOf, RAIL, RAILS, railOf, swap, type RailId } from '../lib/outfit';
import { hint, isDone, isKey, useBindings } from '../lib/shortcuts';
import { getState, saveLook, useStore } from '../lib/store';
import { BOARD_RATIO, PAPERS, uid, type Item, type Look, type Placed } from '../lib/types';
import { Garment, Icon, Mark, Sheet, toast } from '../ui';
import { Canvas, ToolBtn, type CanvasApi, type CanvasArea, type CanvasPiece, type SelBox, type Transform } from './Canvas';
import { poolsOf, useOutfit } from './Mix';
import { RailPicker } from './RailPicker';

/* ---------- looks drawn small ---------- */

/** A look's pieces in percentages of its board: cheap enough for thirty of them at once. */
const Mini = memo(function Mini({ pieces, items }: { pieces: Placed[]; items: Map<string, Item> }) {
  return (
    <>
      {pieces.map((p) => {
        const item = items.get(p.itemId);
        if (!item) return null;
        const hf = (p.w / item.aspect) * BOARD_RATIO;
        return (
          <div key={p.id} className="mini" style={{
            left: `${(p.x - p.w / 2) * 100}%`,
            top: `${(p.y - hf / 2) * 100}%`,
            width: `${p.w * 100}%`,
            aspectRatio: String(item.aspect),
            transform: `rotate(${p.rot}deg) scaleX(${p.flip ? -1 : 1})`,
          }}>
            <Garment item={item} small />
          </div>
        );
      })}
    </>
  );
});

/** A saved look's area on the board. */
const Area = memo(function Area({ look, items }: { look: Look; items: Map<string, Item> }) {
  return (
    <div className="area" style={{ background: look.paper }}>
      <span className="area__name">{look.name || 'Untitled'}</span>
      <div className="area__pieces"><Mini pieces={look.pieces} items={items} /></div>
      {!look.pieces.length && <span className="area__empty" />}
    </div>
  );
});

/** The outfit, drawn small while a look is gone into: a click on it steps back out. */
const OutfitArea = memo(function OutfitArea({ pieces, items, room }: { pieces: Placed[]; items: Map<string, Item>; room: Rect }) {
  // Its pieces are placed on the full board; the area is the room around them.
  const w = room.x1 - room.x0, h = room.y1 - room.y0;
  return (
    <div className="area is-outfit">
      <span className="area__name">outfit</span>
      <div className="area__pieces" style={{ left: `${(-room.x0 / w) * 100}%`, top: `${(-room.y0 / h) * 100}%`, width: `${(BW / w) * 100}%`, height: `${(BH / h) * 100}%` }}>
        <Mini pieces={pieces} items={items} />
      </div>
    </div>
  );
});

/* ---------- where things are ---------- */

/** A place pieces lie in: the outfit at the origin at full size, or a look's area. */
interface Space { id: string; ox: number; oy: number; s: number }
const OUTFIT: Space = { id: 'fit', ox: 0, oy: 0, s: 1 };
const spaceOf = (l: Look): Space => ({ id: l.id, ox: l.at?.x ?? 0, oy: l.at?.y ?? 0, s: areaScale(l) });
const boxIn = (sp: Space, p: Placed, item: Item, z: number): Box => {
  const w = p.w * BW * sp.s;
  return { cx: sp.ox + p.x * BW * sp.s, cy: sp.oy + p.y * BH * sp.s, w, h: w / (item.aspect || 1), rot: p.rot, z };
};
const toFrac = (sp: Space, x: number, y: number) => ({ x: (x - sp.ox) / (BW * sp.s), y: (y - sp.oy) / (BH * sp.s) });
const AREA = 'area:';
const isArea = (id: string) => id.startsWith(AREA);
const inside = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

export function Looks({ hidden, active, startWith, enter, onFocus, onAdd }: {
  hidden: boolean;
  active: boolean;
  /** a piece to put on (a new object each time, so the same piece can be put on again) */
  startWith: { id: string } | null;
  /** a saved look to go into (a new object each time) */
  enter: { id: string } | null;
  onFocus: (id: string, from: DOMRect, sequence: string[]) => void;
  onAdd: () => void;
}) {
  const items = useStore((s) => s.items);
  const looks = useStore((s) => s.looks);
  const fit = useOutfit(!hidden);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [inLook, setInLook] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [strip, setStrip] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [papers, setPapers] = useState(false);
  const [name, setName] = useState('');
  const api = useRef<CanvasApi | null>(null);
  useBindings();

  const look = inLook ? looks.find((l) => l.id === inLook) ?? null : null;
  useEffect(() => { if (inLook && !look) setInLook(null); }, [inLook, look]);
  useEffect(() => { setName(look?.name ?? ''); }, [look?.id, look?.name]);
  const space = look ? spaceOf(look) : OUTFIT;
  const livePieces = look ? look.pieces : fit.pieces;

  /* ----- the outfit's room on the board, and every look's area ----- */
  const outfitBoxes = useMemo(() => fit.pieces.flatMap((p, z) => { const it = byId.get(p.itemId); return it ? [boxIn(OUTFIT, p, it, z + 1)] : []; }), [fit.pieces, byId]);
  const room: Rect = useMemo(() => {
    // Framed as if it were a whole outfit, so a single piece is not blown up.
    const all = bounds(outfitBoxes);
    const cx = all ? (all.x0 + all.x1) / 2 : BW / 2, cy = all ? (all.y0 + all.y1) / 2 : BH / 2;
    const r = { x0: cx - BW * 0.36, x1: cx + BW * 0.36, y0: cy - BH * 0.42, y1: cy + BH * 0.42 };
    return all ? { x0: Math.min(r.x0, all.x0 - 30), y0: Math.min(r.y0, all.y0 - 30), x1: Math.max(r.x1, all.x1 + 30), y1: Math.max(r.y1, all.y1 + 30) } : r;
  }, [outfitBoxes]);
  /** Where new areas keep clear of: the outfit's usual board, and wherever it has spread. */
  const outfitZone = useMemo(() => ({ x0: Math.min(0, room.x0), y0: Math.min(0, room.y0), x1: Math.max(BW, room.x1), y1: Math.max(BH, room.y1) }), [room]);

  // Looks saved before the board had places are given one, once.
  useEffect(() => {
    const lost = looks.filter((l) => !l.at).sort((a, b) => a.createdAt - b.createdAt);
    if (!lost.length) return;
    const taken = looks.filter((l) => l.at).map(areaRect);
    for (const l of lost) {
      const at = freeSpot(taken, outfitZone, areaScale(l));
      taken.push(areaRect({ ...l, at }));
      void saveLook({ ...l, at, s: areaScale(l) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looks]);

  // The outfit grew into a look's area: the area steps aside, so nothing lies on the outfit.
  useEffect(() => {
    const all = bounds(outfitBoxes);
    if (!all) return;
    const busy = { x0: all.x0 - 40, y0: all.y0 - 40, x1: all.x1 + 40, y1: all.y1 + 40 };
    const ls = getState().looks.filter((l) => l.at);
    const hit = ls.filter((l) => { const r = areaRect(l); return r.x0 < busy.x1 && busy.x0 < r.x1 && r.y0 < busy.y1 && busy.y0 < r.y1; });
    if (!hit.length) return;
    const zone = { x0: Math.min(outfitZone.x0, busy.x0), y0: Math.min(outfitZone.y0, busy.y0), x1: Math.max(outfitZone.x1, busy.x1), y1: Math.max(outfitZone.y1, busy.y1) };
    const taken = ls.filter((l) => !hit.includes(l)).map(areaRect);
    for (const l of hit) {
      const at = freeSpot(taken, zone, areaScale(l));
      taken.push(areaRect({ ...l, at }));
      void saveLook({ ...l, at });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfitBoxes]);

  const thumbs = useMemo(() => new Map(looks.map((l) => [l.id, <Area look={l} items={byId} />])), [looks, byId]);
  const outfitThumb = useMemo(() => <OutfitArea pieces={fit.pieces} items={byId} room={room} />, [fit.pieces, byId, room]);
  const areas: CanvasArea[] = useMemo(() => {
    const out: CanvasArea[] = [];
    if (look) {
      const r = room;
      out.push({ id: AREA + 'fit', box: { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, w: r.x1 - r.x0, h: r.y1 - r.y0, rot: 0, z: 0 }, node: outfitThumb, className: 'is-away' + (target === 'fit' ? ' is-target' : '') });
    }
    for (const l of looks) {
      if (l.id === look?.id || !l.at) continue;
      const r = areaRect(l);
      out.push({
        id: AREA + l.id, box: { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, w: r.x1 - r.x0, h: r.y1 - r.y0, rot: 0, z: 0 }, node: thumbs.get(l.id),
        className: (look ? 'is-away' : '') + (target === l.id ? ' is-target' : '') + (fresh === l.id ? ' is-new' : ''),
      });
    }
    return out;
  }, [looks, look, thumbs, outfitThumb, room, target, fresh]);

  /* ----- the pieces being worked on ----- */
  const pieces: CanvasPiece[] = useMemo(() => livePieces.flatMap((p, z) => {
    const item = byId.get(p.itemId);
    return item ? [{ id: p.id, item, box: boxIn(space, p, item, z + 1), flip: p.flip }] : [];
  }), [livePieces, byId, space.ox, space.oy, space.s]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveRect: Rect = look ? areaRect(look) : room;

  /* ----- going into a look and back out ----- */
  const pad = (r: Rect, k: number): Rect => { const w = (r.x1 - r.x0) * k, h = (r.y1 - r.y0) * k; return { x0: r.x0 - w, y0: r.y0 - h, x1: r.x1 + w, y1: r.y1 + h }; };
  const go = (id: string | null, frame = true) => {
    setInLook(id);
    setSel(new Set());
    setPapers(false);
    if (!frame) return;
    const l = id && getState().looks.find((x) => x.id === id);
    setTimeout(() => api.current?.frame(l ? pad(areaRect(l), 0.04) : room, true), 0);
  };
  useEffect(() => { if (enter) go(enter.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [enter]);
  useEffect(() => { if (hidden) setSel(new Set()); }, [hidden]);

  // Opened from a piece's page: put it on, in place of the first of its kind not kept.
  useEffect(() => {
    if (!startWith) return;
    const it = byId.get(startWith.id);
    if (!it) return;
    if (inLook) go(null);
    const id = fit.wear(it, avoid());
    setSel(new Set([id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  /** Zoomed in far enough on a look, it opens. (Zooming out never closes one: carrying pieces far needs the room.) */
  const viewed = (v: View, size: { w: number; h: number }) => {
    if (hidden || !size.w) return;
    const cx = (size.w / 2 - v.x) / v.z, cy = (size.h / 2 - v.y) / v.z;
    const ls = getState().looks;
    if (inLook) return;
    const hit = ls.find((l) => {
      if (!l.at) return false;
      const r = areaRect(l);
      return inside(r, cx, cy) && ((r.x1 - r.x0) * v.z > size.w * 0.55 || (r.y1 - r.y0) * v.z > size.h * 0.62);
    });
    if (hit) go(hit.id, false);
  };

  /* ----- changing what is being worked on ----- */
  const commitLook = (l: Look, pieces: Placed[], label: string, opts: { key?: string; quiet?: boolean } = {}) =>
    changeBoard({ looks: [{ ...l, pieces }] }, label, opts);
  /** One change to the pieces being worked on, in board units (world units are divided by the scale). */
  const edit = (a: Edit, ids: string[], arg: EditArg = {}, key?: string) => {
    const pid = ids.filter((id) => !isArea(id));
    if (!pid.length) return;
    const s = space.s;
    const a2: EditArg = { ...arg, dx: arg.dx === undefined ? undefined : arg.dx / s, dy: arg.dy === undefined ? undefined : arg.dy / s };
    if (arg.px !== undefined) { a2.px = (arg.px - space.ox) / s; a2.py = (arg.py! - space.oy) / s; }
    if (!look) {
      const next = fit.edit(a, pid, a2, key);
      if (next && a === 'duplicate') setSel(new Set(next.slice(-pid.length).map((p) => p.id)));
      if (a === 'remove') setSel(new Set());
      return;
    }
    const next = editPieces(look.pieces, a, pid, a2);
    if (!next) return;
    commitLook(look, next, labelOf(a, arg), { key });
    if (a === 'duplicate') setSel(new Set(next.slice(-pid.length).map((p) => p.id)));
    if (a === 'remove') setSel(new Set());
  };

  /** Areas moved, resized or removed: one step for all of them. */
  const areaIds = (ids: string[]) => ids.filter((id) => isArea(id) && id !== AREA + 'fit').map((id) => id.slice(AREA.length));
  const moveAreas = (ids: string[], dx: number, dy: number, key?: string) => {
    const ls = areaIds(ids).flatMap((id) => { const l = looks.find((x) => x.id === id); return l?.at ? [{ ...l, at: { x: l.at.x + dx, y: l.at.y + dy } }] : []; });
    if (ls.length) changeBoard({ looks: ls }, ls.length === 1 ? 'Moved the look' : `Moved ${ls.length} looks`, { key });
  };
  const sizeAreas = (ids: string[], k: number, key?: string) => {
    const ls = areaIds(ids).flatMap((id) => {
      const l = looks.find((x) => x.id === id);
      if (!l?.at) return [];
      const r = areaRect(l), s0 = areaScale(l), s = Math.min(1.6, Math.max(0.16, s0 * k)), kk = s / s0;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      return [{ ...l, s, at: { x: cx - (cx - r.x0) * kk, y: cy - (cy - r.y0) * kk } }];
    });
    if (ls.length) changeBoard({ looks: ls }, 'Resized', { key });
  };
  const removeAreas = (ids: string[]) => {
    const gone = areaIds(ids);
    if (!gone.length) return;
    changeBoard({ removed: gone }, gone.length === 1 ? 'Look removed' : `Removed ${gone.length} looks`);
    setSel(new Set());
  };
  const copyArea = (id: string) => {
    const l = looks.find((x) => x.id === id);
    if (!l) return;
    const taken = looks.filter((x) => x.at).map(areaRect);
    const at = freeSpot(taken, outfitZone, areaScale(l));
    const copy: Look = { ...newLook(looks.length), pieces: l.pieces.map((p) => ({ ...p, id: uid() })), paper: l.paper, name: `${l.name || 'Look'} copy`, at, s: areaScale(l) };
    changeBoard({ looks: [copy] }, 'Copied the look');
    setSel(new Set([AREA + copy.id]));
    flash(copy);
  };
  /** A new area just put down shows itself, and is brought into view when it is off screen. */
  const flash = (l: Look) => {
    setFresh(l.id);
    setTimeout(() => setFresh((f) => (f === l.id ? null : f)), 1400);
    const c = api.current, r = areaRect(l);
    if (!c) return;
    const a = c.toScreen(r.x0, r.y0), b = c.toScreen(r.x1, r.y1), { w, h } = c.size();
    if (a.x < 0 || a.y < 60 || b.x > w || b.y > h - 80) {
      const u = { x0: Math.min(r.x0, liveRect.x0), y0: Math.min(r.y0, liveRect.y0), x1: Math.max(r.x1, liveRect.x1), y1: Math.max(r.y1, liveRect.y1) };
      c.frame(u, true);
    }
  };

  /** The area under a point, other than the one being worked on. */
  const areaAt = (x: number, y: number): string | null => {
    if (look && inside(room, x, y)) return 'fit';
    const l = looks.find((q) => q.id !== look?.id && q.at && inside(areaRect(q), x, y));
    return l?.id ?? null;
  };
  const centreOf = (ids: string[], dx: number, dy: number) => {
    const b = pieces.find((p) => p.id === ids[0])?.box;
    return b ? { x: b.cx + dx, y: b.cy + dy } : null;
  };

  /**
   * Pieces carried onto another area go there: copied when the outfit is either end (it stays
   * as it is, and a saved look gives pieces to try), moved from one saved look to another.
   */
  const carry = (ids: string[], dx: number, dy: number, to: string) => {
    const dest = to === 'fit' ? null : looks.find((l) => l.id === to);
    if (to !== 'fit' && !dest) return;
    const sp = dest ? spaceOf(dest) : OUTFIT;
    const moving = livePieces.filter((p) => ids.includes(p.id));
    let destPieces = dest ? dest.pieces : fit.work.pieces;
    const fresh: string[] = [];
    for (const p of moving) {
      const it = byId.get(p.itemId), b = pieces.find((q) => q.id === p.id)?.box;
      if (!it || !b) continue;
      const at = toFrac(sp, b.cx + dx, b.cy + dy);
      const w = dest ? widthOn(it, destPieces, items) : realSize(it).w / LOOK_CM;
      const q: Placed = { id: uid(), itemId: it.id, x: at.x, y: at.y, w, rot: p.rot, flip: p.flip, ...(dest ? {} : { rail: railOf(it), byHand: true }) };
      destPieces = [...destPieces, q];
      fresh.push(q.id);
    }
    if (!fresh.length) return;
    const n = fresh.length === 1 ? '' : ` ${fresh.length}`;
    const where = dest ? dest.name || 'the look' : 'the outfit';
    if (dest && look) {
      // From one saved look to another: it leaves the first.
      changeBoard({ looks: [{ ...look, pieces: look.pieces.filter((p) => !ids.includes(p.id)) }, { ...dest, pieces: destPieces }] }, `Moved${n} to ${where}`);
    } else if (dest) {
      changeBoard({ looks: [{ ...dest, pieces: destPieces }] }, `Copied${n} to ${where}`);
    } else {
      changeBoard({ working: { ...fit.work, pieces: destPieces } }, `Copied${n} to the outfit`);
    }
    setSel(new Set());
  };

  /* ----- putting pieces on ----- */
  const strips = RAILS.filter((r) => fit.pools[r.id].length || (look && poolsOf(items, true)[r.id].length));
  const stripPool = useMemo(() => {
    const pools = look ? poolsOf(items, true) : fit.pools;
    return strip === 'all' ? RAILS.flatMap((r) => pools[r.id]) : strip ? pools[strip as RailId] ?? [] : [];
  }, [strip, look, items, fit.pools]);
  const onBoard = useMemo(() => new Set(livePieces.map((p) => p.itemId)), [livePieces]);
  /** Saved looks' areas, in shares of the outfit's board: new pieces keep clear of them. */
  const avoid = () => looks.filter((l) => l.at).map((l) => { const r = areaRect(l); return { x: (r.x0 + r.x1) / 2 / BW, y: (r.y0 + r.y1) / 2 / BH, w: (r.x1 - r.x0) / BW, h: (r.y1 - r.y0) / BH }; });
  /** Put a piece on whatever is being worked on: at a world point, or where it belongs. */
  const putOn = (item: Item, at?: { x: number; y: number }) => {
    if (!look) {
      const id = fit.add(item, at && toFrac(OUTFIT, at.x, at.y), avoid());
      setSel(new Set([id]));
      return;
    }
    const next = addPiece(look.pieces, items, item, at && toFrac(space, at.x, at.y));
    commitLook(look, next, 'Added to the look');
    setSel(new Set([next[next.length - 1].id]));
  };
  const pick = (item: Item) => {
    if (!onBoard.has(item.id)) return putOn(item);
    if (!look) return fit.takeOff([item.id]);
    commitLook(look, look.pieces.filter((p) => p.itemId !== item.id), 'Took off');
  };
  /** Let go of a piece carried out of the strip: onto a look's area, or the one being worked on. */
  const dropped = (item: Item, x: number, y: number) => {
    const c = api.current, el = c?.el();
    if (!c || !el) return;
    const r = el.getBoundingClientRect();
    const w = c.toWorld(x - r.left, y - r.top);
    const to = areaAt(w.x, w.y);
    const dest = to && to !== 'fit' ? looks.find((l) => l.id === to) : null;
    if (dest) {
      changeBoard({ looks: [{ ...dest, pieces: addPiece(dest.pieces, items, item, toFrac(spaceOf(dest), w.x, w.y)) }] }, `Added to ${dest.name || 'the look'}`);
      return;
    }
    if (to === 'fit') go(null, false);
    putOn(item, w);
  };
  const ghostWidth = (item: Item) => {
    const z = api.current?.view().z ?? 1;
    const w = look ? widthOn(item, look.pieces, items) * BW * space.s : (realSize(item).w / LOOK_CM) * BW;
    return w * z;
  };

  /* ----- saving the outfit as a look ----- */
  const save = () => {
    const ps = asLook(fit.pieces, items);
    if (!ps.length) return;
    const taken = looks.filter((l) => l.at).map(areaRect);
    const l: Look = { ...newLook(looks.length, ps), at: freeSpot(taken, outfitZone, AREA_S), s: AREA_S };
    changeBoard({ looks: [l] }, 'Look saved');
    flash(l);
  };

  /* ----- keys ----- */
  const readingOrder = () => {
    const rank = (p: Placed) => { const it = byId.get(p.itemId); return it ? KEY_ORDER.indexOf(railOf(it)) : 99; };
    return [...livePieces].filter((p) => byId.has(p.itemId)).sort((a, b) => rank(a) - rank(b) || a.x - b.x).map((p) => p.id);
  };
  const onKey = (e: KeyboardEvent, ids: string[]) => {
    const handled = () => e.preventDefault();
    const mine = ids.filter((id) => !isArea(id));
    if (isKey(e, 'close')) {
      if (papers) { handled(); setPapers(false); } else if (strip) { handled(); setStrip(null); } else if (!ids.length && look) { handled(); go(null); }
      return;
    }
    if (isKey(e, 'next') || isKey(e, 'prev')) {
      const d = isKey(e, 'next') ? 1 : -1;
      if (mine.length) { handled(); stepPieces(mine, d); } else if (!ids.length && !look) { handled(); fit.stepAll(d); }
      return;
    }
    if (isKey(e, 'railDown') || isKey(e, 'railUp')) {
      if (ids.some(isArea)) return;
      handled();
      const order = readingOrder();
      if (!order.length) return;
      const i = mine.length ? order.indexOf(mine[mine.length - 1]) : -1;
      const n = isKey(e, 'railDown') ? (i + 1) % order.length : i <= 0 ? order.length - 1 : i - 1;
      setSel(new Set([order[n]]));
      return;
    }
    if (isKey(e, 'keep') && !look) { handled(); fit.keep(mine.length ? mine : fit.pieces.map((p) => p.id)); return; }
    if (isKey(e, 'pickAll')) {
      if (ids.length === 1 && isArea(ids[0])) { handled(); const id = ids[0].slice(AREA.length); if (id === 'fit') go(null); else go(id); return; }
      handled();
      const p = livePieces.find((q) => q.id === mine[0]), it = p && byId.get(p.itemId);
      const want = it ? railOf(it) : 'all';
      setStrip(strip === want ? null : want);
      return;
    }
    if (isKey(e, 'shuffle') && !look) { handled(); fit.shuffle(); return; }
    if (isKey(e, 'save') && !look) { handled(); save(); }
  };
  const stepPieces = (ids: string[], d: number) => {
    if (!look) return fit.step(ids, d);
    const pools = poolsOf(items, true);
    let ps = look.pieces;
    for (const id of ids) {
      const p = ps.find((q) => q.id === id), it = p && byId.get(p.itemId);
      if (!p || !it) continue;
      const next = nextOf(pools[railOf(it)], it.id, d, new Set(ps.filter((q) => q.id !== id).map((q) => q.itemId)));
      if (next) ps = swap(ps, id, next, (x) => byId.get(x), false);
    }
    commitLook(look, ps, 'Changed', { key: 'swap:' + ids.join(), quiet: true });
  };

  /* ----- the canvas's reports ----- */
  const onSel = (next: Set<string>) => {
    // The outfit, clicked while in a look: back to it.
    if (next.has(AREA + 'fit')) return go(null);
    // Anything picked outside the look being worked on steps out of it.
    if (look && [...next].some(isArea)) { setInLook(null); setPapers(false); }
    setSel(next);
  };
  const onMove = (ids: string[], dx: number, dy: number, keyed: boolean) => {
    const key = keyed ? 'nudge:' + ids.join() : undefined;
    if (ids.some(isArea)) return moveAreas(ids, dx, dy, key);
    const c = !keyed && centreOf(ids, dx, dy);
    const to = c ? areaAt(c.x, c.y) : null;
    if (to) return carry(ids, dx, dy, to);
    edit('move', ids, { dx, dy }, key);
  };
  const onDrag = (ids: string[], dx: number, dy: number) => {
    const c = ids.length && !ids.some(isArea) ? centreOf(ids, dx, dy) : null;
    const t = c ? areaAt(c.x, c.y) : null;
    if (t !== target) setTarget(t);
  };
  const onResize = (ids: string[], k: number, keyed: boolean) => {
    const key = keyed ? 'size:' + ids.join() : undefined;
    if (ids.some(isArea)) return sizeAreas(ids, k, key);
    edit('resize', ids, { k }, key);
  };
  const onTransform = (ids: string[], t: Transform) => {
    if (ids.some(isArea)) return sizeAreas(ids, t.k);
    edit('transform', ids, { k: t.k, deg: t.deg, px: t.px, py: t.py });
  };
  const onAction = (a: PieceAction, ids: string[]) => {
    if (ids.some(isArea)) {
      if (a === 'remove') removeAreas(ids);
      if (a === 'duplicate') areaIds(ids).forEach(copyArea);
      return;
    }
    edit(a, ids);
  };
  const onOpen = (id: string, rect: DOMRect) => {
    if (isArea(id)) { const l = id.slice(AREA.length); return go(l === 'fit' ? null : l); }
    const p = livePieces.find((x) => x.id === id), it = p && byId.get(p.itemId);
    if (!p || !it) return;
    onFocus(it.id, rect, look ? look.pieces.map((x) => x.itemId) : fit.pools[railOf(it)].map((i) => i.id));
  };
  const onEmpty = (at: { x: number; y: number }) => {
    if (look && !inside(areaRect(look), at.x, at.y)) go(null, false);
  };

  /* ----- what shows by the selection ----- */
  const toolbar = (ids: string[], _at: SelBox) => {
    const as = areaIds(ids);
    if (ids.some(isArea)) {
      if (!as.length) return null;
      const one = as.length === 1 ? looks.find((l) => l.id === as[0]) : null;
      return (
        <>
          {one && <button className="hud__btn is-word" onClick={() => go(one.id)}>open</button>}
          {one && <button className="hud__btn" aria-label="Share as a picture" title="Share as a picture" onClick={() => void share(one)}><Icon name="share" /></button>}
          <ToolBtn a="duplicate" onClick={() => as.forEach(copyArea)} />
          <ToolBtn a="remove" onClick={() => removeAreas(ids)} />
        </>
      );
    }
    const one = ids.length === 1 ? livePieces.find((p) => p.id === ids[0]) : null;
    const it = one && byId.get(one.itemId);
    const r = it ? railOf(it) : null;
    const kept = !look && ids.every((id) => fit.work.kept.includes(id));
    return (
      <>
        {!look && (
          <button className="hud__btn" aria-pressed={kept} aria-label={kept ? 'Let go' : 'Keep'} title={`${kept ? 'Let go' : 'Keep'} (${hint('keep')})`}
            onClick={() => fit.keep(ids)}><Icon name={kept ? 'lock' : 'unlock'} /></button>
        )}
        {r && (
          <button className="hud__btn" aria-pressed={strip === r} aria-label={`All ${RAIL[r].title}`} title={`All ${RAIL[r].title} (${hint('pickAll')})`}
            onClick={() => setStrip(strip === r ? null : r)}><Icon name="grid" /></button>
        )}
        <i className="hud__sep" />
        <ToolBtn a="forward" onClick={() => edit('forward', ids)} />
        <ToolBtn a="backward" onClick={() => edit('backward', ids)} />
        <ToolBtn a="flip" onClick={() => edit('flip', ids)} />
        <ToolBtn a="duplicate" onClick={() => edit('duplicate', ids)} />
        <ToolBtn a="remove" onClick={() => edit('remove', ids)} />
      </>
    );
  };
  const pools = look ? poolsOf(items, true) : fit.pools;
  const hud = (p: CanvasPiece, at: { x: number; y: number; w: number; h: number }, s: { selected: boolean; lifted: boolean }) => {
    if (!s.selected || s.lifted || sel.size !== 1) return null;
    const n = pools[railOf(p.item)].length;
    if (n < 2) return null;
    const midY = at.y + at.h / 2;
    const k = RAIL[railOf(p.item)].label;
    return (
      <>
        <button className="hud__arrow" style={{ left: Math.max(4, at.x - 44), top: midY - 18 }} aria-label={`Previous ${k}`} title={`Previous ${k} (${hint('prev')})`}
          onClick={() => stepPieces([p.id], -1)}><Icon name="left" /></button>
        <button className="hud__arrow" style={{ left: Math.min(innerWidth - 40, at.x + at.w + 8), top: midY - 18 }} aria-label={`Next ${k}`} title={`Next ${k} (${hint('next')})`}
          onClick={() => stepPieces([p.id], 1)}><Icon name="right" /></button>
      </>
    );
  };
  const decorate = (p: CanvasPiece) => (!look && fit.work.kept.includes(p.id) ? <span className="kept"><Icon name="lock" /></span> : null);

  const share = async (l: Look) => {
    const r = await shareLook(l, items);
    if (r === 'saved') toast('Picture saved');
  };

  if (!fit.anything && !looks.length) {
    return (
      <div className="looks" hidden={hidden}>
        <div className="empty">
          <Mark className="mark" />
          <p>Outfits are put together here from the pieces in your closet.</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add a piece</button>
        </div>
      </div>
    );
  }

  const top = 52 + 10 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0);
  const under = look && (
    <div className="area is-in" style={{ transform: `translate(${look.at?.x ?? 0}px, ${look.at?.y ?? 0}px)`, width: BW * space.s, height: BH * space.s, background: look.paper }} />
  );

  return (
    <div className={'looks' + (look ? ' is-in' : '')} hidden={hidden}>
      <Canvas
        api={api}
        full
        pieces={pieces}
        areas={areas}
        sel={sel}
        onSel={onSel}
        active={active && !hidden}
        insets={{ top: top + 58, bottom: strip ? 250 : 100, left: 24, right: 24 }}
        maxFitZ={look ? 3 : 2}
        minFitZ={0.06}
        fitRect={look ? pad(liveRect, 0.04) : room}
        onOpen={onOpen}
        onMove={onMove}
        onDrag={onDrag}
        onResize={onResize}
        onRotate={(ids, deg, keyed) => edit('rotate', ids, { deg }, keyed ? 'turn:' + ids.join() : undefined)}
        onTransform={onTransform}
        onAction={onAction}
        onKey={onKey}
        onView={viewed}
        onEmpty={onEmpty}
        toolbar={toolbar}
        hud={hud}
        decorate={decorate}
        under={under}
      />

      {look ? (
        <div className="lookbar">
          <button className="pill is-small is-back" onClick={() => go(null)} title={`Back to the outfit (${hint('close')})`}><Icon name="back" />outfit</button>
          <input className="lookbar__name" value={name} placeholder="Name this look" enterKeyHint="done" aria-label="Name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name !== look.name) changeBoard({ looks: [{ ...look, name }] }, 'Renamed', { quiet: true }); }}
            onKeyDown={(e) => isDone(e) && e.currentTarget.blur()} />
          <button className="lookbar__paper" style={{ background: look.paper }} aria-label="Paper" aria-expanded={papers} onClick={() => setPapers(!papers)} />
          <button className="iconbtn is-quiet" disabled={!look.pieces.length} aria-label="Share as a picture" title="Share as a picture" onClick={() => void share(look)}><Icon name="share" /></button>
          <button className="iconbtn is-quiet" aria-label="Remove this look" title="Remove this look" onClick={() => { removeAreas([AREA + look.id]); go(null); }}><Icon name="bin" /></button>
          {papers && (
            <div className="lookbar__papers">
              {PAPERS.map((c) => (
                <button key={c} style={{ background: c }} aria-pressed={look.paper === c} aria-label={`Paper ${c}`}
                  onClick={() => changeBoard({ looks: [{ ...look, paper: c }] }, 'Paper changed')} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mix__layers">
          <button className="pill is-small" aria-pressed={fit.work.wish} onClick={fit.wish}>wishlist</button>
          {fit.work.kept.length > 0 && <button className="pill is-small" onClick={fit.letGo}><Icon name="unlock" />let go</button>}
          {RAILS.filter((r) => fit.pools[r.id].length).map((r) => (
            <button key={r.id} className="pill is-small is-add" disabled={!fit.unworn(r.id)} onClick={() => { const it = fit.unworn(r.id); if (it) putOn(it); }} aria-label={`Add a ${r.label}`}><Icon name="plus" />{r.label}</button>
          ))}
        </div>
      )}

      {!look && !fit.pieces.length && fit.anything && (
        <div className="looks__start"><button className="pill" onClick={fit.start}><Icon name="plus" />start an outfit</button></div>
      )}

      {strip && (
        <RailPicker
          kinds={strips.map((r) => ({ id: r.id, title: r.title }))}
          kind={strip}
          onKind={setStrip}
          pool={stripPool}
          on={onBoard}
          onPick={pick}
          onDrop={dropped}
          ghostWidth={ghostWidth}
          onClose={() => setStrip(null)}
        />
      )}

      <div className="dock">
        <button className="round glass" aria-label="Pieces" aria-pressed={!!strip} title={`Pieces (${hint('pickAll')})`} onClick={() => setStrip(strip ? null : 'all')}><Icon name="grid" /></button>
        {look ? (
          <button className="go" onClick={() => go(null)} title={hint('close')}>Done</button>
        ) : (
          <>
            <button className="round glass" aria-label="Shuffle" title={`Shuffle (${hint('shuffle')})`} onClick={fit.shuffle} disabled={!fit.pieces.length}><Icon name="shuffle" /></button>
            <button className="go" onClick={save} disabled={!fit.pieces.length} title={hint('save')}>Save this look</button>
          </>
        )}
        <button className="round glass" aria-label="Fit" title={`Fit, again for everything (${hint('fit')})`} onClick={() => api.current?.fit(true, true)}><Icon name="fit" /></button>
      </div>
    </div>
  );
}

/* ---------- adding a piece to a look from its page ---------- */

/** A look drawn small for the list: the same placements as its area. */
function MiniBoard({ look, items }: { look: Look; items: Map<string, Item> }) {
  return <div className="lookcard__board" style={{ background: look.paper }}><Mini pieces={look.pieces} items={items} /></div>;
}

/** Choose which look a piece should join. */
export function PickLook({ itemId, onClose, onOpen }: {
  itemId: string | null;
  onClose: () => void;
  onOpen: (lookId: string) => void;
}) {
  const looks = useStore((s) => s.looks);
  const items = useStore((s) => s.items);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const item = itemId ? byId.get(itemId) : undefined;

  const addTo = async (look: Look) => {
    if (!item) return;
    await keepLook({ ...look, pieces: addPiece(look.pieces, items, item) }, 'Added to the look');
    onOpen(look.id);
  };

  return (
    <Sheet open={!!itemId} onClose={onClose} label="Add to a look">
      <div className="sheet__head"><h2>Add to a look</h2></div>
      <div className="looks__grid">
        <button className="lookcard is-new" onClick={() => void addTo(newLook(looks.length))}>
          <div className="lookcard__board"><Icon name="plus" /></div>
          <span className="lookcard__name">New look</span>
        </button>
        {looks.map((l) => (
          <button key={l.id} className="lookcard" onClick={() => void addTo(l)}>
            <MiniBoard look={l} items={byId} />
            <span className="lookcard__name">{l.name || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
