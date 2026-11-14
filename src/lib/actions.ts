/** Things you do to the closet. Each one happens at once and goes into the undo history. */
import * as db from './db';
import { record } from './history';
import { getItem, getState, refreshPics, removeItem, removeLook, saveLook, saveSettings, updateItem } from './store';
import { TOP_UP_URL } from './pollinations';
import { cancel, inLine, redo, refreshCredits, resume, type RedoWith } from './studio';
import { costOf, REDO_MODEL, type Item, type Look, type WorkingLook } from './types';
import { toast } from '../ui';

export function removePiece(id: string) {
  cancel(id);
  const undo = removeItem(id);
  record('Removed', () => {
    undo();
    // If the studio was still working on it, it goes back in line.
    resume();
  });
}

/** Pieces that just arrived: undo takes them out again (and stops the studio on them). */
export function added(ids: string[]) {
  if (!ids.length) return;
  record(ids.length === 1 ? 'Added' : `Added ${ids.length}`, () => {
    for (const id of ids) {
      cancel(id);
      removeItem(id);
    }
  });
}

/** Change a piece's details; the old values come back on undo. Small edits don't toast. */
export function editPiece(id: string, patch: Partial<Item>, { label = 'Edit', toast = false } = {}) {
  const cur = getItem(id);
  if (!cur) return;
  const before: Partial<Item> = {};
  let same = true;
  for (const k of Object.keys(patch) as (keyof Item)[]) {
    (before as Record<string, unknown>)[k] = cur[k];
    if (JSON.stringify(cur[k]) !== JSON.stringify(patch[k])) same = false;
  }
  if (same) return;
  void updateItem(id, patch);
  record(label, () => void updateItem(id, before), { quiet: !toast });
}

export function deleteLook(id: string) {
  const undo = removeLook(id);
  record('Look removed', undo);
}

/** Save a look; undo puts back what it was before, or removes it if it is new. */
export async function keepLook(look: Look, label?: string) {
  const before = getState().looks.find((l) => l.id === look.id);
  await saveLook(look);
  record(label ?? (before ? 'Look changed' : 'Look saved'), () => {
    if (before) void saveLook(before);
    else removeLook(look.id);
  }, { quiet: !label });
}

/* ---------- canvases ---------- */

let lastStep = { key: '', at: 0 };
/**
 * Record one step, unless it continues a burst of the same change (arrow keys held down, a rail
 * stepped through piece by piece): then the burst's first step already takes all of it back.
 */
export function step(label: string, undo: () => void | Promise<void>, { key, quiet = false }: { key?: string; quiet?: boolean } = {}) {
  const now = Date.now();
  if (key && lastStep.key === key && now - lastStep.at < 900) { lastStep.at = now; return; }
  lastStep = { key: key ?? '', at: now };
  record(label, undo, { quiet });
}

/**
 * Change the looks board in one step: saved looks changed or added, looks removed, the outfit
 * changed. One undo puts all of it back.
 */
export function changeBoard(
  ch: { looks?: Look[]; removed?: string[]; working?: WorkingLook },
  label: string,
  opts: { key?: string; quiet?: boolean } = {},
) {
  const { looks, settings } = getState();
  const befores = (ch.looks ?? []).map((l) => [l.id, looks.find((x) => x.id === l.id)] as const);
  const workBefore = settings.working;
  for (const l of ch.looks ?? []) void saveLook(l);
  const undos = (ch.removed ?? []).map((id) => removeLook(id));
  if (ch.working) void saveSettings({ working: ch.working });
  step(label, () => {
    for (const [id, before] of befores) { if (before) void saveLook(before); else removeLook(id); }
    undos.forEach((u) => u());
    if (ch.working) void saveSettings({ working: workBefore });
  }, opts);
}

/** Change several pieces at once (places on the floor, kinds, order); one undo puts them all back. */
export function arrange(patches: [string, Partial<Item>][], label: string, opts: { key?: string; quiet?: boolean } = {}) {
  const befores: [string, Partial<Item>][] = [];
  for (const [id, patch] of patches) {
    const cur = getItem(id);
    if (!cur) continue;
    const before: Partial<Item> = {};
    for (const k of Object.keys(patch) as (keyof Item)[]) (before as Record<string, unknown>)[k] = cur[k];
    befores.push([id, before]);
    void updateItem(id, patch);
  }
  if (!befores.length) return;
  step(label, async () => {
    for (const [id, before] of befores) await updateItem(id, before);
  }, opts);
}

/* ---------- the studio ---------- */

/** Pictures as they were before a redo, so the redo can be taken back. */
const beforeRedo = new Map<string, { item: Item; cut?: Blob; thumb?: Blob; how: RedoWith }>();

type Snap = { item: Item; cut?: Blob; thumb?: Blob; how: RedoWith };

/** Remember the piece as it is, optionally make the studio doubt its kind, and send it in. */
async function begin(id: string, how: RedoWith, recheckKind: boolean): Promise<Snap | null> {
  const item = getItem(id);
  if (!item) return null;
  const [cut, thumb] = await Promise.all([db.getBlob(`${id}:cut`), db.getBlob(`${id}:thumb`)]);
  const snap = { item, cut, thumb, how };
  beforeRedo.set(id, snap);
  // A kind the owner chose by hand is never put in doubt.
  if (recheckKind && !item.kindByHand) await updateItem(id, { kindSure: false });
  await redo(id, how);
  return snap;
}

/** The model a redo uses: the one chosen in Settings, else the most faithful. */
const redoModel = () => getState().settings.redoModel ?? REDO_MODEL;

/** Redraw a piece's picture; undo stops it, or puts the old picture back once it has finished. */
/** A redo that can't be paid for doesn't start: the picture stays as it is. */
async function canPay(n: number, model: string): Promise<boolean> {
  const b = await refreshCredits();
  if (typeof b !== 'number' || b >= costOf(model) * n) return true;
  const fits = Math.floor(b / costOf(model));
  toast(fits ? `Credits for ${fits} of ${n}` : 'Out of credits', { label: 'Top up', run: () => window.open(TOP_UP_URL, '_blank', 'noopener') });
  return false;
}

export async function redoPiece(id: string, how: RedoWith = {}) {
  if (!(await canPay(1, how.model ?? redoModel()))) return;
  const snap = await begin(id, { model: redoModel(), ...how }, false);
  if (snap) record('Redoing the picture', () => putBack(id, snap));
}

/** Redraw many pictures at once: one undo step puts every old picture back. */
export async function redoMany(ids: string[], how: RedoWith = {}, { recheckKind = false } = {}) {
  if (!(await canPay(ids.length, how.model ?? redoModel()))) return;
  const snaps: [string, Snap][] = [];
  for (const id of ids) {
    const snap = await begin(id, { model: redoModel(), ...how }, recheckKind);
    if (snap) snaps.push([id, snap]);
  }
  if (!snaps.length) return;
  record(`Redoing ${snaps.length} ${snaps.length === 1 ? 'picture' : 'pictures'}`, async () => {
    for (const [id, snap] of snaps) await putBack(id, snap);
  });
}

/** Take many pieces out of the closet; one undo brings them all back. */
export function removeMany(ids: string[]) {
  const undos: (() => void)[] = [];
  for (const id of ids) {
    if (!getItem(id)) continue;
    cancel(id);
    undos.push(removeItem(id));
  }
  if (!undos.length) return;
  record(undos.length === 1 ? 'Removed' : `Removed ${undos.length}`, () => {
    undos.forEach((u) => u());
    resume();
  });
}

/** Change the same details on many pieces; one undo restores every old value. */
export function editMany(ids: string[], patch: Partial<Item>, { label = 'Edit', toast = true } = {}) {
  const befores: [string, Partial<Item>][] = [];
  for (const id of ids) {
    const cur = getItem(id);
    if (!cur) continue;
    const before: Partial<Item> = {};
    let same = true;
    for (const k of Object.keys(patch) as (keyof Item)[]) {
      (before as Record<string, unknown>)[k] = cur[k];
      if (JSON.stringify(cur[k]) !== JSON.stringify(patch[k])) same = false;
    }
    if (same) continue;
    befores.push([id, before]);
    void updateItem(id, patch);
  }
  if (!befores.length) return false;
  record(label, async () => {
    for (const [id, before] of befores) await updateItem(id, before);
  }, { quiet: !toast });
  return true;
}

async function putBack(id: string, snap: { item: Item; cut?: Blob; thumb?: Blob }) {
  cancel(id);
  if (beforeRedo.get(id) === snap) beforeRedo.delete(id);
  const cur = getItem(id);
  if (!cur) return;
  if (snap.cut) await db.putBlob(`${id}:cut`, snap.cut);
  if (snap.thumb) await db.putBlob(`${id}:thumb`, snap.thumb);
  refreshPics(id);
  const { state, remade, aspect, colors, problem, category, kindSure, length, name } = snap.item;
  await updateItem(id, { state, remade, aspect, colors, problem, category, kindSure, length, name, rev: cur.rev + 1 });
}

/** Stop the studio (on these pieces, or on everything). Photos stay as they are; undo sends them back in. */
export async function stopStudio(only?: string[]) {
  const ids = inLine().filter((id) => !only || only.includes(id));
  if (!ids.length) return;
  const back: { id: string; redo?: RedoWith }[] = [];
  for (const id of ids) {
    cancel(id);
    const snap = beforeRedo.get(id);
    if (snap) {
      // A piece being redone keeps the picture it had.
      back.push({ id, redo: snap.how });
      await putBack(id, snap);
    } else if (getItem(id)) {
      back.push({ id });
      await updateItem(id, { state: 'raw', problem: 'Stopped. Choose "redo the picture" to clean it.' });
    }
  }
  record(back.length === 1 ? 'Stopped cleaning' : `Stopped cleaning ${back.length} photos`, async () => {
    for (const b of back) {
      if (!getItem(b.id)) continue;
      if (b.redo) await redoPiece(b.id, b.redo);
      else await updateItem(b.id, { state: 'queued', problem: undefined });
    }
    resume();
  });
}
