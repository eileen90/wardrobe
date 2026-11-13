/** Things you do to the closet. Each one happens at once and goes into the undo history. */
import * as db from './db';
import { record } from './history';
import { getItem, getState, refreshPics, removeItem, removeLook, saveLook, updateItem } from './store';
import { cancel, inLine, redo, resume, type RedoWith } from './studio';
import type { Item, Look } from './types';

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
  record('Look deleted', undo);
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

/* ---------- the studio ---------- */

/** Pictures as they were before a redo, so the redo can be taken back. */
const beforeRedo = new Map<string, { item: Item; cut?: Blob; thumb?: Blob; how: RedoWith }>();

/** Redraw a piece's picture; undo stops it, or puts the old picture back once it has finished. */
export async function redoPiece(id: string, how: RedoWith = {}) {
  const item = getItem(id);
  if (!item) return;
  const [cut, thumb] = await Promise.all([db.getBlob(`${id}:cut`), db.getBlob(`${id}:thumb`)]);
  const snap = { item, cut, thumb, how };
  beforeRedo.set(id, snap);
  await redo(id, how);
  record('Redoing the picture', () => putBack(id, snap));
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
