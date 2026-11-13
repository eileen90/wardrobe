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
export const getItem = async (id: string) => (await (await db()).get('items', id)) as Item | undefined;
export const delItem = async (id: string) => void (await (await db()).delete('items', id));

export const allLooks = async () => (await db()).getAll('looks') as Promise<Look[]>;
export const putLook = async (l: Look) => void (await (await db()).put('looks', l));
export const getLook = async (id: string) => (await (await db()).get('looks', id)) as Look | undefined;
export const delLook = async (id: string) => void (await (await db()).delete('looks', id));

/** Pictures live under `<itemId>:raw | cut | thumb`. */
export type Pic = 'raw' | 'cut' | 'thumb';
export const getBlob = async (key: string) =>
  (await (await db()).get('blobs', key)) as Blob | undefined;
export const PICS: Pic[] = ['raw', 'cut', 'thumb'];

/** Told about every picture written or deleted on this device, so account sync can send it on. */
let blobWatch: ((key: string) => void) | null = null;
export const watchBlobs = (f: (key: string) => void) => void (blobWatch = f);

export async function putBlob(key: string, b: Blob) {
  await putBlobQuiet(key, b);
  blobWatch?.(key);
}
export async function delBlobs(id: string) {
  await delBlobsQuiet(id);
  for (const p of PICS) blobWatch?.(`${id}:${p}`);
}
/** The same, for pictures that came from the account: nothing to send back. */
export const putBlobQuiet = async (key: string, b: Blob) => void (await (await db()).put('blobs', b, key));
export async function delBlobsQuiet(id: string) {
  const d = await db();
  await Promise.all(PICS.map((p) => d.delete('blobs', `${id}:${p}`)));
}
export const allBlobKeys = async () => (await (await db()).getAllKeys('blobs')) as string[];

export const getKV = async <T>(k: string) => (await (await db()).get('kv', k)) as T | undefined;
export const setKV = async (k: string, v: unknown) => void (await (await db()).put('kv', v, k));
export const delKV = async (k: string) => void (await (await db()).delete('kv', k));
/** Every kv entry whose key starts with `prefix`. */
export async function kvWithPrefix<T>(prefix: string): Promise<[string, T][]> {
  const d = await db();
  const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
  const [keys, values] = await Promise.all([d.getAllKeys('kv', range), d.getAll('kv', range)]);
  return keys.map((k, n) => [k as string, values[n] as T]);
}

export async function wipe() {
  const d = await db();
  await Promise.all(['items', 'looks', 'blobs'].map((s) => d.clear(s)));
}
