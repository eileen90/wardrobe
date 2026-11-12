import { saveLook, useStore } from '../lib/store';
import { BOARD_RATIO, uid, type Item, type Look, type Placed } from '../lib/types';
import { Garment, Icon, Mark, Sheet } from '../ui';

/** A look drawn small: the same placements as the board, in percentages. */
export function MiniBoard({ look, items }: { look: Look; items: Item[] }) {
  return (
    <div className="lookcard__board" style={{ background: look.paper }}>
      {look.pieces.map((p) => {
        const item = items.find((i) => i.id === p.itemId);
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
    </div>
  );
}

export function newLook(n: number, pieces: Placed[] = []): Look {
  return {
    id: uid(), name: `Look ${String(n + 1).padStart(2, '0')}`, createdAt: Date.now(), updatedAt: Date.now(),
    paper: '#ECECEC', pieces,
  };
}

/** Drop a piece in the middle of a board at a sensible size. */
export function placeFresh(item: Item, n = 0): Placed {
  const w = Math.min(0.5, (0.42 * item.aspect) / BOARD_RATIO);
  return { id: uid(), itemId: item.id, x: 0.5 + ((n % 3) - 1) * 0.06, y: 0.48 + ((n % 4) - 1.5) * 0.04, w, rot: 0, flip: false };
}

export function Looks({ onOpen }: { onOpen: (id: string) => void }) {
  const looks = useStore((s) => s.looks);
  const items = useStore((s) => s.items);

  const create = async () => {
    const l = newLook(looks.length);
    await saveLook(l);
    onOpen(l.id);
  };

  if (!looks.length) {
    return (
      <div className="view">
        <div className="empty">
          <Mark className="mark" />
          <p>No looks yet. Save one from mix, or lay pieces out on an empty board.</p>
          <button className="go" onClick={create}><Icon name="plus" />Start a board</button>
        </div>
      </div>
    );
  }

  return (
    <div className="looks">
      <div className="looks__grid">
        {looks.map((l, i) => (
          <button key={l.id} className="lookcard" style={{ ['--i' as string]: i }} onClick={() => onOpen(l.id)}>
            <MiniBoard look={l} items={items} />
            <span>
              <span className="lookcard__name" style={{ display: 'block' }}>{l.name || 'Untitled'}</span>
              <span className="small muted">{l.pieces.length} {l.pieces.length === 1 ? 'piece' : 'pieces'}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="dock" style={{ position: 'fixed' }}>
        <button className="go" onClick={create}><Icon name="plus" />New board</button>
      </div>
    </div>
  );
}

/** Choose which look a piece should join. */
export function PickLook({ itemId, onClose, onOpen }: {
  itemId: string | null;
  onClose: () => void;
  onOpen: (lookId: string) => void;
}) {
  const looks = useStore((s) => s.looks);
  const items = useStore((s) => s.items);
  const item = items.find((i) => i.id === itemId);

  const addTo = async (look: Look) => {
    if (!item) return;
    await saveLook({ ...look, pieces: [...look.pieces, placeFresh(item, look.pieces.length)] });
    onOpen(look.id);
  };

  return (
    <Sheet open={!!itemId} onClose={onClose} label="Add to a look">
      <div className="sheet__head"><h2>Add to a look</h2></div>
      <div className="looks__grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 10px' }}>
        <button className="lookcard" onClick={() => void addTo(newLook(looks.length))}>
          <div className="lookcard__board" style={{ display: 'grid', placeItems: 'center', boxShadow: 'none', border: '1px dashed #000' }}>
            <span style={{ width: 22, height: 22 }}><Icon name="plus" /></span>
          </div>
          <span className="small">New board</span>
        </button>
        {looks.map((l) => (
          <button key={l.id} className="lookcard" onClick={() => void addTo(l)}>
            <MiniBoard look={l} items={items} />
            <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
