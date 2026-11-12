// Whole-closet backup as a single .zip, so nothing is lost with the phone.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as db from './db';
import { getState, reload } from './store';
import type { Board, Item } from './types';

export async function exportBackup(): Promise<Blob> {
  const { items, boards } = getState();
  const files: Record<string, Uint8Array> = {};
  const types: Record<string, string> = {};
  for (const key of await db.allBlobKeys()) {
    const b = await db.getBlob(key);
    if (!b) continue;
    types[key] = b.type;
    files[`blobs/${encodeURIComponent(key)}`] = new Uint8Array(await b.arrayBuffer());
  }
  files['wardrobe.json'] = strToU8(JSON.stringify({ version: 1, items, boards, types }));
  // Pictures are already compressed: store, don't deflate.
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

/** Merge a backup into the closet. Returns how many pieces it contained. */
export async function importBackup(file: Blob): Promise<number> {
  let entries: Record<string, Uint8Array>;
  let meta: { items: Item[]; boards: Board[]; types: Record<string, string> };
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    meta = JSON.parse(strFromU8(entries['wardrobe.json']));
    if (!Array.isArray(meta.items) || !Array.isArray(meta.boards)) throw 0;
  } catch {
    throw new Error("That file isn't a Wardrobe backup.");
  }
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith('blobs/')) continue;
    const key = decodeURIComponent(path.slice(6));
    await db.putBlob(key, new Blob([data as BlobPart], { type: meta.types?.[key] ?? 'image/png' }));
  }
  for (const i of meta.items) await db.putItem({ ...i, state: i.state === 'cleaning' ? 'failed' : i.state });
  for (const b of meta.boards) await db.putBoard(b);
  await reload();
  return meta.items.length;
}
