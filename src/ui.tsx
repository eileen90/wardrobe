import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  prev: 'M17 3 4 17l13 14',
  next: 'M7 3l13 14L7 31',
};

export function Icon({ name, box = '0 0 24 24' }: { name: keyof typeof PATHS | string; box?: string }) {
  return (
    <svg viewBox={box} fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.4 : 1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The mark: a coat hanger in one line. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 112 66" fill="none" stroke="currentColor" strokeWidth="3.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M46 15a10 10 0 1110 10v9" />
      <path d="M56 34l48 21a3 3 0 01-1.2 5.8H9.2A3 3 0 018 55z" />
    </svg>
  );
}

/* ---------- a piece, however far along it is ---------- */

export function Garment({ item, size = 'thumb', small }: { item: Item; size?: 'thumb' | 'full'; small?: boolean }) {
  const url = usePic(item, size);
  // A piece that comes back from the studio while you watch is wiped in from the top.
  const was = useRef(item.state);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (item.state === 'ready' && was.current !== 'ready') setFresh(true);
    was.current = item.state;
  }, [item.state]);
  if (item.state === 'ready') {
    return url
      ? <img className={'garment' + (small ? ' is-small' : '') + (fresh ? ' is-fresh' : '')} src={url} alt={item.name}
          draggable={false} onAnimationEnd={() => setFresh(false)} />
      : null;
  }
  const developing = item.state === 'queued' || item.state === 'working';
  return (
    <div className={'print' + (developing ? ' is-developing' : '')}>
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
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
  }, action ? 4200 : 2600);
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
        <button onClick={() => { show.action!.run(); toastState = null; toastSubs.forEach((f) => f()); }}>
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
