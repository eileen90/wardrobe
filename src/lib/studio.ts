/**
 * The studio: turns whatever picture comes in into a clean, upright, evenly lit
 * cut-out, so every piece in the closet looks like it was shot the same way.
 *
 *   photo ──► plain backdrop already? ──yes──► cut out on the phone
 *                    │ no
 *                    ▼
 *        remake with the image model on a flat colour the garment doesn't contain
 *                    ▼
 *              cut out that colour ──► trim ──► save
 */
import { useSyncExternalStore } from 'react';
import * as db from './db';
import { blobToDataUrl, flatJpeg, loadImage, makeCanvas, scaled, toBlob } from './img';
import { cutOut, hasPlainBackdrop, hasTransparency, palette, rankBackdrops, trim } from './key';
import { remake, StudioError } from './pollinations';
import { addItem, getItem, getState, refreshPics, updateItem } from './store';
import type { Category, Item } from './types';
import { uid } from './types';

/* ---------- what to ask the model for ---------- */

const NOUN: Record<Category, string> = {
  outer: 'jacket',
  top: 'top',
  dress: 'dress',
  bottom: 'pair of trousers',
  shoes: 'pair of shoes',
  bag: 'bag',
  extra: 'accessory',
};

const POSE: Record<Category, string> = {
  outer: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical, closed, sleeves resting naturally at the sides.',
  top: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical, sleeves resting naturally at the sides.',
  dress: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical, full length.',
  bottom: 'Flat lay, perfectly straight front view from directly above, waistband at the top, legs straight and parallel, full length.',
  shoes: 'Both shoes of the pair side by side, three-quarter side view, toes pointing left, standing level.',
  bag: 'Standing upright, perfectly straight front view, strap and handles arranged neatly.',
  extra: 'Perfectly straight front view, neatly arranged.',
};

export function studioPrompt(category: Category, name: string, backdrop: string) {
  const what = name.trim() ? `${name.trim()} (${NOUN[category]})` : NOUN[category];
  return [
    `Recreate exactly this ${what} as a professional e-commerce product photo of the item alone.`,
    POSE[category],
    'The whole item is visible and centred, with empty background margin on all four sides.',
    'Keep the exact same colour, fabric texture, pattern, logo, print and every detail.',
    'Smooth out wrinkles into soft natural fabric folds. Soft even neutral white studio lighting.',
    'No hanger, no person, no body parts, no other objects, no text, no watermark.',
    `The background is one flat solid ${backdrop} colour filling the whole frame edge to edge, perfectly uniform, no gradient, no shadow, no floor.`,
  ].join(' ');
}

/* ---------- status for the UI ---------- */

export interface StudioStatus {
  /** pieces waiting or in progress */
  left: number;
  /** last problem, written for the person using the app */
  notice: string | null;
  noticeKind: StudioError['kind'] | null;
}
let status: StudioStatus = { left: 0, notice: null, noticeKind: null };
const subs = new Set<() => void>();
function setStatus(p: Partial<StudioStatus>) {
  status = { ...status, ...p };
  subs.forEach((f) => f());
}
export function useStudio() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => status,
  );
}
export const clearNotice = () => setStatus({ notice: null, noticeKind: null });

/* ---------- saving pictures ---------- */

const CUT_MAX = 1024;
const THUMB_MAX = 420;

async function saveCut(id: string, cut: HTMLCanvasElement) {
  const full = scaled(cut, CUT_MAX);
  await db.putBlob(`${id}:cut`, await toBlob(full, 'image/png'));
  await db.putBlob(`${id}:thumb`, await toBlob(scaled(full, THUMB_MAX), 'image/png'));
  return full;
}

/* ---------- one piece ---------- */

type Mode = 'auto' | 'remake';

async function develop(id: string, mode: Mode): Promise<void> {
  const item = getItem(id);
  const raw = await db.getBlob(`${id}:raw`);
  if (!item || !raw) return;
  await updateItem(id, { state: 'working', problem: undefined });

  const photo = scaled(await loadImage(raw), 1024);
  let cut: HTMLCanvasElement | null = null;
  let remade = false;
  let problem: string | undefined;

  // 1. Already a cut-out, or already on a plain backdrop: no need to spend a remake.
  if (mode === 'auto') {
    if (raw.type !== 'image/jpeg' && hasTransparency(photo)) {
      cut = trim(photo);
    } else {
      const d = photo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, photo.width, photo.height);
      if (hasPlainBackdrop(d)) {
        const copy = makeCanvas(photo.width, photo.height);
        copy.getContext('2d')!.drawImage(photo, 0, 0);
        cut = cutOut(copy)?.canvas ?? null;
      }
    }
  }

  // 2. Everything else is remade by the image model.
  if (!cut) {
    const { key, model } = getState().settings;
    if (!key) {
      problem = 'Connect the studio in settings to clean this photo.';
    } else {
      const dataUrl = await blobToDataUrl(await flatJpeg(photo, 0.9));
      const backdrops = rankBackdrops(photo);
      // A second backdrop is tried only if the first result cannot be cut out.
      for (const b of backdrops.slice(0, 2)) {
        const out = await remake({
          key,
          model,
          photo: dataUrl,
          prompt: studioPrompt(item.category, item.name, b.words),
        });
        const shot = scaled(await loadImage(out), 1024);
        const res = cutOut(shot);
        if (res) {
          cut = res.canvas;
          remade = true;
          break;
        }
      }
      if (!cut) problem = 'The studio could not separate this piece from its background. Try another photo.';
    }
  }

  const cur = getItem(id);
  if (!cur) return; // deleted meanwhile
  if (cut) {
    const full = await saveCut(id, cut);
    refreshPics(id);
    await updateItem(id, {
      state: 'ready',
      remade,
      aspect: full.width / full.height,
      colors: palette(full),
      rev: cur.rev + 1,
      problem: undefined,
    });
  } else {
    await updateItem(id, { state: 'raw', problem });
  }
}

/* ---------- queue ---------- */

const queue: { id: string; mode: Mode }[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    setStatus({ left: queue.length });
    const job = queue[0];
    try {
      await develop(job.id, job.mode);
    } catch (e) {
      const err = e instanceof StudioError ? e : null;
      console.error(e);
      if (getItem(job.id)) {
        await updateItem(job.id, {
          state: 'raw',
          problem: err?.message ?? 'Something went wrong while cleaning this photo.',
        });
      }
      setStatus({
        notice: err?.message ?? 'Something went wrong while cleaning a photo.',
        noticeKind: err?.kind ?? 'retry',
      });
      // A bad key or an empty account fails every job: stop instead of burning through the queue.
      if (err && err.kind !== 'retry') {
        for (const rest of queue.splice(1)) {
          if (getItem(rest.id)) await updateItem(rest.id, { state: 'raw', problem: err.message });
        }
      }
    }
    queue.shift();
  }
  running = false;
  setStatus({ left: 0 });
}

function enqueue(id: string, mode: Mode) {
  if (queue.some((q) => q.id === id)) return;
  queue.push({ id, mode });
  setStatus({ left: queue.length });
  void pump();
}

/** Run a piece through the studio again. `remake` forces a fresh shot from the image model. */
export async function redo(id: string, mode: Mode = 'remake') {
  await updateItem(id, { state: 'queued', problem: undefined });
  enqueue(id, mode);
}

/** Pick up pieces that were still waiting when the app was last closed. */
export function resume() {
  for (const i of getState().items) if (i.state === 'queued') enqueue(i.id, 'auto');
}

/** Send every piece that is still only a photo back through the studio. */
export function retryRaw() {
  for (const i of getState().items) if (i.state === 'raw') void redo(i.id, 'auto');
}

export interface NewPiece {
  category: Category;
  status: Item['status'];
  name?: string;
  url?: string;
}

/** Store a new picture and queue it for the studio. Returns the new piece's id. */
export async function addPicture(file: Blob, opts: NewPiece): Promise<string> {
  const img = await loadImage(file);
  const photo = scaled(img, 1600);
  const keepAlpha = file.type !== 'image/jpeg' && hasTransparency(photo);
  const id = uid();
  await db.putBlob(`${id}:raw`, keepAlpha ? await toBlob(photo, 'image/png') : await flatJpeg(photo));
  const item: Item = {
    id,
    name: opts.name ?? '',
    category: opts.category,
    status: opts.status,
    brand: '',
    price: '',
    url: opts.url ?? '',
    note: '',
    colors: [],
    createdAt: Date.now(),
    state: 'queued',
    remade: false,
    aspect: photo.width / photo.height,
    rev: 0,
  };
  await addItem(item);
  enqueue(id, 'auto');
  return id;
}
