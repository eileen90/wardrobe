import { useEffect, useState, useSyncExternalStore } from 'react';
import * as db from './db';
import type { Board, Item } from './types';
import { uid } from './types';

interface State {
  ready: boolean;
  items: Item[];
  boards: Board[];
}
let state: State = { ready: false, items: [], boards: [] };
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export const getState = () => state;
export function useStore(): State {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

export async function init() {
  const [items, boards] = await Promise.all([db.loadItems(), db.loadBoards()]);
  items.sort((a, b) => b.createdAt - a.createdAt);
  boards.sort((a, b) => b.updatedAt - a.updatedAt);
  set({ ready: true, items, boards });
  // Ask the browser not to evict our photos under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

// ---- items ----
export const getItem = (id: string) => state.items.find((i) => i.id === id);
export async function addItem(item: Item) {
  set({ items: [item, ...state.items] });
  await db.putItem(item);
}
export async function updateItem(id: string, patch: Partial<Item>) {
  const cur = getItem(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  set({ items: state.items.map((i) => (i.id === id ? next : i)) });
  await db.putItem(next);
}
export async function removeItem(id: string) {
  set({ items: state.items.filter((i) => i.id !== id) });
  await db.delItem(id);
  await Promise.all(
    ['orig', 'orig:t', 'cut', 'cut:t'].map((s) => db.delBlob(`${id}:${s}`)),
  );
}

// ---- boards ----
export const getBoard = (id: string) => state.boards.find((b) => b.id === id);
export async function createBoard(partial?: Partial<Board>): Promise<Board> {
  const now = Date.now();
  const b: Board = {
    id: uid(),
    name: '',
    bg: 'paper',
    layers: [],
    createdAt: now,
    updatedAt: now,
    rev: 0,
    ...partial,
  };
  set({ boards: [b, ...state.boards] });
  await db.putBoard(b);
  return b;
}
export async function updateBoard(id: string, patch: Partial<Board>) {
  const cur = getBoard(id);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  set({
    boards: [next, ...state.boards.filter((b) => b.id !== id)],
  });
  await db.putBoard(next);
}
export async function removeBoard(id: string) {
  set({ boards: state.boards.filter((b) => b.id !== id) });
  await db.delBoard(id);
  await db.delBlob(`board:${id}:t`);
}
export async function reload() {
  set({ ready: false });
  await init();
}

// ---- image helpers ----
/** Key of the picture to show for an item. */
export function imgKey(item: Item, thumb = false) {
  const v = item.view === 'cut' && item.hasCut ? 'cut' : 'orig';
  return `${item.id}:${v}${thumb ? ':t' : ''}`;
}
export const showsCut = (item: Item) => item.view === 'cut' && item.hasCut;
export const itemAspect = (item: Item) =>
  (showsCut(item) ? item.cutAspect : item.origAspect) || 1;

/** Resolve a stored picture to an object URL. `rev` forces a refresh. */
export function useBlobUrl(key: string | null, rev = 0): string | null {
  const [url, setUrl] = useState<string | null>(() => (key ? db.cachedUrl(key) : null));
  useEffect(() => {
    let live = true;
    if (!key) {
      setUrl(null);
      return;
    }
    const hit = db.cachedUrl(key);
    setUrl(hit);
    if (!hit) db.blobUrl(key).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [key, rev]);
  return url;
}
