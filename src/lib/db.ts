import { openDB, type IDBPDatabase } from 'idb';
import type { Item, Look } from './types';

/** v2 uses its own database so nothing from the first version leaks in. */
const NAME = 'wardrobe-2';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(NAME, 1, {
      upgrade(d) {
        d.createObjectStore('items', { keyPath: 'id' });
        d.createObjectStore('looks', { keyPath: 'id' });
        d.createObjectStore('blobs');
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export const allItems = async () => (await db()).getAll('items') as Promise<Item[]>;
export const putItem = async (i: Item) => void (await (await db()).put('items', i));
export const delItem = async (id: string) => void (await (await db()).delete('items', id));

export const allLooks = async () => (await db()).getAll('looks') as Promise<Look[]>;
export const putLook = async (l: Look) => void (await (await db()).put('looks', l));
export const delLook = async (id: string) => void (await (await db()).delete('looks', id));

/** Pictures live under `<itemId>:raw | cut | thumb`. */
export type Pic = 'raw' | 'cut' | 'thumb';
export const getBlob = async (key: string) =>
  (await (await db()).get('blobs', key)) as Blob | undefined;
export const putBlob = async (key: string, b: Blob) => void (await (await db()).put('blobs', b, key));
export async function delBlobs(id: string) {
  const d = await db();
  await Promise.all((['raw', 'cut', 'thumb'] as Pic[]).map((p) => d.delete('blobs', `${id}:${p}`)));
}
export const allBlobKeys = async () => (await (await db()).getAllKeys('blobs')) as string[];

export const getKV = async <T>(k: string) => (await (await db()).get('kv', k)) as T | undefined;
export const setKV = async (k: string, v: unknown) => void (await (await db()).put('kv', v, k));

export async function wipe() {
  const d = await db();
  await Promise.all(['items', 'looks', 'blobs'].map((s) => d.clear(s)));
}
