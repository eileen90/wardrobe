import { useState } from 'react';
import { deleteLook, keepLook } from '../lib/actions';
import { isKey } from '../lib/shortcuts';
import { addPiece, newLook } from '../lib/boards';
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
 * Looks: the outfit being put together fills the page; saved looks open from a sheet, each on
 * its own board on top, so the outfit here is never touched by them.
 */
export function Looks({ hidden, active, startWith, onOpen, onFocus, onAdd }: {
  hidden: boolean;
  active: boolean;
  startWith: string | null;
  onOpen: (id: string) => void;
  onFocus: (id: string, from: DOMRect, sequence: string[]) => void;
  onAdd: () => void;
}) {
  const looks = useStore((s) => s.looks);
  const items = useStore((s) => s.items);
  const [list, setList] = useState(false);

  const open = (id: string) => { setList(false); onOpen(id); };
  const create = async () => {
    const l = newLook(looks.length);
    await saveLook(l);
    open(l.id);
  };

  return (
    <div className="looks" hidden={hidden}>
      <Mix startWith={startWith} active={active && !list} onSaved={open} onFocus={onFocus} onAdd={onAdd}>
        <button className="round glass is-quiet" aria-label="Saved looks" title="Saved looks" onClick={() => setList(true)}>
          <Icon name="looks" />{looks.length > 0 && <span className="dot is-quiet">{looks.length}</span>}
        </button>
      </Mix>
      <Sheet open={list} onClose={() => setList(false)} label="Saved looks">
        <div className="sheet__head"><h2>Saved</h2><span className="small muted num">{looks.length}</span></div>
        <div className="looks__grid is-tight">
          {looks.map((l) => (
            <button key={l.id} className="lookcard" onClick={() => open(l.id)}
              onKeyDown={(e) => { if (isKey(e, 'remove')) deleteLook(l.id); }}>
              <MiniBoard look={l} items={items} />
              <span className="lookcard__name">{l.name || 'Untitled'}</span>
            </button>
          ))}
          <button className="lookcard is-new" onClick={create}>
            <div className="lookcard__board"><Icon name="plus" /></div>
            <span className="lookcard__name">Empty board</span>
          </button>
        </div>
      </Sheet>
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
    await keepLook({ ...look, pieces: addPiece(look.pieces, items, item) }, 'Added to the look');
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
