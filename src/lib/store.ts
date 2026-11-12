import { useEffect, useState, useSyncExternalStore } from 'react';
import * as db from './db';
import type { Item, Look, Settings } from './types';
import { MODELS } from './types';

interface State {
  ready: boolean;
  items: Item[];
  looks: Look[];
  settings: Settings;
}

const DEFAULT_SETTINGS: Settings = { key: '', model: MODELS[0].id, closetView: 'scatter' };

let state: State = { ready: false, items: [], looks: [], settings: DEFAULT_SETTINGS };
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

export const getState = () => state;
export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

export async function load() {
  const [items, looks, settings] = await Promise.all([
    db.allItems(),
    db.allLooks(),
    db.getKV<Settings>('settings'),
  ]);
  items.sort((a, b) => b.createdAt - a.createdAt);
  looks.sort((a, b) => b.updatedAt - a.updatedAt);
  // Anything caught mid-run by a closed tab goes back in the queue.
  for (const i of items) if (i.state === 'working') i.state = 'queued';
  set({ ready: true, items, looks, settings: { ...DEFAULT_SETTINGS, ...settings } });
  // Ask the browser not to evict the closet when storage runs low.
  void navigator.storage?.persist?.();
}

export const getItem = (id: string) => state.items.find((i) => i.id === id);

export async function addItem(item: Item) {
  await db.putItem(item);
  set({ items: [item, ...state.items] });
}
export async function updateItem(id: string, patch: Partial<Item>) {
  const cur = getItem(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  set({ items: state.items.map((i) => (i.id === id ? next : i)) });
  await db.putItem(next);
}
export async function removeItem(id: string) {
  set({
    items: state.items.filter((i) => i.id !== id),
    looks: state.looks.map((l) =>
      l.pieces.some((p) => p.itemId === id)
        ? { ...l, pieces: l.pieces.filter((p) => p.itemId !== id) }
        : l,
    ),
  });
  await db.delItem(id);
  await db.delBlobs(id);
  await Promise.all(state.looks.map((l) => db.putLook(l)));
  dropUrls(id);
}

export async function saveLook(look: Look) {
  const next = { ...look, updatedAt: Date.now() };
  const exists = state.looks.some((l) => l.id === look.id);
  set({ looks: exists ? state.looks.map((l) => (l.id === look.id ? next : l)) : [next, ...state.looks] });
  await db.putLook(next);
}
export async function removeLook(id: string) {
  set({ looks: state.looks.filter((l) => l.id !== id) });
  await db.delLook(id);
}

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  await db.setKV('settings', settings);
}

/* ---------- picture URLs ---------- */

const urls = new Map<string, string>();
function dropUrls(id: string) {
  for (const [k, u] of urls) {
    if (k.startsWith(id + ':')) {
      // Give pictures still on screen a moment to swap before the old URL dies.
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      urls.delete(k);
    }
  }
}
/** Call after an item's pictures were rewritten. */
export const refreshPics = dropUrls;

export async function picUrl(item: Item, want: 'thumb' | 'full'): Promise<string | null> {
  const kind: db.Pic = item.state === 'ready' ? (want === 'thumb' ? 'thumb' : 'cut') : 'raw';
  const key = `${item.id}:${kind}:${item.rev}`;
  const hit = urls.get(key);
  if (hit) return hit;
  const blob = await db.getBlob(`${item.id}:${kind}`);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(key, u);
  return u;
}

/** Object URL for an item's picture: the cut-out when there is one, else the photo. */
export function usePic(item: Item | undefined, want: 'thumb' | 'full' = 'thumb') {
  const [url, setUrl] = useState<string | null>(null);
  const id = item?.id;
  const rev = item?.rev;
  const st = item?.state;
  useEffect(() => {
    let on = true;
    if (!item) return setUrl(null);
    void picUrl(item, want).then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rev, st, want]);
  return url;
}
