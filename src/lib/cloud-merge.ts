/**
 * The rules account sync follows, kept free of the network and the database so they can be
 * tested on their own. Every record (a piece or a look) carries a stamp: the time of its last
 * change on whichever device made it. The newer stamp wins, whole record at a time.
 */
import type { Pic } from './db';
import type { Item, Look } from './types';

export interface RemoteRow<T> {
  id: string;
  data: T | null;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

/** What to do with a record the account sent. */
export type Verdict =
  | 'take' // the account's copy is newer: use it here
  | 'same' // both sides already hold this version
  | 'keep'; // this device's copy is newer: send it up

/**
 * @param stamp the stamp this device holds for the record, if any
 * @param fallback what to assume when a record has no stamp yet (closets from before accounts)
 */
export function decide(stamp: number | undefined, fallback: number | undefined, remote: { updated_at: number }): Verdict {
  const mine = stamp ?? fallback ?? -Infinity;
  if (remote.updated_at > mine) return 'take';
  if (remote.updated_at === mine) return 'same';
  return 'keep';
}

/** The stamp a piece or look is assumed to have before sync ever saw it. */
export const fallbackStamp = (kind: 'item' | 'look', rec: Item | Look | undefined) =>
  !rec ? undefined : kind === 'look' ? (rec as Look).updatedAt : (rec as Item).createdAt;

/** A stamp for a change made now: never behind the one it replaces, even if the clock is. */
export const nextStamp = (prev: number | undefined, now = Date.now()) => Math.max(now, (prev ?? 0) + 1);

/** A record sent up is a tombstone when it's gone here, or removed and waiting out its undo. */
export const isTombstone = (rec: Item | Look | undefined) => !rec || !!(rec as Item).gone;

/**
 * A piece from the account, as this device should keep it. Studio work belongs to the device
 * that started it: a piece another device still has waiting is shown here as its photo, so the
 * same paid redraw isn't run twice. If this device is the one doing the work, it keeps its state.
 */
export function adoptItem(remote: Item, local: Item | undefined): Item {
  const busyHere = local && (local.state === 'queued' || local.state === 'working');
  if (busyHere) return { ...remote, state: local.state, problem: local.problem };
  if (remote.state === 'queued' || remote.state === 'working') return { ...remote, state: 'raw', problem: undefined };
  return remote;
}

/**
 * Which pictures to fetch for a piece taken from the account. The photo never changes once taken,
 * so it is only fetched when missing; the cut-out and thumbnail follow `rev`.
 */
export function picsToFetch(remote: Item, local: Item | undefined, have: Set<Pic>): Pic[] {
  const changed = !local || local.rev !== remote.rev;
  const want: Pic[] = [];
  if (!have.has('raw')) want.push('raw');
  if (remote.state === 'ready') {
    if (changed || !have.has('cut')) want.push('cut');
    if (changed || !have.has('thumb')) want.push('thumb');
  }
  return want;
}

/** The picture a piece can't be shown without. */
export const mainPic = (it: Item): Pic => (it.state === 'ready' ? 'thumb' : 'raw');

/** Outbox keys: `item:<id>`, `look:<id>`, `pic:<id>:<raw|cut|thumb>`. */
export function parseKey(key: string): { kind: 'item' | 'look'; id: string } | { kind: 'pic'; id: string; pic: Pic } | null {
  const m = key.match(/^(item|look):(.+)$/);
  if (m) return { kind: m[1] as 'item' | 'look', id: m[2] };
  const p = key.match(/^pic:(.+):(raw|cut|thumb)$/);
  if (p) return { kind: 'pic', id: p[1], pic: p[2] as Pic };
  return null;
}

/** Whether a sync error is worth trying again later (offline, server busy) or won't fix itself. */
export function retryable(status: number | undefined): boolean {
  if (!status) return true; // no answer at all: offline or dropped
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}
