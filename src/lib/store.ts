import { useEffect, useState, useSyncExternalStore } from 'react';
import { startCloud, touch } from './cloud';
import * as db from './db';
import { kindFromWords } from './kind';
import { parsePrice } from './money';
import type { Item, Look, Settings } from './types';
import { MODELS } from './types';

interface State {
  ready: boolean;
  items: Item[];
  looks: Look[];
  settings: Settings;
  /** bumped when pictures arrive from the account, so pictures on screen look again */
  pics: number;
}

const DEFAULT_SETTINGS: Settings = { key: '', model: MODELS[0].id, closetView: 'scatter', currency: 'TWD' };

let state: State = { ready: false, items: [], looks: [], settings: DEFAULT_SETTINGS, pics: 0 };
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
  // Socks were saved as accessories before they had a kind of their own.
  if (i.category === 'extra' && kindFromWords(i.name) === 'socks') {
    i.category = 'socks';
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
  // Accounts, if set up: signs back in and syncs in the background.
  void startCloud();
}

export const getItem = (id: string) => state.items.find((i) => i.id === id);

export async function addItem(item: Item) {
  await db.putItem(item);
  set({ items: [item, ...state.items] });
  touch('item', item.id);
}
export async function updateItem(id: string, patch: Partial<Item>) {
  const cur = getItem(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  set({ items: state.items.map((i) => (i.id === id ? next : i)) });
  await db.putItem(next);
  touch('item', id);
}
/**
 * Take a piece out of the closet. It disappears at once but is only really deleted the next
 * time the app opens, so the returned function can put it back exactly as it was until then.
 */
export function removeItem(id: string): () => void {
  const item = getItem(id);
  if (!item) return () => {};
  const at = state.items.indexOf(item);
  set({ items: state.items.filter((i) => i.id !== id) });
  void db.putItem({ ...item, gone: Date.now() }).then(() => touch('item', id));
  return () => {
    if (getItem(id)) return;
    const items = [...state.items];
    // Whatever the studio was doing with it stopped when it was removed.
    const back: Item = item.state === 'working' ? { ...item, state: 'queued' } : item;
    items.splice(Math.min(at, items.length), 0, back);
    set({ items });
    void db.putItem(back).then(() => touch('item', id));
  };
}

/** Really delete a removed piece: its pictures, and its place on any board. */
async function purge(id: string) {
  if (getItem(id)) return;
  const touched = state.looks.filter((l) => l.pieces.some((p) => p.itemId === id));
  if (touched.length) {
    const fixed = new Map(touched.map((l) => [l.id, { ...l, pieces: l.pieces.filter((p) => p.itemId !== id) }]));
    set({ looks: state.looks.map((l) => fixed.get(l.id) ?? l) });
    await Promise.all([...fixed.values()].map((l) => db.putLook(l).then(() => touch('look', l.id))));
  }
  await db.delItem(id);
  await db.delBlobs(id);
  dropUrls(id);
  touch('item', id);
}

export async function saveLook(look: Look) {
  const next = { ...look, updatedAt: Date.now() };
  const exists = state.looks.some((l) => l.id === look.id);
  set({ looks: exists ? state.looks.map((l) => (l.id === look.id ? next : l)) : [next, ...state.looks] });
  await db.putLook(next);
  touch('look', look.id);
}
/** Delete a look. The returned function brings it back. */
export function removeLook(id: string): () => void {
  const look = state.looks.find((l) => l.id === id);
  set({ looks: state.looks.filter((l) => l.id !== id) });
  if (look) void db.delLook(id).then(() => touch('look', id));
  return () => {
    if (!look || state.looks.some((l) => l.id === id)) return;
    set({ looks: [look, ...state.looks].sort((a, b) => b.updatedAt - a.updatedAt) });
    void db.putLook(look).then(() => touch('look', id));
  };
}

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  await db.setKV('settings', settings);
}

/* ---------- changes from the account ---------- */

/** Pieces from the account: saved here and shown, without being sent back. */
export async function applyRemoteItems(puts: Item[], dels: string[]) {
  for (const i of puts) upgrade(i);
  await Promise.all(puts.map((i) => db.putItem(i)));
  for (const id of dels) {
    await db.delItem(id);
    await db.delBlobsQuiet(id);
  }
  const byId = new Map(puts.map((i) => [i.id, i]));
  const gone = new Set(dels);
  const items = state.items.filter((i) => !gone.has(i.id)).map((i) => byId.get(i.id) ?? i);
  const known = new Set(items.map((i) => i.id));
  const fresh = puts.filter((i) => !known.has(i.id));
  if (fresh.length) items.push(...fresh), items.sort((a, b) => b.createdAt - a.createdAt);
  for (const i of puts) if (state.items.find((x) => x.id === i.id)?.rev !== i.rev) dropUrls(i.id);
  for (const id of dels) dropUrls(id);
  set({ items });
}

/** Looks from the account, the same way. */
export async function applyRemoteLooks(puts: Look[], dels: string[]) {
  await Promise.all(puts.map((l) => db.putLook(l)));
  await Promise.all(dels.map((id) => db.delLook(id)));
  const byId = new Map(puts.map((l) => [l.id, l]));
  const gone = new Set(dels);
  const looks = state.looks.filter((l) => !gone.has(l.id)).map((l) => byId.get(l.id) ?? l);
  const known = new Set(looks.map((l) => l.id));
  looks.push(...puts.filter((l) => !known.has(l.id)));
  looks.sort((a, b) => b.updatedAt - a.updatedAt);
  set({ looks });
}

/** Pictures for a piece arrived after the piece itself. */
export function picsLanded(id: string) {
  dropUrls(id);
  set({ pics: state.pics + 1 });
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

async function picUrl(item: Item, want: 'thumb' | 'full'): Promise<string | null> {
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
  const landed = useStore((s) => s.pics);
  useEffect(() => {
    let on = true;
    if (!item) return setUrl(null);
    void picUrl(item, want).then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rev, st, want, landed]);
  return url;
}
