/** One file holding the whole closet: pieces, looks and every picture. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { restored } from './cloud';
import * as db from './db';
import { getState, load } from './store';
import type { Item, Look } from './types';

export async function makeBackup(): Promise<Blob> {
  const { items, looks } = getState();
  const files: Record<string, Uint8Array> = {
    'wardrobe.json': strToU8(JSON.stringify({ version: 2, savedAt: Date.now(), items, looks })),
  };
  for (const key of await db.allBlobKeys()) {
    const b = await db.getBlob(key);
    if (!b) continue;
    const ext = b.type === 'image/jpeg' ? 'jpg' : 'png';
    files[`pictures/${key.replace(':', '.')}.${ext}`] = new Uint8Array(await b.arrayBuffer());
  }
  // Pictures are already compressed; storing them as-is is much faster.
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped.slice().buffer], { type: 'application/zip' });
}

/** Replace the closet with the contents of a backup file. Returns how many pieces it held. */
export async function restoreBackup(file: Blob): Promise<number> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("That file isn't a Wardrobe backup.");
  }
  const meta = files['wardrobe.json'];
  if (!meta) throw new Error("That file isn't a Wardrobe backup.");
  const data = JSON.parse(strFromU8(meta)) as { items: Item[]; looks: Look[] };
  // What was here before, so the account learns that it was replaced.
  const [oldItems, oldLooks, oldBlobs] = await Promise.all([db.allItems(), db.allLooks(), db.allBlobKeys()]);
  await db.wipe();
  for (const [path, bytes] of Object.entries(files)) {
    const m = path.match(/^pictures\/(.+)\.(raw|cut|thumb)\.(jpg|png)$/);
    if (!m) continue;
    await db.putBlob(`${m[1]}:${m[2]}`, new Blob([bytes.slice().buffer], { type: m[3] === 'jpg' ? 'image/jpeg' : 'image/png' }));
  }
  for (const i of data.items ?? []) await db.putItem(i);
  for (const l of data.looks ?? []) await db.putLook(l);
  restored(
    [...oldItems, ...(data.items ?? [])].map((i) => i.id),
    [...oldLooks, ...(data.looks ?? [])].map((l) => l.id),
    oldBlobs,
  );
  await load();
  return data.items?.length ?? 0;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
