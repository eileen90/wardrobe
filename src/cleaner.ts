// Turns a raw photo into a clean cut-out, entirely on the device.
import { useSyncExternalStore } from 'react';
import * as db from './db';
import {
  alphaBlob, dominantColors, drawScaled, floodRemove, hasTransparency,
  loadImage, toBlob, trimCutout,
} from './images';
import { addItem, getItem, getState, updateItem } from './store';
import type { Category, Item } from './types';
import { uid } from './types';

export interface CleanStatus {
  /** items waiting or in progress */
  queued: number;
  /** 0..1 while the cleanup engine is being downloaded for the first time */
  download: number | null;
  error: string | null;
}
let status: CleanStatus = { queued: 0, download: null, error: null };
const subs = new Set<() => void>();
function setStatus(p: Partial<CleanStatus>) {
  status = { ...status, ...p };
  subs.forEach((f) => f());
}
export function useCleanStatus() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => status,
  );
}

const MODEL_PATH = () => new URL('models/', document.baseURI).href;

async function aiCutout(orig: Blob): Promise<HTMLCanvasElement> {
  const { removeBackground } = await import('@imgly/background-removal');
  const seen = new Map<string, [number, number]>();
  const png = await removeBackground(orig, {
    publicPath: MODEL_PATH(),
    model: 'medium',
    output: { format: 'image/png', quality: 1 },
    progress: (key: string, cur: number, total: number) => {
      if (!key.startsWith('fetch:')) return;
      seen.set(key, [cur, total]);
      let c = 0, t = 0;
      seen.forEach(([a, b]) => { c += a; t += b; });
      // Only surface it when it's a real download, not a cache hit.
      setStatus({ download: t > 0 && c < t ? c / t : null });
    },
  });
  setStatus({ download: null });
  return drawScaled(await loadImage(png), 4096);
}

async function writeVariant(id: string, v: 'cut' | 'orig', canvas: HTMLCanvasElement, full: Blob) {
  await db.putBlob(`${id}:${v}`, full);
  const t = drawScaled(canvas, 420);
  await db.putBlob(
    `${id}:${v}:t`,
    v === 'cut' ? await alphaBlob(t) : await toBlob(t, 'image/jpeg', 0.85),
  );
}

/** Clean one item. Never throws: failures leave the original photo in place. */
async function clean(id: string) {
  const orig = await db.getBlob(`${id}:orig`);
  const item = getItem(id);
  if (!orig || !item) return;
  let cut: HTMLCanvasElement | null = null;
  try {
    const src = drawScaled(await loadImage(orig), 4096);
    if (orig.type !== 'image/jpeg' && hasTransparency(src)) {
      cut = trimCutout(src); // already a clean cut-out
    } else {
      try {
        cut = trimCutout(await aiCutout(orig));
      } catch (e) {
        console.warn('AI cleanup failed, trying plain-backdrop cleanup', e);
        setStatus({ download: null });
        const flooded = floodRemove(src);
        cut = flooded && trimCutout(flooded);
        if (!cut) throw e;
      }
    }
    if (!cut) throw new Error('Nothing left after cleanup');
    await writeVariant(id, 'cut', cut, await alphaBlob(cut));
    const cur = getItem(id);
    if (!cur) return;
    await updateItem(id, {
      state: 'ready',
      hasCut: true,
      view: 'cut',
      cutAspect: cut.width / cut.height,
      colors: dominantColors(cut),
      rev: cur.rev + 1,
    });
  } catch (e) {
    console.error(e);
    if (getItem(id)) await updateItem(id, { state: 'failed', view: 'orig' });
    setStatus({ error: "Couldn't clean one photo — kept the original. Tap it to retry." });
  }
}

const queue: string[] = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    setStatus({ queued: queue.length });
    await clean(queue[0]);
    queue.shift();
  }
  running = false;
  setStatus({ queued: 0 });
}
export function enqueue(id: string) {
  if (queue.includes(id)) return;
  queue.push(id);
  setStatus({ queued: queue.length, error: null });
  void pump();
}
export const clearError = () => setStatus({ error: null });

/** Re-run cleanup for an item (e.g. after a failure). */
export async function reclean(id: string) {
  await updateItem(id, { state: 'cleaning' });
  enqueue(id);
}

/** Pick up anything that was still cleaning when the app was last closed. */
export function resumePending() {
  for (const i of getState().items) if (i.state === 'cleaning') enqueue(i.id);
}

export interface NewItemOpts {
  status: Item['status'];
  category: Category;
  url?: string;
  name?: string;
}
/** Store a new picture and queue it for cleanup. Returns the new item's id. */
export async function importPicture(file: Blob, opts: NewItemOpts): Promise<string> {
  const img = await loadImage(file);
  const c = drawScaled(img, 1600);
  // Keep transparency if the source has it; otherwise JPEG is far smaller.
  const keepAlpha = file.type !== 'image/jpeg' && hasTransparency(c);
  const orig = keepAlpha ? await toBlob(c, 'image/png') : await flatJpeg(c);
  const id = uid();
  await writeVariant(id, 'orig', c, orig);
  const item: Item = {
    id,
    name: opts.name ?? '',
    category: opts.category,
    status: opts.status,
    brand: '',
    price: '',
    url: opts.url ?? '',
    notes: '',
    colors: [],
    createdAt: Date.now(),
    state: 'cleaning',
    hasCut: false,
    view: 'orig',
    cutAspect: 1,
    origAspect: c.width / c.height,
    rev: 0,
  };
  await addItem(item);
  enqueue(id);
  return id;
}

async function flatJpeg(c: HTMLCanvasElement) {
  const f = document.createElement('canvas');
  f.width = c.width;
  f.height = c.height;
  const ctx = f.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.drawImage(c, 0, 0);
  return toBlob(f, 'image/jpeg', 0.9);
}
