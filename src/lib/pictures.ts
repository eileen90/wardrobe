/** A piece's picture, handed to the clipboard or saved as a file. */
import * as db from './db';
import type { Item } from './types';
import { toast } from '../ui';

const pictureOf = async (item: Item) =>
  (item.state === 'ready' && (await db.getBlob(`${item.id}:cut`))) || (await db.getBlob(`${item.id}:raw`));

const fileName = (item: Item, b: Blob) =>
  (item.name.trim() || item.category).replace(/[\\/:*?"<>|]+/g, ' ').trim() + (b.type === 'image/jpeg' ? '.jpg' : '.png');

export async function copyPicture(item: Item) {
  const b = await pictureOf(item);
  if (!b) return;
  try {
    // The clipboard takes PNG everywhere; a photo is converted on the way.
    const png = b.type === 'image/png' ? b : await toPng(b);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Picture copied');
  } catch {
    toast("This browser can't copy pictures");
  }
}

async function toPng(b: Blob): Promise<Blob> {
  const bm = await createImageBitmap(b);
  const c = document.createElement('canvas');
  c.width = bm.width;
  c.height = bm.height;
  c.getContext('2d')!.drawImage(bm, 0, 0);
  return new Promise((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('png'))), 'image/png'));
}

/** Save pictures as files: one download each. */
export async function savePictures(items: Item[]) {
  for (const item of items) {
    const b = await pictureOf(item);
    if (!b) continue;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = fileName(item, b);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    // Browsers drop downloads started all at once.
    if (items.length > 1) await new Promise((r) => setTimeout(r, 250));
  }
}
export const savePicture = (item: Item) => savePictures([item]);
