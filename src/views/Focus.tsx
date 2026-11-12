import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { removeItem, updateItem, useStore } from '../lib/store';
import { redo } from '../lib/studio';
import { CATEGORIES, catLabel, type Item } from '../lib/types';
import { Garment, Icon, toast } from '../ui';

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A text field that saves as you leave it, so typing never fights the store. */
function Field({ value, onSave, placeholder, area, className, inputMode }: {
  value: string; onSave: (v: string) => void; placeholder: string; area?: boolean; className?: string;
  inputMode?: 'decimal' | 'url' | 'text';
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const props = {
    value: v, placeholder, className,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => v !== value && onSave(v.trim()),
  };
  return area
    ? <textarea rows={2} {...props} />
    : <input {...props} inputMode={inputMode} autoCapitalize={inputMode === 'url' ? 'off' : undefined}
        autoCorrect="off" enterKeyHint="done"
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function Focus({ id, from, onClose, onMix, onAddToLook }: {
  id: string;
  from: DOMRect | null;
  onClose: () => void;
  onMix: (id: string) => void;
  onAddToLook: (id: string) => void;
}) {
  const item = useStore((s) => s.items.find((i) => i.id === id));
  const looks = useStore((s) => s.looks);
  const fig = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  // Grow from where the piece was lying on the floor.
  useLayoutEffect(() => {
    const el = fig.current;
    if (!el || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = el.getBoundingClientRect();
    const s = Math.min(from.width / to.width, from.height / to.height);
    const dx = from.left + from.width / 2 - (to.left + (to.width * s) / 2);
    const dy = from.top + from.height / 2 - (to.top + (to.height * s) / 2);
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }],
      { duration: 850, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onClose, 260);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!item) return null;
  const save = (patch: Partial<Item>) => void updateItem(item.id, patch);
  const inLooks = looks.filter((l) => l.pieces.some((p) => p.itemId === item.id)).length;
  const busy = item.state === 'queued' || item.state === 'working';

  return (
    <div className={'focus' + (leaving ? ' is-leaving' : '')} role="dialog" aria-modal="true" aria-label={item.name || 'Piece'}>
      <div className="focus__top">
        <span />
        <button className="close" onClick={close} aria-label="Close"><Icon name="x" /></button>
      </div>

      <div className="focus__stage" onClick={close}>
        <div className="focus__fig" ref={fig}>
          <Garment item={item} size="full" />
        </div>
      </div>

      <aside className="slip">
        <div className="slip__scroll">
          <Field className="slip__name" value={item.name} placeholder="Name this piece" onSave={(name) => save({ name })} />
          <p className="slip__meta small muted">
            {catLabel(item.category)} · {item.status === 'wish' ? 'on the wishlist' : 'in the closet'}
            {inLooks > 0 && ` · in ${inLooks} ${inLooks === 1 ? 'look' : 'looks'}`}
          </p>

          {item.problem && item.state === 'raw' && <p className="problem">{item.problem}</p>}

          <div className="line">
            <span>Kind</span>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button key={c.id} className="pill" aria-pressed={item.category === c.id}
                  onClick={() => save({ category: c.id })}>{c.label}</button>
              ))}
            </div>
          </div>
          <div className="line">
            <span>It is</span>
            <div className="chips">
              <button className="pill" aria-pressed={item.status === 'owned'} onClick={() => save({ status: 'owned' })}>mine</button>
              <button className="pill" aria-pressed={item.status === 'wish'} onClick={() => save({ status: 'wish' })}>on my wishlist</button>
            </div>
          </div>
          <div className="line">
            <span>Brand</span>
            <Field value={item.brand} placeholder="Add a brand" onSave={(brand) => save({ brand })} />
          </div>
          <div className="line">
            <span>Price</span>
            <Field value={item.price} placeholder="What it costs" onSave={(price) => save({ price })} />
          </div>
          <div className="line">
            <span>Link</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Field value={item.url} placeholder="Where to buy it" inputMode="url" onSave={(url) => save({ url })} />
              {item.url && (
                <a className="pill" href={/^https?:/.test(item.url) ? item.url : `https://${item.url}`} target="_blank" rel="noreferrer">open</a>
              )}
            </div>
          </div>
          <div className="line">
            <span>Notes</span>
            <Field area value={item.note} placeholder="Fit, care, where it came from" onSave={(note) => save({ note })} />
          </div>
          {item.colors.length > 0 && (
            <div className="line">
              <span>Colours</span>
              <div className="dots">{item.colors.map((c) => <i key={c} style={{ background: c }} />)}</div>
            </div>
          )}

          <div className="slip__acts">
            <button className="pill is-on" onClick={() => onAddToLook(item.id)}>add to a look</button>
            <button className="pill" disabled={item.state !== 'ready'} onClick={() => onMix(item.id)}>try it in mix</button>
            <button className="pill" disabled={busy}
              onClick={() => { void redo(item.id, 'remake'); toast('Back in the studio'); }}>
              <Icon name="turn" />{item.state === 'raw' ? 'clean this photo' : 'remake the picture'}
            </button>
            {confirm
              ? <button className="pill is-danger" onClick={() => { void removeItem(item.id); toast('Removed'); onClose(); }}>yes, remove it</button>
              : <button className="pill" onClick={() => setConfirm(true)}>remove</button>}
          </div>

          <div className="slip__foot">
            <span className="barcode" />
            <span className="small muted">
              Added {DAY.format(item.createdAt)}{item.remade ? ' · remade by the studio' : ''}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
