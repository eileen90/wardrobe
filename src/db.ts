import { openDB, type IDBPDatabase } from 'idb';
import type { Board, Item } from './types';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB('wardrobe', 1, {
      upgrade(d) {
        d.createObjectStore('items', { keyPath: 'id' });
        d.createObjectStore('boards', { keyPath: 'id' });
        d.createObjectStore('blobs');
      },
    });
  }
  return dbp;
}

export const loadItems = async () => (await (await db()).getAll('items')) as Item[];
export const loadBoards = async () => (await (await db()).getAll('boards')) as Board[];
export const putItem = async (i: Item) => void (await (await db()).put('items', i));
export const putBoard = async (b: Board) => void (await (await db()).put('boards', b));
export const delItem = async (id: string) => void (await (await db()).delete('items', id));
export const delBoard = async (id: string) => void (await (await db()).delete('boards', id));

// Blobs are stored as ArrayBuffer + type: storing Blob objects directly in
// IndexedDB is unreliable on iOS Safari.
interface Stored {
  type: string;
  buf: ArrayBuffer;
}
export async function putBlob(key: string, blob: Blob) {
  const rec: Stored = { type: blob.type, buf: await blob.arrayBuffer() };
  await (await db()).put('blobs', rec, key);
  dropUrl(key);
}
export async function getBlob(key: string): Promise<Blob | null> {
  const rec = (await (await db()).get('blobs', key)) as Stored | undefined;
  return rec ? new Blob([rec.buf], { type: rec.type }) : null;
}
export async function delBlob(key: string) {
  await (await db()).delete('blobs', key);
  dropUrl(key);
}
export const allBlobKeys = async () => (await (await db()).getAllKeys('blobs')) as string[];

export async function wipeAll() {
  const d = await db();
  await Promise.all([d.clear('items'), d.clear('boards'), d.clear('blobs')]);
  for (const k of [...urls.keys()]) dropUrl(k);
}

// ---- object URL cache ----
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
function dropUrl(key: string) {
  const u = urls.get(key);
  if (u) URL.revokeObjectURL(u);
  urls.delete(key);
  pending.delete(key);
}
export const cachedUrl = (key: string) => urls.get(key) ?? null;
export function blobUrl(key: string): Promise<string | null> {
  const hit = urls.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = getBlob(key).then((b) => {
      pending.delete(key);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(key, u);
      return u;
    });
    pending.set(key, p);
  }
  return p;
}
