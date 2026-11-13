import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { editPiece, redoPiece, removePiece, stopStudio } from '../lib/actions';
import { brandFromSite, cleanUrl, siteOf } from '../lib/links';
import { CURRENCIES, groupDigits, parsePrice, signOf } from '../lib/money';
import { saveSettings, useStore } from '../lib/store';
import { CATEGORIES, costOf, MODELS, REDO_MODEL, type Item } from '../lib/types';
import { Garment, Icon, toast } from '../ui';

/** A text field that saves as you leave it, so typing never fights the store. */
function Field({ value, onSave, placeholder, area, className, label }: {
  value: string; onSave: (v: string) => void; placeholder: string; area?: boolean; className?: string; label: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const props = {
    value: v, placeholder, className, 'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => v.trim() !== value && onSave(v.trim()),
  };
  return area
    ? <textarea rows={2} {...props} />
    : <input {...props} autoCorrect="off" enterKeyHint="done"
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

/** A number and a currency bubble. Pasting "¥4,990" sets both. */
function Price({ item }: { item: Item }) {
  const [v, setV] = useState(groupDigits(item.price));
  const [choosing, setChoosing] = useState(false);
  useEffect(() => setV(groupDigits(item.price)), [item.price]);
  const setCurrency = (currency: string) => {
    editPiece(item.id, { currency }, { label: 'Currency' });
    void saveSettings({ currency });
    setChoosing(false);
  };
  const commit = () => {
    const p = parsePrice(v);
    setV(groupDigits(p.amount));
    if (p.amount !== item.price || (p.currency && p.currency !== item.currency)) {
      editPiece(item.id, { price: p.amount, currency: p.currency ?? item.currency }, { label: 'Price' });
      if (p.currency) void saveSettings({ currency: p.currency });
    }
  };
  return (
    <div className="price">
      <div className="price__row">
        <button className="bubble" aria-label={`Currency: ${item.currency}`} aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}>{signOf(item.currency)}</button>
        <input value={v} placeholder="0" inputMode="decimal" aria-label="Price" enterKeyHint="done" autoCorrect="off"
          onChange={(e) => setV(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      {choosing && (
        <div className="chips">
          {CURRENCIES.map((c) => (
            <button key={c.code} className="pill" aria-pressed={c.code === item.currency} onClick={() => setCurrency(c.code)}>
              {c.sign}<span style={{ opacity: 0.55 }}>{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A pasted link becomes the shop's name; the address itself stays out of sight. */
function LinkField({ item }: { item: Item }) {
  const [v, setV] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const commit = (text: string) => {
    if (!text.trim()) return;
    const url = cleanUrl(text);
    if (!url) return toast("That doesn't look like a link");
    setV('');
    editPiece(item.id, { url, ...(item.brand ? {} : { brand: brandFromSite(url) }) }, { label: 'Link' });
  };
  if (item.url) {
    return (
      <div className="linkchip">
        <a className="pill" href={item.url} target="_blank" rel="noreferrer">{siteOf(item.url)}<Icon name="out" /></a>
        <button className="iconbtn is-small" aria-label="Remove the link"
          onClick={() => { editPiece(item.id, { url: '' }, { label: 'Link removed', toast: true }); setTimeout(() => input.current?.focus(), 0); }}>
          <Icon name="x" />
        </button>
      </div>
    );
  }
  return (
    <input ref={input} value={v} placeholder="Paste a link" inputMode="url" autoCapitalize="off" autoCorrect="off"
      aria-label="Link" enterKeyHint="done"
      onChange={(e) => setV(e.target.value)}
      onPaste={(e) => { const t = e.clipboardData.getData('text'); if (cleanUrl(t)) { e.preventDefault(); commit(t); } }}
      onBlur={() => commit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

/**
 * Redo the picture. It uses the most faithful model unless you pick another, compares the last
 * attempt with the photo to find what went wrong, and takes your words into account if you add any.
 */
function Redo({ item, onClose }: { item: Item; onClose: () => void }) {
  const [model, setModel] = useState(REDO_MODEL);
  const [note, setNote] = useState('');
  const go = () => {
    void redoPiece(item.id, { model, note: note.trim() });
    onClose();
  };
  return (
    <div className="redo">
      <div className="chips is-row" role="group" aria-label="Model">
        {MODELS.map((m) => (
          <button key={m.id} className="pill" aria-pressed={model === m.id} title={m.hint} onClick={() => setModel(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="note">{MODELS.find((m) => m.id === model)?.hint}. {costOf(model)} credits.
        {item.state === 'ready' && ' It compares the last picture with your photo and fixes what it finds.'}</p>
      <input className="input" value={note} placeholder="What's wrong? (optional, e.g. sleeves cut off)" aria-label="What's wrong"
        enterKeyHint="go" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <div className="slip__acts">
        <button className="pill is-on" onClick={go}><Icon name="turn" />redo it</button>
        <button className="pill" onClick={onClose}>not now</button>
      </div>
    </div>
  );
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(t.tagName);

export function Focus({ id, from, sequence, onGo, onClose, onMix, onAddToLook }: {
  id: string;
  from: DOMRect | null;
  /** the pieces around this one, in the order the closet shows them */
  sequence: string[];
  onGo: (id: string) => void;
  onClose: () => void;
  onMix: (id: string) => void;
  onAddToLook: (id: string) => void;
}) {
  const item = useStore((s) => s.items.find((i) => i.id === id));
  const hasKey = useStore((s) => !!s.settings.key);
  const fig = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [redoing, setRedoing] = useState(false);
  useEffect(() => setRedoing(false), [id]);
  const turned = useRef(0);
  const first = useRef(true);

  const at = sequence.indexOf(id);
  const go = (d: number) => {
    if (sequence.length < 2 || at < 0) return;
    turned.current = d;
    onGo(sequence[(at + d + sequence.length) % sequence.length]);
  };

  useLayoutEffect(() => {
    const el = fig.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (first.current) {
      first.current = false;
      // Grow from where the piece was lying on the floor.
      if (!from) return;
      const to = el.getBoundingClientRect();
      const s = Math.min(from.width / to.width, from.height / to.height);
      const dx = from.left + from.width / 2 - (to.left + (to.width * s) / 2);
      const dy = from.top + from.height / 2 - (to.top + (to.height * s) / 2);
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }],
        { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    } else if (turned.current) {
      // The next piece slides in from the side it was called from.
      el.animate(
        [{ transform: `translateX(${turned.current * 60}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onClose, 200);
  };
  const remove = () => {
    // Move on to the neighbour, or close when this was the only one.
    const next = sequence.length > 1 && at >= 0 ? sequence[(at + 1) % sequence.length] : null;
    removePiece(id);
    if (next && next !== id) { turned.current = 1; onGo(next); } else onClose();
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (typing(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // A sideways swipe over the piece turns to its neighbour.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeEnd = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 6) close();
  };

  if (!item) return null;
  const save = (patch: Partial<Item>, label?: string) => editPiece(item.id, patch, label ? { label, toast: true } : {});
  const waiting = item.state === 'queued' || item.state === 'working';

  return (
    <div className={'focus' + (leaving ? ' is-leaving' : '')} role="dialog" aria-modal="true" aria-label={item.name || 'Piece'}>
      <button className="close" onClick={close} aria-label="Close"><Icon name="x" /></button>

      <div className="focus__stage"
        onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={swipeEnd} onPointerCancel={() => { swipe.current = null; }}>
        <div className="focus__fig" ref={fig}>
          <Garment item={item} size="full" />
        </div>
        {sequence.length > 1 && at >= 0 && (
          <>
            <button className="turn is-prev" aria-label="Previous piece" onPointerUp={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)}><Icon name="left" /></button>
            <button className="turn is-next" aria-label="Next piece" onPointerUp={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}><Icon name="right" /></button>
          </>
        )}
      </div>

      <aside className="slip">
        <div className="slip__scroll" key={item.id}>
          <Field className="slip__name" label="Name" value={item.name} placeholder="Name" onSave={(name) => save({ name })} />

          {item.problem && item.state === 'raw' && <p className="problem">{item.problem}</p>}

          <div className="chips is-row">
            {CATEGORIES.map((c) => (
              <button key={c.id} className="pill" aria-pressed={item.category === c.id}
                onClick={() => save({ category: c.id, kindSure: true }, `Moved to ${c.plural}`)}>{c.label}</button>
            ))}
          </div>

          <div className="lines">
            <div className="line">
              <span>It is</span>
              <div className="seg" role="group">
                <button aria-pressed={item.status === 'owned'} onClick={() => save({ status: 'owned' }, 'Marked as mine')}>mine</button>
                <button aria-pressed={item.status === 'wish'} onClick={() => save({ status: 'wish' }, 'On the wishlist')}>on my wishlist</button>
              </div>
            </div>
            <div className="line">
              <span>Brand</span>
              <Field label="Brand" value={item.brand} placeholder="Add" onSave={(brand) => save({ brand })} />
            </div>
            <div className="line">
              <span>Price</span>
              <Price item={item} />
            </div>
            <div className="line">
              <span>Link</span>
              <LinkField item={item} />
            </div>
            <div className="line">
              <span>Notes</span>
              <Field area label="Notes" value={item.note} placeholder="Add" onSave={(note) => save({ note })} />
            </div>
          </div>

          <div className="slip__acts">
            <button className="pill is-on" onClick={() => onAddToLook(item.id)}>add to a look</button>
            <button className="pill" disabled={item.state !== 'ready'} onClick={() => onMix(item.id)}>mix with it</button>
            {hasKey && !waiting && !redoing && (
              <button className="pill" onClick={() => setRedoing(true)}>
                <Icon name="turn" />redo the picture
              </button>
            )}
            {waiting && (
              <button className="pill" onClick={() => void stopStudio([item.id])}><Icon name="x" />stop cleaning</button>
            )}
            <button className="pill" onClick={remove}><Icon name="bin" />remove</button>
          </div>
          {redoing && !waiting && <Redo item={item} onClose={() => setRedoing(false)} />}
        </div>
      </aside>
    </div>
  );
}
