/**
 * Smaller copies of every cut-out, so a piece is never drawn from a picture much more than its
 * size on screen. Shrunk further than that, the browser
 * skips pixels (the more so inside the zoomed, tilted floor), and fine stripes shimmer into
 * coarse false patterns. Made on the device from the stored cut-out, kept on the device only
 * (never synced or backed up), and made again whenever the cut-out changes.
 */
import * as db from './db';
import { loadImage, makeCanvas, scaled, toBlob } from './img';

/**
 * Longest side of each copy, smallest first, in steps of about √2 so the browser never shrinks
 * one by more than about 1.5×. The cut-out itself (up to 1344) is the top level.
 */
export const LEVELS = [119, 168, 238, 336, 476, 672, 952];
/** Changes when the copies are made differently, so old ones are made again. */
const sigOf = (cut: Blob) => `${cut.size}:3`;

interface Mips { sig: string; at: Record<number, Blob> }
const keyOf = (id: string) => `mip:${id}`;

/** Which copies a piece has: their sizes, for the cut-out of this byte size. */
const known = new Map<string, { sig: string; levels: number[] }>();

/** The copy for `level`, if it is there and was made from this cut-out. */
export async function mipBlob(id: string, level: number, cut: Blob): Promise<Blob | null> {
  const m = await db.getKV<Mips>(keyOf(id));
  if (!m || m.sig !== sigOf(cut)) return null;
  return m.at[level] ?? null;
}

/** The sizes there are copies of, or null when they still have to be made. */
export async function mipLevels(id: string, cut: Blob): Promise<number[] | null> {
  const k = known.get(id);
  if (k && k.sig === sigOf(cut)) return k.levels;
  const m = await db.getKV<Mips>(keyOf(id));
  if (!m || m.sig !== sigOf(cut)) return null;
  const levels = Object.keys(m.at).map(Number).sort((a, b) => a - b);
  known.set(id, { sig: m.sig, levels });
  return levels;
}

/**
 * Shrink to `L`, softened first in proportion to how far it shrinks (about a pixel for each
 * halving): resampling alone lets stripes finer than two pixels fold back into broad bands.
 */
function shrink(src: HTMLCanvasElement | HTMLImageElement, L: number) {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const r = Math.max(w, h) / L;
  if (r < 1.05) return scaled(src, L);
  const soft = makeCanvas(w, h);
  const sx = soft.getContext('2d')!;
  // Where the canvas can't blur, this simply comes out sharp.
  sx.filter = `blur(${(0.45 * r).toFixed(2)}px)`;
  sx.drawImage(src, 0, 0);
  return scaled(soft, L);
}

/** Make the copies of a cut-out: two chains of halvings, one from 952 and one from 672. */
async function make(id: string, cut: Blob): Promise<number[]> {
  const img = await loadImage(cut);
  const top = Math.max(img.naturalWidth, img.naturalHeight);
  const at: Record<number, Blob> = {};
  for (const head of [LEVELS[LEVELS.length - 1], LEVELS[LEVELS.length - 2]]) {
    let src: HTMLCanvasElement | null = null;
    for (let L = head; L >= LEVELS[0]; L /= 2) {
      const level = LEVELS.find((l) => l === L);
      if (!level || level >= top) continue;
      src = shrink(src ?? img, level);
      at[level] = await toBlob(src, 'image/png');
    }
  }
  await db.setKV(keyOf(id), { sig: sigOf(cut), at } satisfies Mips);
  const levels = Object.keys(at).map(Number).sort((a, b) => a - b);
  known.set(id, { sig: sigOf(cut), levels });
  return levels;
}

/* ---------- making them in the background, one at a time ---------- */

const waiting: string[] = [];
let busy = false;
let onMade: (id: string) => void = () => {};
/** Told each time a piece's copies are ready, so pictures on screen can switch to them. */
export const whenMade = (f: (id: string) => void) => void (onMade = f);

const idle = () => new Promise<void>((r) => ('requestIdleCallback' in window
  ? requestIdleCallback(() => r(), { timeout: 400 })
  : setTimeout(r, 30)));

async function work() {
  if (busy) return;
  busy = true;
  while (waiting.length) {
    const id = waiting.shift()!;
    try {
      const cut = await db.getBlob(`${id}:cut`);
      if (cut && !(await mipLevels(id, cut))) {
        await make(id, cut);
        onMade(id);
      }
    } catch {
      /* a picture that can't be read stays as it is */
    }
    await idle();
  }
  busy = false;
}

/** Make sure these pieces have copies (cheap when they do). */
export function ensureMips(ids: string[]) {
  for (const id of ids) if (!waiting.includes(id)) waiting.push(id);
  void work();
}

export async function dropMips(id: string) {
  known.delete(id);
  await db.delKV(keyOf(id));
}
