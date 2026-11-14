/**
 * The studio: turns whatever picture comes in into a clean, upright, evenly lit
 * cut-out, so every piece in the closet looks like it was shot the same way.
 *
 *   photo ──► what is it? (words, else one small look)
 *         ──► plain backdrop already? ──yes──► cut out on the device
 *                    │ no
 *                    ▼
 *        remake with the image model, in a frame shaped like the piece,
 *        on a flat colour the piece doesn't contain
 *                    ▼
 *              cut out that colour ──► trim ──► save
 *
 * Nothing here needs watching. Pieces wait in a queue that survives closing the app, and
 * when the studio can't be reached (no credits, too busy, offline) the queue simply pauses
 * and picks itself up again.
 */
import { useSyncExternalStore } from 'react';
import * as db from './db';
import { blobToDataUrl, flatJpeg, loadImage, makeCanvas, scaled, toBlob } from './img';
import { cutOut, hasPlainBackdrop, hasTransparency, palette, rankBackdrops, trim } from './key';
import { kindFromShape } from './kind';
import { balance, critique, look, remake, StudioError, type StudioFault } from './pollinations';
import { addItem, getItem, getState, refreshPics, updateItem } from './store';
import { costOf, REDO_MODEL, type Category, type Item, type Length } from './types';
import { uid } from './types';

/* ---------- what to ask the model for ---------- */

const NOUN: Record<Category, string> = {
  outer: 'coat or jacket',
  top: 'top',
  dress: 'dress',
  bottom: 'garment for the lower body',
  socks: 'pair of socks',
  shoes: 'pair of shoes',
  bag: 'bag',
  extra: 'accessory',
};

const POSE: Record<Category, string> = {
  outer: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical, closed, sleeves resting naturally at the sides.',
  top: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical, sleeves resting naturally at the sides.',
  dress: 'Ghost mannequin flat lay, perfectly straight front view from directly above, symmetrical.',
  bottom: 'Flat lay, perfectly straight front view from directly above, waistband at the top, legs straight and parallel.',
  socks: 'Both socks of the pair laid flat side by side, perfectly straight view from directly above, heels facing the same way, full length.',
  shoes: 'Both shoes of the pair side by side, three-quarter side view, toes pointing left, standing level.',
  bag: 'Standing upright, perfectly straight front view, strap and handles arranged neatly.',
  extra: 'Perfectly straight front view, neatly arranged.',
};

const HEM: Record<Length, string> = {
  cropped: 'cropped',
  hip: 'hip length',
  thigh: 'thigh length',
  knee: 'knee length',
  calf: 'long, calf length',
  ankle: 'very long, ankle length',
};

const WORN = (c: Category) => c === 'outer' || c === 'top' || c === 'dress' || c === 'bottom';

export function studioPrompt(item: Pick<Item, 'category' | 'name' | 'length' | 'kindSure'>, backdrop: string, fixes = '') {
  // Unsure what it is: say nothing about sleeves or mannequins, or a backpack grows arms.
  if (item.kindSure === false) return unsurePrompt(backdrop, fixes);
  const worn = WORN(item.category);
  const hem = worn && item.length ? `, ${HEM[item.length]}` : '';
  const what = item.name.trim() ? `${item.name.trim()} (${NOUN[item.category]}${hem})` : `${NOUN[item.category]}${hem}`;
  return [
    `Recreate exactly this ${what} as a professional e-commerce product photo of the item alone.`,
    POSE[item.category],
    worn
      ? 'Keep its true proportions and its full length from top to hem exactly as in the photo: do not shorten, lengthen, crop or resize it.'
      : 'Keep its true proportions exactly as in the photo.',
    'The whole item is visible and centred, with empty background margin on all four sides. Do not stretch or lengthen it to fill the frame: leave more empty background instead.',
    KEEP_KIND,
    KEEP_LOOK,
    'Smooth out wrinkles into soft natural fabric folds.',
    'No hanger, no person, no body parts, no other objects, no text, no watermark.',
    backdropWords(backdrop),
    fixes && `A previous attempt got details wrong. Be sure to: ${fixes}`,
  ].filter(Boolean).join(' ');
}

/**
 * Colour and texture. "Neutral white studio lighting" alone made the model white-balance a
 * warmly lit photo all the way: beige trousers came back cream, an olive cardigan grey.
 * Said only in positive words: the image model's text encoder reads "never paler, never
 * washed out" as "paler, washed out" (an orange sweater came back peach).
 */
const KEEP_LOOK =
  'Exactly the same colours as in the photo, just as rich, deep and saturated: the same hue and the same depth of every ' +
  'colour. The exact same pattern, print, logo and every detail. Crisp true fabric texture: knit stitches, weave, grain, ' +
  'leather sheen. Soft even studio lighting.';

/**
 * The backdrop, and no light from it on the piece: the model used to light dark bags with
 * their backdrop, so their undersides came out blue or purple.
 */
const backdropWords = (backdrop: string) =>
  `The background is one flat solid ${backdrop} colour filling the whole frame edge to edge, perfectly uniform, ` +
  'no gradient, no shadow, no floor. The item is lit only by neutral white light.';

const KEEP_KIND =
  'It stays exactly the same kind of object as in the photo. Never add sleeves, arms, hands, a body, a head, a mannequin or any part the item does not have.';

function unsurePrompt(backdrop: string, fixes: string) {
  return [
    'Recreate exactly this item as a professional e-commerce product photo of the item alone, whatever kind of item it is.',
    'Perfectly straight front view, laid out or standing the way such an item is usually photographed for a shop.',
    'Keep its true shape, size and proportions exactly as in the photo.',
    'The whole item is visible and centred, with empty background margin on all four sides. Do not stretch it to fill the frame.',
    KEEP_KIND,
    KEEP_LOOK,
    'No hanger, no person, no other objects, no text, no watermark.',
    backdropWords(backdrop),
    fixes && `A previous attempt got details wrong. Be sure to: ${fixes}`,
  ].filter(Boolean).join(' ');
}

/**
 * The frame the model draws in. A square frame is why long coats used to come back as
 * hip-length jackets: the piece gets a frame shaped like itself instead.
 */
export function frameFor(item: Pick<Item, 'category' | 'length'>, photoAspect: number): [number, number] {
  const TALL: [number, number] = [768, 1344], PORTRAIT: [number, number] = [896, 1152];
  const SQUARE: [number, number] = [1024, 1024], WIDE: [number, number] = [1152, 896];
  const long = item.length === 'knee' || item.length === 'calf' || item.length === 'ankle';
  switch (item.category) {
    case 'shoes': return WIDE;
    case 'socks': return photoAspect > 1.25 ? WIDE : PORTRAIT;
    case 'bag':
    case 'extra': return photoAspect > 1.25 ? WIDE : photoAspect < 0.8 ? PORTRAIT : SQUARE;
    // Shorts are about square; "cropped" trousers stop just above the ankle, so they are long.
    case 'bottom': return item.length === 'thigh' || item.length === 'hip' ? SQUARE : item.length === 'knee' ? PORTRAIT : TALL;
    case 'dress': return !item.length || long ? TALL : PORTRAIT;
    default:
      if (long) return TALL;
      // A hip-length shirt laid flat, sleeves at its sides, is about as wide as it is long; in a
      // portrait frame the model fills the height and it comes back tunic length.
      if (item.length === 'cropped' || item.length === 'hip') return SQUARE;
      // Unknown length: a tall frame invites the model to stretch a shirt into a tunic.
      if (item.category === 'outer' && !item.length && photoAspect < 0.62) return TALL;
      return PORTRAIT;
  }
}

/* ---------- status for the UI ---------- */

export interface StudioStatus {
  /** pieces waiting or in progress */
  left: number;
  /** a piece is being worked on right now */
  busy: boolean;
  /** why the queue is paused, if it is */
  hold: Exclude<StudioFault, 'fail'> | null;
  /** links whose picture is still being fetched */
  fetching: number;
  /** last balance read from the account, when known */
  credits: number | null;
  /** out of credits, so photos are going through the free backup model */
}
let status: StudioStatus = { left: 0, busy: false, hold: null, fetching: 0, credits: null };
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
export const fetching = (delta: number) => setStatus({ fetching: Math.max(0, status.fetching + delta) });

/* ---------- saving pictures ---------- */

const CUT_MAX = 1344;
const THUMB_MAX = 640;

async function saveCut(id: string, cut: HTMLCanvasElement) {
  const full = scaled(cut, CUT_MAX);
  await db.putBlob(`${id}:cut`, await toBlob(full, 'image/png'));
  await db.putBlob(`${id}:thumb`, await toBlob(scaled(full, THUMB_MAX), 'image/png'));
  return full;
}

/* ---------- one piece ---------- */

/** Pieces whose picture should be drawn again even though a cut-out could be made without. */
const forced = new Set<string>();

/** How a piece being redone should be drawn: which model, and what you said was wrong. */
export interface RedoWith { model?: string; note?: string }
const redoWith = new Map<string, RedoWith>();

async function develop(id: string, signal: AbortSignal): Promise<void> {
  let item = getItem(id);
  const raw = await db.getBlob(`${id}:raw`);
  if (!item || !raw) return;
  await updateItem(id, { state: 'working', problem: undefined });

  const photo = scaled(await loadImage(raw), 1024);
  const { key } = getState().settings;
  const wish = forced.has(id) ? redoWith.get(id) : undefined;
  // A redo is usually because something came out wrong, so it uses the most faithful model.
  const model = wish ? wish.model ?? REDO_MODEL : getState().settings.model;
  let cut: HTMLCanvasElement | null = null;
  let remade = false;

  // 1. A web picture that is already a cut-out, or already on a plain backdrop, is used as it
  //    is: no credits spent. Your own photos go to the model (when there is a key), because a
  //    shirt on a white sheet is plain-backed but still crooked and creased.
  if ((item.from === 'web' && !forced.has(id)) || !key) {
    if (raw.type !== 'image/jpeg' && hasTransparency(photo)) {
      cut = trim(photo);
    } else {
      const d = photo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, photo.width, photo.height);
      if (hasPlainBackdrop(d)) {
        const copy = makeCanvas(photo.width, photo.height);
        copy.getContext('2d')!.drawImage(photo, 0, 0);
        const res = cutOut(copy);
        // A piece nearly the colour of its backdrop (a white sneaker on white) is told apart only
        // by a faint outline; with a key, the model draws it again on a colour it can't be mistaken for.
        cut = res && !(key && res.doubt > 0.12) ? res.canvas : null;
      }
    }
  }

  // 2. If words didn't say what this is, one small look does: kind, a name, how long it is.
  //    A picture being redone gets the same look when its length was never measured, because
  //    the length is what keeps a long coat long.
  const again = forced.has(id) && WORN(item.category) && !item.length;
  if (key && (!item.kindSure || again)) {
    try {
      // Big enough to see that a strap is not a sleeve, or a scarf's edge not a collar.
      const seen = await look(key, await blobToDataUrl(await flatJpeg(scaled(photo, 768), 0.85)), signal);
      if (seen) {
        await updateItem(id, {
          ...(item.kindSure ? {} : { category: seen.kind, kindSure: true }),
          length: seen.length,
          name: getItem(id)?.name || seen.name,
        });
      }
    } catch (e) {
      // A look that fails on its own is no reason to stop; anything that pauses the studio is.
      // Out of credits, the look is skipped and the outline decides the kind.
      if (!(e instanceof StudioError) || (e.kind !== 'fail' && e.kind !== 'credits')) throw e;
    }
    item = getItem(id);
    if (!item) return;
  }

  // 3. Everything else is remade by the image model.
  let problem: string | undefined;
  if (!cut) {
    if (!key) {
      problem = 'Add a studio key in settings and this photo is cleaned on its own.';
    } else {
      const dataUrl = await blobToDataUrl(await flatJpeg(photo, 0.9));
      const size = frameFor(item, photo.width / photo.height);
      // Redoing a piece that already has a picture: look at what went wrong with it first.
      let fixes = wish?.note?.trim() ?? '';
      const before = wish && (await db.getBlob(`${id}:cut`));
      if (before) {
        try {
          const seen = await critique(key, await blobToDataUrl(await flatJpeg(photo, 0.85)),
            await blobToDataUrl(await flatJpeg(scaled(await loadImage(before), 1024), 0.85)), fixes, signal);
          fixes = [fixes, seen].filter(Boolean).join('. ');
        } catch (e) {
          if (!(e instanceof StudioError) || (e.kind !== 'fail' && e.kind !== 'credits')) throw e;
        }
      }
      // A second backdrop is tried only if the first result cannot be cut out.
      for (const b of rankBackdrops(photo).slice(0, 2)) {
        const out = await remake({ key, model, photo: dataUrl, size, signal, prompt: studioPrompt(item, b.words, fixes) });
        const shot = scaled(await loadImage(out), CUT_MAX);
        // A photo without any of the backdrop's colour: whatever of it is on the remake is
        // light the model bounced off its backdrop, and comes off everywhere.
        const res = cutOut(shot, b.share < 0.02);
        if (res) {
          cut = res.canvas;
          remade = true;
          break;
        }
      }
      if (!cut) problem = "This photo couldn't be separated from its background. Another photo of it may work.";
    }
  }

  const cur = getItem(id);
  if (!cur || signal.aborted) return; // removed or stopped meanwhile
  forced.delete(id);
  redoWith.delete(id);
  if (!cut) {
    await updateItem(id, { state: 'raw', problem });
    return;
  }
  const full = await saveCut(id, cut);
  refreshPics(id);
  // Still not sure what it is (the look on the photo failed): the clean cut-out is far easier
  // to read than a photo of something on a hanger, so look at that before guessing from the outline.
  let seenAfter: Awaited<ReturnType<typeof look>> = null;
  if (key && !cur.kindSure) {
    try {
      seenAfter = await look(key, await blobToDataUrl(await flatJpeg(scaled(full, 768), 0.85)), signal);
    } catch (e) {
      if (!(e instanceof StudioError) || (e.kind !== 'fail' && e.kind !== 'credits')) throw e;
    }
  }
  await updateItem(id, {
    state: 'ready',
    remade,
    aspect: full.width / full.height,
    colors: palette(full),
    rev: cur.rev + 1,
    problem: undefined,
    // Last resort for the kind: the outline of the cut-out, still marked as a guess.
    ...(cur.kindSure ? {} : seenAfter
      ? { category: seenAfter.kind, kindSure: true, length: seenAfter.length, name: cur.name || seenAfter.name }
      : { category: kindFromShape(full) }),
  });
}

/* ---------- queue ---------- */

const queue: string[] = [];
const tries = new Map<string, number>();
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let waits = 0;
let lastTry = 0;
/** The piece being worked on now, and the way to stop it. */
let current: { id: string; stop: AbortController } | null = null;

async function pump() {
  if (running || status.hold) return;
  running = true;
  while (queue.length && !status.hold) {
    const id = queue[0];
    setStatus({ left: queue.length, busy: true });
    lastTry = Date.now();
    const stop = new AbortController();
    current = { id, stop };
    try {
      await develop(id, stop.signal);
      waits = 0;
      if (queue[0] === id) queue.shift();
    } catch (e) {
      if (stop.signal.aborted) continue; // `cancel` already took it out of line
      const err = e instanceof StudioError ? e : new StudioError('fail', '');
      if (!(e instanceof StudioError)) console.error(e);
      if (err.kind === 'fail') {
        // One request going wrong is retried once, behind everything else, then left as a photo.
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        queue.shift();
        if (!getItem(id)) continue;
        if (n < 2) {
          await updateItem(id, { state: 'queued' });
          queue.push(id);
        } else {
          await updateItem(id, {
            state: 'raw',
            problem: "The studio couldn't clean this photo. Another photo of it may work.",
          });
        }
      } else {
        // The studio itself is unavailable: everything stays queued and the queue waits.
        if (getItem(id)) await updateItem(id, { state: 'queued' });
        pause(err);
      }
    }
  }
  current = null;
  running = false;
  setStatus({ left: queue.length, busy: false });
  if (!queue.length) void readBalance();
}

function pause(err: StudioError) {
  const kind = err.kind as Exclude<StudioFault, 'fail'>;
  setStatus({ hold: kind });
  clearTimeout(timer);
  if (kind === 'busy') {
    const secs = err.retryAfter ?? Math.min(300, 20 * 2 ** waits);
    waits++;
    timer = setTimeout(wake, secs * 1000);
  } else if (kind === 'offline') {
    timer = setTimeout(wake, 20_000);
  } else if (kind === 'credits') {
    void readBalance();
    timer = setTimeout(checkCredits, 10 * 60_000);
  }
  // 'key': nothing to wait for; `keyChanged` wakes the queue.
}

/** Let the queue try again. If the reason for the pause still stands it simply pauses again. */
function wake() {
  clearTimeout(timer);
  if (!status.hold) return void pump();
  setStatus({ hold: null });
  void pump();
}

async function readBalance() {
  const { key } = getState().settings;
  if (!key) return null;
  const b = await balance(key);
  if (typeof b === 'number') {
    // Topped up: back to the paid model.
    setStatus({ credits: b });
  }
  return b;
}
/** For the settings page: read the balance now. */
export const refreshCredits = readBalance;

/** While out of credits: look at the balance (free) and carry on as soon as it covers a photo. */
async function checkCredits() {
  if (status.hold !== 'credits') return;
  clearTimeout(timer);
  const b = await readBalance();
  const enough = typeof b === 'number' && b >= costOf(getState().settings.model);
  // When the balance can't be read with this key, a real attempt every half hour finds out.
  if (enough || (typeof b !== 'number' && Date.now() - lastTry > 30 * 60_000)) return wake();
  timer = setTimeout(checkCredits, 10 * 60_000);
}

/** Coming back to the app, or back online, is a good moment to try again. */
function nudge() {
  if (document.visibilityState === 'hidden') return;
  if (status.hold === 'credits') void checkCredits();
  else if (status.hold === 'offline' || (status.hold === 'busy' && Date.now() - lastTry > 60_000)) wake();
}

function enqueue(id: string) {
  if (queue.includes(id)) return;
  queue.push(id);
  setStatus({ left: queue.length });
  void pump();
}

/** Stop the studio working on a piece: out of the queue, and any request on its way is dropped. */
export function cancel(id: string) {
  const at = queue.indexOf(id);
  if (at >= 0) queue.splice(at, 1);
  forced.delete(id);
  redoWith.delete(id);
  if (current?.id === id) current.stop.abort();
  setStatus({ left: queue.length });
}

/** Pieces waiting for the studio or being worked on, in order. */
export const inLine = () => [...queue];

/** Draw a piece's picture again from its photo, by default with the most faithful model. */
export async function redo(id: string, how: RedoWith = {}) {
  forced.add(id);
  redoWith.set(id, how);
  tries.delete(id);
  await updateItem(id, { state: 'queued', problem: undefined });
  enqueue(id);
}

let started = false;
/** Pick up pieces that were still waiting when the app was last closed. */
export function resume() {
  if (!started) {
    started = true;
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);
    document.addEventListener('visibilitychange', nudge);
  }
  const waiting = getState().items.filter((i) => i.state === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  for (const i of waiting) enqueue(i.id);
}

/** After the key was set or changed: lift a pause and send every plain photo through. */
export function keyChanged() {
  setStatus({ credits: null });
  for (const i of getState().items) {
    if (i.state === 'raw') {
      tries.delete(i.id);
      void updateItem(i.id, { state: 'queued', problem: undefined }).then(() => enqueue(i.id));
    }
  }
  if (status.hold === 'key' || status.hold === 'credits') wake();
  void readBalance();
}

export interface NewPiece {
  status: Item['status'];
  from: Item['from'];
  category?: Category | null;
  name?: string;
  url?: string;
  brand?: string;
  price?: string;
  currency?: string;
  hash?: string;
}

/** Store a new picture and queue it for the studio. Returns the new piece's id. */
export async function addPicture(img: HTMLImageElement, file: Blob, opts: NewPiece): Promise<string> {
  const photo = scaled(img, 1600);
  const keepAlpha = file.type !== 'image/jpeg' && hasTransparency(photo);
  const id = uid();
  await db.putBlob(`${id}:raw`, keepAlpha ? await toBlob(photo, 'image/png') : await flatJpeg(photo));
  const item: Item = {
    id,
    name: opts.name ?? '',
    category: opts.category ?? 'top',
    kindSure: !!opts.category,
    status: opts.status,
    brand: opts.brand ?? '',
    price: opts.price ?? '',
    currency: opts.currency || getState().settings.currency,
    url: opts.url ?? '',
    note: '',
    colors: [],
    createdAt: Date.now(),
    state: 'queued',
    remade: false,
    aspect: photo.width / photo.height,
    from: opts.from,
    rev: 0,
    hash: opts.hash,
  };
  await addItem(item);
  enqueue(id);
  return id;
}

/** Try the queue again right now, whatever it was waiting for. */
export const tryAgain = wake;
