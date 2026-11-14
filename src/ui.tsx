import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isKey } from './lib/shortcuts';
import { usePic } from './lib/store';
import type { Item } from './lib/types';

/* ---------- icons: thin strokes, drawn on a 24 grid ---------- */

const PATHS: Record<string, string> = {
  plus: 'M12 4v16M4 12h16',
  x: 'M5 5l14 14M19 5L5 19',
  filter: 'M3 7h18M7 12h10M10.5 17h3',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  scatter: 'M3.5 6.5l5-2 2 5-5 2zM13.5 4.5h6v6h-6zM5 15l5.5 1-1 5.5-5.5-1zM14 14.5l6 1.5-1.5 6-6-1.5z',
  camera: 'M3 8h3.5l1.7-2.5h7.6L17.5 8H21v11H3zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  photos: 'M3 6h14v12H3zM7 3h14v12M3 15l4-4 4 4 2-2 4 4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  back: 'M15 5l-7 7 7 7',
  undo: 'M8 5L4 9l4 4M4 9h10a6 6 0 010 12h-3',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  shuffle: 'M3 7h3.5c5 0 6 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.6 0 2.8-1 3.9-2.4M21 7h-3.5c-1.6 0-2.8 1-3.9 2.4M18 4l3 3-3 3',
  turn: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5',
  gear: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM9 14.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  out: 'M9 6h9v9M18 6L7 17',
  left: 'M14 6l-6 6 6 6',
  right: 'M10 6l6 6-6 6',
  bin: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7',
  front: 'M4 10h10v10H4zM10 10V4h10v10h-6',
  behind: 'M10 4h10v10H10zM10 10H4v10h10v-6',
  flip: 'M12 3v18M9 7L4 12l5 5zM15 7l5 5-5 5',
  copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z',
  tidy: 'M4 7h16M4 12h16M4 17h10',
  looks: 'M4 4h11v15H4zM9 8v12h11V8h-3',
  lock: 'M7.5 11V8a4.5 4.5 0 019 0v3M5.5 11h13v9.5h-13z',
  unlock: 'M7.5 11V8a4.5 4.5 0 018.7-1.6M5.5 11h13v9.5h-13z',
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.4 : 1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The mark: a shirt collar that reads as a W. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="96 120 320 260" fill="currentColor" aria-hidden="true">
      <path d="M96 120h130l30 150-90 110z" />
      <path d="M416 120H286l-30 150 90 110z" />
    </svg>
  );
}

/* ---------- a piece, however far along it is ---------- */

export function Garment({ item, size = 'thumb', small, raw }: {
  item: Item; size?: 'thumb' | 'full'; small?: boolean;
  /** show the original photo instead of the cut-out */
  raw?: boolean;
}) {
  const original = usePeeking().has(item.id) || !!raw;
  const url = usePic(item, original ? 'raw' : size);
  // A piece that comes back from the studio while you watch is wiped in from the top.
  const was = useRef(item.state);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (item.state === 'ready' && was.current !== 'ready') setFresh(true);
    was.current = item.state;
  }, [item.state]);
  if (item.state === 'ready' && !original) {
    return url
      ? <img className={'garment' + (small ? ' is-small' : '') + (fresh ? ' is-fresh' : '')} src={url} alt={item.name}
          draggable={false} onAnimationEnd={() => setFresh(false)} />
      : null;
  }
  const developing = item.state === 'working';
  return (
    <div className={'print' + (developing ? ' is-developing' : '') + (original && item.state === 'ready' ? ' is-original' : '')}>
      {url && <img src={url} alt={item.name} draggable={false} />}
    </div>
  );
}

/* ---------- bottom sheet ---------- */

export function Sheet({ open, onClose, children, label }: {
  open: boolean; onClose: () => void; children: ReactNode; label: string;
}) {
  // Stay mounted through the closing slide.
  const [mounted, setMounted] = useState(open);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
      return () => cancelAnimationFrame(r);
    }
    setOn(false);
    const t = setTimeout(() => setMounted(false), 620);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (!e.defaultPrevented && isKey(e, 'close', { inField: true })) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <>
      <button className={'scrim' + (on ? ' is-on' : '')} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div className={'sheet' + (on ? ' is-on' : '')} role="dialog" aria-modal="true" aria-label={label}>
        <span className="sheet__grab" />
        <div className="sheet__body">{children}</div>
      </div>
    </>
  );
}

/* ---------- toast ---------- */

interface ToastState { text: string; action?: { label: string; run: () => void }; n: number }
let toastState: ToastState | null = null;
const toastSubs = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, action?: ToastState['action']) {
  toastState = { text, action, n: (toastState?.n ?? 0) + 1 };
  toastSubs.forEach((f) => f());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastState = null;
    toastSubs.forEach((f) => f());
  }, action ? 6500 : 2400);
}

export function dismissToast() {
  clearTimeout(toastTimer);
  toastState = null;
  toastSubs.forEach((f) => f());
}
/** True while a toast is up, so quieter notices can step aside. */
export function useToasting() {
  return useSyncExternalStore(
    (f) => (toastSubs.add(f), () => void toastSubs.delete(f)),
    () => !!toastState,
  );
}

export function Toast() {
  const t = useSyncExternalStore(
    (f) => (toastSubs.add(f), () => void toastSubs.delete(f)),
    () => toastState,
  );
  // Keep the last text while fading out.
  const [last, setLast] = useState<ToastState | null>(null);
  useEffect(() => {
    if (t) setLast(t);
  }, [t]);
  const show = t ?? last;
  return (
    <div className={'toast' + (t ? ' is-on' : '')} role="status" aria-live="polite">
      <span>{show?.text}</span>
      {show?.action && (
        <button onClick={() => { show.action!.run(); dismissToast(); }}>
          {show.action.label}
        </button>
      )}
    </div>
  );
}

/* ---------- viewport size ---------- */

export function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const f = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return v;
}

/* ---------- alternates: what a button does with Option held ---------- */

/**
 * Held down, this key turns buttons into their alternates, as Option does in a Mac menu.
 * TODO: register as 'alternate' (default 'alt') in shortcuts.ts and read it from there.
 */
const ALTERNATE_KEY = 'Alt';

let altHeld = false;
const altSubs = new Set<() => void>();
function setAlt(on: boolean) {
  if (altHeld === on) return;
  altHeld = on;
  altSubs.forEach((f) => f());
}
let altWatching = false;
function watchAlt() {
  if (altWatching) return;
  altWatching = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === ALTERNATE_KEY) { if (!e.repeat) setAlt(true); }
    // Option with another key is a character or a shortcut, not a look at the alternates.
    else if (altHeld) setAlt(false);
  });
  window.addEventListener('keyup', (e) => { if (e.key === ALTERNATE_KEY) { e.preventDefault(); setAlt(false); } });
  // Let go outside the window, or the window lost focus while it was down.
  window.addEventListener('pointermove', (e) => { if (!e.altKey && altHeld) setAlt(false); }, { passive: true });
  window.addEventListener('blur', () => setAlt(false));
  document.addEventListener('visibilitychange', () => setAlt(false));
}
/** True while the alternate key is held down. */
export function useAlt() {
  watchAlt();
  return useSyncExternalStore((f) => (altSubs.add(f), () => void altSubs.delete(f)), () => altHeld);
}

/** Touch screens have no Option key: a ⋯ button shows the same alternates. */
export const noAltKey = () => matchMedia('(pointer: coarse)').matches;
export function MoreToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  if (!noAltKey()) return null;
  return (
    <button className={'iconbtn is-small more' + (on ? ' is-on' : '')} aria-label="More" aria-pressed={on}
      onClick={() => onChange(!on)}><Icon name="more" /></button>
  );
}

export interface Alternate { label: string; icon?: keyof typeof PATHS; run: () => void; pressed?: boolean }
/** A pill that becomes its alternate while `alt` is on. */
export function Pill({ icon, label, run, alt, showAlt, className = '', disabled, pressed }: {
  icon?: keyof typeof PATHS; label: string; run: () => void; alt?: Alternate; showAlt?: boolean;
  className?: string; disabled?: boolean; pressed?: boolean;
}) {
  const a = showAlt && alt ? alt : null;
  const on = a ? a.pressed : pressed;
  return (
    <button className={'pill ' + className + (a ? ' is-alt' : '') + (on ? ' is-on' : '')} disabled={!a && disabled}
      aria-pressed={on === undefined ? undefined : on} onClick={a ? a.run : run}>
      {(a ? a.icon : icon) && <Icon name={(a ? a.icon : icon)!} />}{a ? a.label : label}
    </button>
  );
}

/* ---------- originals shown in place of cut-outs ---------- */

let peeking = new Set<string>();
const peekSubs = new Set<() => void>();
/** Show these pieces' original photos wherever they are drawn (or stop). */
export function peek(ids: string[], on: boolean) {
  const next = new Set(peeking);
  for (const id of ids) if (on) next.add(id); else next.delete(id);
  peeking = next;
  peekSubs.forEach((f) => f());
}
/** Stop showing originals, except for `keep`. */
export const peekOnly = (keep: string[]) => peek([...peeking].filter((id) => !keep.includes(id)), false);
export const usePeeking = () => useSyncExternalStore((f) => (peekSubs.add(f), () => void peekSubs.delete(f)), () => peeking);

/* ---------- a button that asks for a note on its second press ---------- */

/** True while armed; any press outside `ref` (or Escape in the field) lets go. */
export function useArmed(ref: React.RefObject<HTMLElement | null>) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setArmed(false); };
    document.addEventListener('pointerdown', out, true);
    return () => document.removeEventListener('pointerdown', out, true);
  }, [armed, ref]);
  return [armed, setArmed] as const;
}

/** The optional note a second press sends along. Enter sends it; Escape lets go. */
export function NoteField({ value, onChange, onGo, onCancel, placeholder = "what's wrong? (optional)" }: {
  value: string; onChange: (v: string) => void; onGo: () => void; onCancel: () => void; placeholder?: string;
}) {
  return (
    <input className="notefield" value={value} placeholder={placeholder} aria-label="What's wrong" autoFocus
      enterKeyHint="go" autoCorrect="off" maxLength={300}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onGo(); }
        else if (isKey(e, 'close', { inField: true })) { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }} />
  );
}
