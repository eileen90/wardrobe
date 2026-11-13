import { deleteLook, keepLook } from '../lib/actions';
import { newLook, placeFresh } from '../lib/boards';
import { saveLook, useStore } from '../lib/store';
import { BOARD_RATIO, type Item, type Look } from '../lib/types';
import { Garment, Icon, Sheet } from '../ui';
import { Mix } from './Mix';

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

/**
 * Looks: one page for outfits. The mixer on top makes them, the saved ones sit right under it.
 */
export function Looks({ hidden, active, startWith, onOpen, onAdd }: {
  hidden: boolean;
  active: boolean;
  startWith: string | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const looks = useStore((s) => s.looks);
  const items = useStore((s) => s.items);

  const create = async () => {
    const l = newLook(looks.length);
    await saveLook(l);
    onOpen(l.id);
  };

  return (
    <div className="looks" hidden={hidden}>
      {/* The saved looks peek over the bottom edge, so it is plain there is more below. */}
      <Mix startWith={startWith} active={active} tall={looks.length ? 'calc(100% - 78px)' : '100%'} onOpenLook={onOpen} onAdd={onAdd} />
      <section className="saved">
        <header className="saved__head">
          <h2>Saved</h2>
          <span className="small muted num">{looks.length}</span>
        </header>
        <div className="looks__grid">
          {looks.map((l) => (
            <button key={l.id} className="lookcard" onClick={() => onOpen(l.id)}
              onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') deleteLook(l.id); }}>
              <MiniBoard look={l} items={items} />
              <span className="lookcard__name">{l.name || 'Untitled'}</span>
            </button>
          ))}
          <button className="lookcard is-new" onClick={create}>
            <div className="lookcard__board"><Icon name="plus" /></div>
            <span className="lookcard__name">Empty board</span>
          </button>
        </div>
      </section>
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
    await keepLook({ ...look, pieces: [...look.pieces, placeFresh(item, look.pieces.length)] }, 'Added to the look');
    onOpen(look.id);
  };

  return (
    <Sheet open={!!itemId} onClose={onClose} label="Add to a look">
      <div className="sheet__head"><h2>Add to a look</h2></div>
      <div className="looks__grid is-tight">
        <button className="lookcard is-new" onClick={() => void addTo(newLook(looks.length))}>
          <div className="lookcard__board"><Icon name="plus" /></div>
          <span className="lookcard__name">New board</span>
        </button>
        {looks.map((l) => (
          <button key={l.id} className="lookcard" onClick={() => void addTo(l)}>
            <MiniBoard look={l} items={items} />
            <span className="lookcard__name">{l.name || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
