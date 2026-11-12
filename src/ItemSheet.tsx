import { useEffect, useState } from 'react';
import { reclean } from './cleaner';
import { removeItem, updateItem, useBlobUrl, useStore } from './store';
import { CATEGORIES, type Board, type Item } from './types';
import { Icon, ItemImage, Segmented, Sheet } from './ui';

function BoardThumb({ board, onClick }: { board: Board; onClick: () => void }) {
  const url = useBlobUrl(`board:${board.id}:t`, board.rev);
  return (
    <button className="mini-board" onClick={onClick} aria-label={board.name || 'Untitled outfit'}>
      {url && <img src={url} alt="" />}
    </button>
  );
}

export default function ItemSheet({
  itemId, onClose, onStyle, onOpenBoard,
}: {
  itemId: string | null;
  onClose: () => void;
  onStyle: (id: string) => void;
  onOpenBoard: (id: string) => void;
}) {
  const { items, boards } = useStore();
  // Keep showing the last item while the sheet animates closed.
  const [last, setLast] = useState<Item | null>(null);
  const live = items.find((i) => i.id === itemId) ?? null;
  useEffect(() => {
    if (live) setLast(live);
  }, [live]);
  const item = live ?? last;
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => setConfirmDel(false), [itemId]);

  if (!item) return null;
  const set = (p: Partial<Item>) => updateItem(item.id, p);
  const used = boards.filter((b) => b.layers.some((l) => l.kind === 'item' && l.itemId === item.id));

  return (
    <Sheet open={!!live} onClose={onClose} tall label="Piece details">
      <div className="sheet-body item-sheet">
        <div className={`hero ${item.state === 'cleaning' ? 'cleaning' : ''}`}>
          <ItemImage item={item} full />
          {item.status === 'wish' && <span className="tag">Wishlist</span>}
          {item.hasCut && item.state === 'ready' && (
            <div className="hero-toggle">
              <Segmented
                value={item.view}
                onChange={(view) => set({ view })}
                options={[
                  { value: 'cut', label: 'Clean' },
                  { value: 'orig', label: 'Original' },
                ]}
              />
            </div>
          )}
          {item.state === 'cleaning' && (
            <span className="tile-note">
              <Icon name="spark" size={14} /> Cleaning up the photo…
            </span>
          )}
          {item.state === 'failed' && (
            <button className="btn small hero-retry" onClick={() => reclean(item.id)}>
              <Icon name="retry" size={16} /> Try cleaning again
            </button>
          )}
        </div>

        <input
          className="name-input"
          placeholder="Name this piece"
          value={item.name}
          onChange={(e) => set({ name: e.target.value })}
          aria-label="Name"
        />
        {item.colors.length > 0 && (
          <div className="swatches" aria-label="Colours">
            {item.colors.map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </div>
        )}

        <button className="btn primary wide" onClick={() => onStyle(item.id)}>
          <Icon name="board" size={18} />
          {item.status === 'wish' ? 'See what it goes with' : 'Style it on a new board'}
        </button>

        <Segmented
          value={item.status}
          onChange={(status) => set({ status })}
          options={[
            { value: 'owned', label: 'I own it' },
            { value: 'wish', label: 'Wishlist' },
          ]}
        />
        <div className="chips wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`chip ${item.category === c ? 'on' : ''}`}
              onClick={() => set({ category: c })}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="fields">
          <label>
            <span>Brand</span>
            <input value={item.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="—" />
          </label>
          <label>
            <span>Price</span>
            <input value={item.price} onChange={(e) => set({ price: e.target.value })} placeholder="—" />
          </label>
          <label className="span2">
            <span>Link</span>
            <div className="with-btn">
              <input
                type="url"
                inputMode="url"
                value={item.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="Where it's from"
              />
              {/^https?:\/\//.test(item.url) && (
                <a className="icon-btn" href={item.url} target="_blank" rel="noreferrer" aria-label="Open link">
                  <Icon name="open" size={18} />
                </a>
              )}
            </div>
          </label>
          <label className="span2">
            <span>Notes</span>
            <textarea
              rows={2}
              value={item.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Size, fit, what it needs…"
            />
          </label>
        </div>

        {used.length > 0 && (
          <section>
            <p className="eyebrow">In {used.length} outfit{used.length > 1 ? 's' : ''}</p>
            <div className="mini-boards">
              {used.map((b) => (
                <BoardThumb key={b.id} board={b} onClick={() => onOpenBoard(b.id)} />
              ))}
            </div>
          </section>
        )}

        <div className="danger-row">
          {item.state !== 'cleaning' && (
            <button className="btn ghost" onClick={() => reclean(item.id)}>
              <Icon name="spark" size={16} /> Clean again
            </button>
          )}
          {confirmDel ? (
            <button
              className="btn danger"
              onClick={() => {
                onClose();
                void removeItem(item.id);
              }}
            >
              Yes, remove it
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" size={16} /> Remove
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
