import { useEffect, useRef } from 'react';
import type { Item } from '../lib/types';
import { Garment, Icon } from '../ui';

/** A padlock, open or shut. Drawn here so the shared icon set stays as it is. */
export function Lock({ shut }: { shut: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={shut ? 'M7.5 11V8a4.5 4.5 0 019 0v3M5.5 11h13v9.5h-13z' : 'M7.5 11V8a4.5 4.5 0 018.7-1.6M5.5 11h13v9.5h-13z'} />
    </svg>
  );
}

/**
 * Every piece of one rail at once, in a glass strip under the outfit. Picking one puts it on at
 * once and the strip stays open, so pieces can be tried one after another.
 */
export function RailPicker({ title, pool, current, on, kept, onPick, onKeep, onClear, onClose }: {
  title: string;
  pool: Item[];
  current: number;
  /** false while the rail is cleared */
  on: boolean;
  kept: boolean;
  onPick: (index: number) => void;
  onKeep: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Keep the piece that is on show in view.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [current, on]);

  return (
    <div className="pick glass" role="dialog" aria-label={`Choose ${title}`}>
      <div className="pick__head">
        <span className="pick__title">{title}</span>
        <span className="pick__count num">{on ? String(current + 1).padStart(2, '0') : '–'} / {String(pool.length).padStart(2, '0')}</span>
        <span className="pick__gap" />
        <button className="pill" aria-pressed={kept} disabled={!on} onClick={onKeep}><Lock shut={kept} />{kept ? 'kept' : 'keep'}</button>
        <button className="pill" disabled={!on} onClick={onClear}><Icon name="x" />clear</button>
        <button className="pick__close" aria-label="Done" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="pick__strip" ref={strip}>
        {pool.map((it, i) => (
          <button key={it.id} className="pick__item" aria-current={on && i === current} aria-label={it.name || `${title} ${i + 1}`}
            onClick={() => onPick(i)}>
            <Garment item={it} small />
            {it.status === 'wish' && <span className="tag">wishlist</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
