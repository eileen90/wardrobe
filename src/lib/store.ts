import { useEffect, useState, useSyncExternalStore } from 'react';
import * as db from './db';
import { parsePrice } from './money';
import type { Item, Look, Settings } from './types';
import { MODELS } from './types';

interface State {
  ready: boolean;
  items: Item[];
  looks: Look[];
  settings: Settings;
}

const DEFAULT_SETTINGS: Settings = { key: '', model: MODELS[0].id, closetView: 'scatter', currency: 'TWD' };

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

/** Bring a piece saved by an earlier version up to date. Returns true if anything changed. */
function upgrade(i: Item): boolean {
  let changed = false;
  if (i.currency === undefined) {
    const p = parsePrice(i.price ?? '');
    i.price = p.amount;
    i.currency = p.currency ?? 'TWD';
    changed = true;
  }
  if (i.kindSure === undefined) {
    i.kindSure = true;
    changed = true;
  }
  // Anything caught mid-run by a closed tab goes back in the queue.
  if (i.state === 'working') i.state = 'queued';
  // Earlier versions gave up on a photo when the studio was out of credits or unreachable.
  // Those belong in the backlog, which finishes them on its own.
  if (i.state === 'raw' && i.problem && /credits|busy|connection|internet/i.test(i.problem)) {
    i.state = 'queued';
    i.problem = undefined;
    changed = true;
  }
  return changed;
}

export async function load() {
  const [all, looks, settings] = await Promise.all([
    db.allItems(),
    db.allLooks(),
    db.getKV<Settings>('settings'),
  ]);
  // A removal whose undo was never used is finished here.
  const items = all.filter((i) => !i.gone);
  const dead = all.filter((i) => i.gone);
  for (const i of items) if (upgrade(i)) void db.putItem(i);
  items.sort((a, b) => b.createdAt - a.createdAt);
  looks.sort((a, b) => b.updatedAt - a.updatedAt);
  set({ ready: true, items, looks, settings: { ...DEFAULT_SETTINGS, ...settings } });
  for (const i of dead) void purge(i.id);
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
/**
 * Take a piece out of the closet. It disappears at once but is only really deleted a little
 * later, so the returned function can put it back exactly as it was.
 */
export function removeItem(id: string): () => void {
  const item = getItem(id);
  if (!item) return () => {};
  const at = state.items.indexOf(item);
  set({ items: state.items.filter((i) => i.id !== id) });
  void db.putItem({ ...item, gone: Date.now() });
  const timer = setTimeout(() => void purge(id), 8000);
  return () => {
    clearTimeout(timer);
    if (getItem(id)) return;
    const items = [...state.items];
    // Whatever the studio was doing with it stopped when it was removed.
    const back: Item = item.state === 'working' ? { ...item, state: 'queued' } : item;
    items.splice(Math.min(at, items.length), 0, back);
    set({ items });
    void db.putItem(back);
  };
}

/** Really delete a removed piece: its pictures, and its place on any board. */
async function purge(id: string) {
  if (getItem(id)) return;
  const touched = state.looks.filter((l) => l.pieces.some((p) => p.itemId === id));
  if (touched.length) {
    const fixed = new Map(touched.map((l) => [l.id, { ...l, pieces: l.pieces.filter((p) => p.itemId !== id) }]));
    set({ looks: state.looks.map((l) => fixed.get(l.id) ?? l) });
    await Promise.all([...fixed.values()].map((l) => db.putLook(l)));
  }
  await db.delItem(id);
  await db.delBlobs(id);
  dropUrls(id);
}

export async function saveLook(look: Look) {
  const next = { ...look, updatedAt: Date.now() };
  const exists = state.looks.some((l) => l.id === look.id);
  set({ looks: exists ? state.looks.map((l) => (l.id === look.id ? next : l)) : [next, ...state.looks] });
  await db.putLook(next);
}
/** Delete a look. The returned function brings it back. */
export function removeLook(id: string): () => void {
  const look = state.looks.find((l) => l.id === id);
  set({ looks: state.looks.filter((l) => l.id !== id) });
  void db.delLook(id);
  return () => {
    if (!look || state.looks.some((l) => l.id === id)) return;
    set({ looks: [look, ...state.looks].sort((a, b) => b.updatedAt - a.updatedAt) });
    void db.putLook(look);
  };
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
