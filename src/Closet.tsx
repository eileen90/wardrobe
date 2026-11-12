import { useMemo, useState } from 'react';
import { useStore } from './store';
import { CATEGORIES, type Category, type Item } from './types';
import { Icon, ItemImage, Segmented } from './ui';

export type StatusFilter = 'all' | 'owned' | 'wish';

export function ItemTile({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <button className="tile" onClick={onClick}>
      <div className={`tile-img ${item.state === 'cleaning' ? 'cleaning' : ''}`}>
        <ItemImage item={item} />
        {item.status === 'wish' && <span className="tag">Wishlist</span>}
        {item.state === 'cleaning' && (
          <span className="tile-note">
            <Icon name="spark" size={14} /> Cleaning…
          </span>
        )}
        {item.state === 'failed' && <span className="tile-note">Original photo</span>}
      </div>
      <div className="tile-cap">
        <span className="tile-name">{item.name || item.category}</span>
        {(item.brand || item.price) && (
          <span className="tile-sub">{[item.brand, item.price].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    </button>
  );
}

export default function Closet({
  onOpen, onAdd, onSettings, cat, setCat,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  cat: Category | 'All';
  setCat: (c: Category | 'All') => void;
}) {
  const { items } = useStore();
  const [status, setStatus] = useState<StatusFilter>('all');

  const byStatus = useMemo(
    () => items.filter((i) => status === 'all' || i.status === status),
    [items, status],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of byStatus) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return m;
  }, [byStatus]);
  const shown = byStatus.filter((i) => cat === 'All' || i.category === cat);
  const owned = items.filter((i) => i.status === 'owned').length;
  const wish = items.length - owned;

  return (
    <div className="page">
      <header className="head">
        <div>
          <p className="eyebrow">
            {items.length === 0
              ? 'Your wardrobe'
              : `${owned} ${owned === 1 ? 'piece' : 'pieces'}${wish ? ` · ${wish} on the wishlist` : ''}`}
          </p>
          <h1>Closet</h1>
        </div>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </header>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-art">
            <Icon name="hanger" size={54} />
          </div>
          <h2>Start with one piece.</h2>
          <p>
            Snap a photo of something you own, or paste a picture of something you're eyeing. It
            gets cut out cleanly, ready for your boards.
          </p>
          <button className="btn primary" onClick={onAdd}>
            <Icon name="plus" size={18} /> Add your first piece
          </button>
        </div>
      ) : (
        <>
          <div className="filters">
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'owned', label: 'Mine' },
                { value: 'wish', label: 'Wishlist' },
              ]}
            />
          </div>
          <div className="chips">
            <button className={`chip ${cat === 'All' ? 'on' : ''}`} onClick={() => setCat('All')}>
              All <i>{byStatus.length}</i>
            </button>
            {CATEGORIES.filter((c) => counts.get(c) || c === cat).map((c) => (
              <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
                {c} <i>{counts.get(c) ?? 0}</i>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="none">Nothing here yet.</p>
          ) : (
            <div className="grid">
              {shown.map((i) => (
                <ItemTile key={i.id} item={i} onClick={() => onOpen(i.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
