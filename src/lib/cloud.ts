/**
 * Accounts and sync, the light half: the bookkeeping the store calls on every change, the status
 * the Settings page shows, and the account actions. The Supabase client and the sync itself live
 * in `cloud-engine.ts`, loaded only when accounts are set up in `cloud-config.ts`.
 *
 * Every piece, look and picture changed on this device is put in an outbox (kept in the browser
 * database, so it survives closing the app) and sent up whenever there is a connection.
 */
import { useSyncExternalStore } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloud-config';
import { nextStamp } from './cloud-merge';
import * as db from './db';

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/* ---------- status ---------- */

export interface CloudStatus {
  /** the saved sign-in has been read, so signed in or out is known */
  ready: boolean;
  email: string | null;
  lastSync: number | null;
  syncing: boolean;
  /** changes on this device not yet in the account */
  pending: number;
  /** why the last sync didn't finish, in plain words; it is tried again by itself */
  trouble: string | null;
  /** came back from a password reset email: a new password is wanted */
  recovery: boolean;
  /** a link from an email that didn't work, in plain words */
  linkProblem: string | null;
}

let status: CloudStatus = {
  ready: false, email: null, lastSync: null, syncing: false, pending: 0, trouble: null, recovery: false, linkProblem: null,
};
const subs = new Set<() => void>();
export function setCloud(p: Partial<CloudStatus>) {
  status = { ...status, ...p };
  subs.forEach((f) => f());
}
export const getCloud = () => status;
export function useCloud() {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => status);
}

/* ---------- what still has to go up ---------- */

const STAMP = 'sync:s:';
const OUT = 'sync:o:';

/** Last-change stamps per record (`item:<id>`, `look:<id>`), and the outbox of keys to send. */
export const meta = { stamps: new Map<string, number>(), outbox: new Set<string>() };
/** Bumped on every change to a key, so a change made while it was being sent isn't lost. */
const gen = new Map<string, number>();
export const genOf = (key: string) => gen.get(key) ?? 0;

let metaP: Promise<void> | null = null;
export function loadMeta() {
  if (!metaP) {
    metaP = (async () => {
      const [stamps, out] = await Promise.all([db.kvWithPrefix<number>(STAMP), db.kvWithPrefix<number>(OUT)]);
      for (const [k, v] of stamps) {
        const key = k.slice(STAMP.length);
        if (!meta.stamps.has(key)) meta.stamps.set(key, v);
      }
      for (const [k] of out) meta.outbox.add(k.slice(OUT.length));
      setCloud({ pending: meta.outbox.size });
    })();
  }
  return metaP;
}

let kicker: (() => void) | null = null;
export const onKick = (f: () => void) => void (kicker = f);

/** Something is waiting to be sent. */
export function enqueue(key: string) {
  if (!cloudConfigured) return;
  gen.set(key, genOf(key) + 1);
  if (!meta.outbox.has(key)) {
    meta.outbox.add(key);
    void db.setKV(OUT + key, 1);
    setCloud({ pending: meta.outbox.size });
  }
  kicker?.();
}

/** A piece or look changed on this device just now. */
export function touch(kind: 'item' | 'look', id: string) {
  if (!cloudConfigured) return;
  const key = `${kind}:${id}`;
  const at = nextStamp(meta.stamps.get(key));
  meta.stamps.set(key, at);
  void db.setKV(STAMP + key, at);
  enqueue(key);
}

/** Record the stamp a record has, without counting it as a change. */
export function stampAs(key: string, stamp: number) {
  meta.stamps.set(key, stamp);
  void db.setKV(STAMP + key, stamp);
}

/** The account's copy was taken: hold its stamp, and nothing of ours is left to send. */
export function settle(key: string, stamp: number) {
  stampAs(key, stamp);
  drop(key);
}

/** Take a key out of the outbox. With `ifGen`, only if it hasn't changed since that generation. */
export function drop(key: string, ifGen?: number) {
  if (ifGen !== undefined && genOf(key) !== ifGen) return;
  if (!meta.outbox.delete(key)) return;
  void db.delKV(OUT + key);
  setCloud({ pending: meta.outbox.size });
}

/** After a backup was restored: everything it replaced or brought goes to the account as it now is. */
export function restored(itemIds: string[], lookIds: string[], blobKeys: string[]) {
  for (const id of new Set(itemIds)) touch('item', id);
  for (const id of new Set(lookIds)) touch('look', id);
  for (const k of new Set(blobKeys)) enqueue('pic:' + k);
}

// Every picture written on this device, wherever it came from (studio, undo, restore).
if (cloudConfigured) db.watchBlobs((key) => enqueue('pic:' + key));

/* ---------- the engine ---------- */

type Engine = typeof import('./cloud-engine');
let engine: Promise<Engine> | null = null;

/** Called once the closet has loaded. Does nothing when accounts aren't set up. */
export function startCloud(): Promise<Engine> | null {
  if (!cloudConfigured) return null;
  if (!engine) engine = import('./cloud-engine').then((m) => (m.start(), m));
  return engine;
}

export interface Outcome {
  error?: string;
  /** something to tell her that isn't an error, e.g. "check your email" */
  notice?: string;
}
const NOT_SET = { error: "Accounts aren't set up yet." };

export const signUp = async (email: string, password: string): Promise<Outcome> =>
  (await startCloud())?.signUp(email, password) ?? NOT_SET;
export const signIn = async (email: string, password: string): Promise<Outcome> =>
  (await startCloud())?.signIn(email, password) ?? NOT_SET;
export const sendReset = async (email: string): Promise<Outcome> => (await startCloud())?.sendReset(email) ?? NOT_SET;
export const setNewPassword = async (password: string): Promise<Outcome> =>
  (await startCloud())?.setNewPassword(password) ?? NOT_SET;
export const signOut = async (): Promise<Outcome> => (await startCloud())?.signOut() ?? NOT_SET;
export const syncNow = async () => void (await startCloud())?.syncNow();
