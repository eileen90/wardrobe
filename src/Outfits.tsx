import { useBlobUrl, useStore } from './store';
import type { Board } from './types';
import { Icon } from './ui';

function BoardCard({ board, onClick }: { board: Board; onClick: () => void }) {
  const url = useBlobUrl(`board:${board.id}:t`, board.rev);
  const n = board.layers.filter((l) => l.kind === 'item').length;
  return (
    <button className="tile" onClick={onClick}>
      <div className="board-card">{url && <img src={url} alt="" draggable={false} />}</div>
      <div className="tile-cap">
        <span className="tile-name">{board.name || 'Untitled outfit'}</span>
        <span className="tile-sub">
          {n} {n === 1 ? 'piece' : 'pieces'}
        </span>
      </div>
    </button>
  );
}

export default function Outfits({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { boards } = useStore();
  return (
    <div className="page">
      <header className="head">
        <div>
          <p className="eyebrow">
            {boards.length ? `${boards.length} ${boards.length === 1 ? 'board' : 'boards'}` : 'Plan & play'}
          </p>
          <h1>Outfits</h1>
        </div>
      </header>
      {boards.length === 0 ? (
        <div className="empty">
          <div className="empty-art">
            <Icon name="board" size={54} />
          </div>
          <h2>A blank board, waiting.</h2>
          <p>Drop pieces from your closet onto a board, move them around and see what works together.</p>
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={18} /> New outfit
          </button>
        </div>
      ) : (
        <div className="grid">
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} onClick={() => onOpen(b.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
