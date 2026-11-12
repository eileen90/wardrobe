import { useState } from 'react';
import AddSheet from './AddSheet';
import BoardEditor, { placeItem } from './BoardEditor';
import { clearError, useCleanStatus } from './cleaner';
import Closet from './Closet';
import ItemSheet from './ItemSheet';
import Outfits from './Outfits';
import Settings from './Settings';
import { createBoard, getItem, useStore } from './store';
import type { Category } from './types';
import { Icon, Toast } from './ui';

function CleanPill() {
  const st = useCleanStatus();
  if (st.download != null) {
    return (
      <div className="pill">
        <span className="spin" />
        Setting up photo cleanup · {Math.round(st.download * 100)}%
        <small>one-time download</small>
      </div>
    );
  }
  if (st.queued > 0) {
    return (
      <div className="pill">
        <span className="spin" />
        Cleaning {st.queued} photo{st.queued > 1 ? 's' : ''}…
      </div>
    );
  }
  if (st.error) {
    return (
      <button className="pill warn" onClick={clearError}>
        {st.error}
      </button>
    );
  }
  return null;
}

export default function App() {
  const { ready } = useStore();
  const [tab, setTab] = useState<'closet' | 'outfits'>('closet');
  const [cat, setCat] = useState<Category | 'All'>('All');
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);

  async function newBoard(withItem?: string) {
    const item = withItem ? getItem(withItem) : undefined;
    const b = await createBoard(
      item && { layers: [placeItem(item)] },
    );
    setItemId(null);
    setBoardId(b.id);
  }

  if (!ready) return <div className="splash">Wardrobe</div>;

  return (
    <>
      <main className="app">
        {tab === 'closet' ? (
          <Closet
            cat={cat}
            setCat={setCat}
            onOpen={setItemId}
            onAdd={() => setAdding(true)}
            onSettings={() => setSettings(true)}
          />
        ) : (
          <Outfits onOpen={setBoardId} onNew={() => newBoard()} />
        )}
      </main>

      <div className="dock">
        <CleanPill />
        <nav className="nav" aria-label="Main">
          <button className={tab === 'closet' ? 'on' : ''} onClick={() => setTab('closet')}>
            <Icon name="hanger" />
            <span>Closet</span>
          </button>
          <button
            className="fab"
            onClick={() => (tab === 'closet' ? setAdding(true) : newBoard())}
            aria-label={tab === 'closet' ? 'Add a piece' : 'New outfit'}
          >
            <Icon name="plus" size={26} />
          </button>
          <button className={tab === 'outfits' ? 'on' : ''} onClick={() => setTab('outfits')}>
            <Icon name="board" />
            <span>Outfits</span>
          </button>
        </nav>
      </div>

      {boardId && <BoardEditor key={boardId} boardId={boardId} onClose={() => setBoardId(null)} />}

      <AddSheet
        open={adding}
        defaultCat={cat}
        onClose={() => setAdding(false)}
        onAdded={(ids) => {
          setAdding(false);
          setTab('closet');
          if (ids.length === 1) setItemId(ids[0]);
        }}
      />
      <ItemSheet
        itemId={itemId}
        onClose={() => setItemId(null)}
        onStyle={(id) => newBoard(id)}
        onOpenBoard={(id) => {
          setItemId(null);
          setBoardId(id);
        }}
      />
      <Settings open={settings} onClose={() => setSettings(false)} />
      <Toast />
    </>
  );
}
