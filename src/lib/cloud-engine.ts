/**
 * Accounts and sync, the heavy half: the Supabase client, signing in and out, and the sync run.
 * Loaded only when `cloud-config.ts` is filled in.
 *
 * A sync run: take what changed in the account since last time (newer stamp wins, per record),
 * then send this device's outbox (pictures first, so a piece never arrives before its picture),
 * then fetch any pictures that were still missing. It runs after changes, when the connection
 * comes back, when the app comes to the front, and every few minutes while it is open. Nothing
 * waits on it.
 */
import { createClient, type AuthError, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { drop, enqueue, genOf, loadMeta, meta, onKick, settle, setCloud, stampAs, type Outcome } from './cloud';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloud-config';
import {
  adoptItem, decide, fallbackStamp, isTombstone, mainPic, parseKey, picsToFetch, retryable, type RemoteRow,
} from './cloud-merge';
import * as db from './db';
import { applyRemoteItems, applyRemoteLooks, getItem, getState, picsLanded } from './store';
import type { Item, Look } from './types';

const BUCKET = 'pictures';
const PAGE = 500;
/** Pulls look back this far past the last row seen, for writes that landed out of order. */
const OVERLAP = 2 * 60_000;

let sb: SupabaseClient;
let uid: string | null = null;

/* ---------- starting up ---------- */

export function start() {
  // A link from an email that failed (expired, already used) says so in the address.
  const linkProblem = readLinkProblem();
  const fromLink = /access_token=|error_description=|error_code=/.test(location.hash);

  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Implicit, not PKCE: a reset link must work even when opened on another device or browser.
      flowType: 'implicit',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'wardrobe-account',
    },
  });
  // Supabase's advice: don't call it back from inside this listener; step out first.
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => void onAuth(event, session), 0));

  void sb.auth.initialize().then(({ error }) => {
    if (error && !linkProblem) setCloud({ linkProblem: plainAuth(error) });
    // Leave a clean address behind, without the tokens or the empty '#'.
    if (fromLink || location.href.endsWith('#')) history.replaceState(history.state, '', location.pathname + location.search);
  });
  if (linkProblem) setCloud({ linkProblem });

  void loadMeta();
  void db.getKV<number>('sync:last').then((t) => t && setCloud({ lastSync: t }));
  onKick(() => schedule(2000));
  window.addEventListener('online', () => schedule(500));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(1000));
  setInterval(() => document.visibilityState === 'visible' && schedule(0), 5 * 60_000);
}

function readLinkProblem(): string | null {
  const p = new URLSearchParams(location.hash.slice(1));
  const code = p.get('error_code');
  const text = p.get('error_description');
  if (!code && !text) return null;
  if (code === 'otp_expired') return 'That email link has expired or was already used. Ask for a new one.';
  return 'That email link didn’t work. Ask for a new one.';
}

async function onAuth(event: string, session: Session | null) {
  const user = session?.user ?? null;
  if (event === 'PASSWORD_RECOVERY') setCloud({ recovery: true });
  setCloud({ ready: true, email: user?.email ?? null });
  if (!user) {
    uid = null;
    return;
  }
  if (user.id === uid) return;
  uid = user.id;
  await bind(user.id);
  schedule(0);
}

/**
 * First sign-in on this device (or into another account): everything here is offered to the
 * account, and everything there is fetched. Neither side is wiped; the newer copy of a record
 * that exists on both wins.
 */
async function bind(id: string) {
  await loadMeta();
  if ((await db.getKV<string>('sync:user')) === id) return;
  await Promise.all([db.delKV('sync:cursor:items'), db.delKV('sync:cursor:looks')]);
  const { items, looks } = getState();
  const here = new Set(items.map((i) => i.id));
  for (const i of items) enqueue(`item:${i.id}`);
  for (const l of looks) enqueue(`look:${l.id}`);
  for (const k of await db.allBlobKeys()) if (here.has(k.split(':')[0])) enqueue(`pic:${k}`);
  await db.setKV('sync:user', id);
}

/* ---------- account actions ---------- */

const here = () => location.origin + location.pathname;

function plainAuth(e: AuthError | Error): string {
  const code = (e as AuthError).code;
  const status = (e as AuthError).status;
  if (e.name === 'AuthRetryableFetchError' || (!status && /fetch|network/i.test(e.message)) || !navigator.onLine)
    return 'Couldn’t reach the account service. Check the connection and try again.';
  switch (code) {
    case 'invalid_credentials': return 'That email and password don’t match.';
    case 'email_not_confirmed': return 'Confirm your email first: open the link we sent, then sign in.';
    case 'user_already_exists':
    case 'email_exists': return 'That email already has an account. Sign in instead.';
    case 'weak_password': return 'Pick a longer password: at least 6 characters, ideally more.';
    case 'same_password': return 'That’s the password you already have. Pick a new one.';
    case 'email_address_invalid':
    case 'validation_failed': return 'That doesn’t look like an email address.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Too many tries in a short time. Wait a few minutes and try again.';
    case 'signup_disabled': return 'New accounts are turned off for this app.';
    case 'session_not_found':
    case 'session_expired': return 'This reset link has run out. Ask for a new one.';
  }
  if (status === 429) return 'Too many tries in a short time. Wait a few minutes and try again.';
  return 'Something went wrong with the account. Try again in a moment.';
}

export async function signUp(email: string, password: string): Promise<Outcome> {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
  if (error) return { error: plainAuth(error) };
  // With email confirmation on, an address that already has an account comes back with no identities.
  if (data.user && !data.user.identities?.length) return { error: 'That email already has an account. Sign in instead.' };
  if (!data.session) return { notice: 'Almost there: open the link we just emailed you, then sign in.' };
  return {};
}

export async function signIn(email: string, password: string): Promise<Outcome> {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { error: plainAuth(error) } : {};
}

export async function sendReset(email: string): Promise<Outcome> {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
  if (error) return { error: plainAuth(error) };
  return { notice: `If ${email} has an account, a link to set a new password is on its way.` };
}

export async function setNewPassword(password: string): Promise<Outcome> {
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: plainAuth(error) };
  setCloud({ recovery: false, linkProblem: null });
  return { notice: 'Password changed.' };
}

/** Signs out on this device only. The closet stays here. */
export async function signOut(): Promise<Outcome> {
  const { error } = await sb.auth.signOut({ scope: 'local' });
  uid = null;
  setCloud({ email: null, recovery: false, trouble: null, syncing: false });
  return error ? { error: plainAuth(error) } : {};
}

export const syncNow = () => schedule(0);

/* ---------- the run ---------- */

class SyncError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
let failures = 0;

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), ms);
}

async function run() {
  if (!uid || !navigator.onLine) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setCloud({ syncing: true });
  const who = uid;
  try {
    await loadMeta();
    await pull<Item>('items', who);
    await pull<Look>('looks', who);
    await pushPics(who);
    await pushRows(who);
    await fetchMissing(who);
    failures = 0;
    const now = Date.now();
    void db.setKV('sync:last', now);
    setCloud({ lastSync: now, trouble: null });
  } catch (e) {
    failures++;
    setCloud({ trouble: plainSync(e) });
    schedule(Math.min(30_000 * 2 ** (failures - 1), 10 * 60_000));
  } finally {
    running = false;
    setCloud({ syncing: false, pending: meta.outbox.size });
    if (again) {
      again = false;
      schedule(500);
    }
  }
}

function plainSync(e: unknown): string | null {
  if (!navigator.onLine) return null; // offline is not a problem: it waits
  const err = e as SyncError;
  if (err.code === '42P01' || err.code === 'PGRST205') return 'The account’s tables are missing. Run supabase/schema.sql in the Supabase project.';
  if (err.status === 401 || err.status === 403 || err.code === '42501') return 'The account turned the sync away. Sign out and in again.';
  return 'Couldn’t sync just now. It will try again by itself.';
}

function fail(error: { message: string; code?: string } | null, status?: number): never {
  throw new SyncError(error?.message ?? 'sync failed', status, error?.code);
}

/* pulling */

async function pull<T extends Item | Look>(table: 'items' | 'looks', who: string) {
  const kind = table === 'items' ? 'item' : 'look';
  const cursor = await db.getKV<string>(`sync:cursor:${table}`);
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP).toISOString() : null;
  let after: { at: string; id: string } | null = null;
  for (;;) {
    let q = sb.from(table).select('id,data,updated_at,deleted,synced_at').eq('user_id', who)
      .order('synced_at').order('id').limit(PAGE);
    if (after) q = q.or(`synced_at.gt."${after.at}",and(synced_at.eq."${after.at}",id.gt."${after.id}")`);
    else if (since) q = q.gt('synced_at', since);
    const { data, error, status } = await q;
    if (error) fail(error, status);
    const rows = (data ?? []) as RemoteRow<T>[];
    if (uid !== who) return; // signed out meanwhile
    if (kind === 'item') await takeItems(rows as RemoteRow<Item>[]);
    else await takeLooks(rows as RemoteRow<Look>[]);
    if (rows.length) {
      const last = rows[rows.length - 1];
      after = { at: last.synced_at, id: last.id };
      await db.setKV(`sync:cursor:${table}`, last.synced_at);
    }
    if (rows.length < PAGE) break;
  }
}

/** Sort rows into the ones to take (with the stamp they were judged against) and the rest. */
function judge<T extends Item | Look>(kind: 'item' | 'look', rows: RemoteRow<T>[], local: (id: string) => T | undefined) {
  const take: { row: RemoteRow<T>; was: number | undefined }[] = [];
  for (const row of rows) {
    const key = `${kind}:${row.id}`;
    const was = meta.stamps.get(key);
    const v = decide(was, fallbackStamp(kind, local(row.id)), row);
    if (v === 'take') take.push({ row, was });
    else if (v === 'same') settle(key, row.updated_at);
    else enqueue(key); // ours is newer: make sure it goes up
  }
  return take;
}

/** Rows whose record changed here while pictures were downloading are left for the next run. */
const unchanged = (kind: string, id: string, was: number | undefined) => meta.stamps.get(`${kind}:${id}`) === was;

async function takeItems(rows: RemoteRow<Item>[]) {
  const take = judge('item', rows, getItem);
  const have = new Set(await db.allBlobKeys());
  const need = await needSet();
  for (let at = 0; at < take.length; at += 25) {
    const puts: Item[] = [];
    const dels: string[] = [];
    const done: { id: string; stamp: number }[] = [];
    for (const { row, was } of take.slice(at, at + 25)) {
      if (row.deleted || !row.data || row.data.gone) {
        dels.push(row.id);
        for (const p of db.PICS) drop(`pic:${row.id}:${p}`);
      } else {
        const local = await db.getItem(row.id);
        const item = adoptItem({ ...row.data, id: row.id }, local);
        const mine = new Set(db.PICS.filter((p) => have.has(`${row.id}:${p}`)));
        let missing = false;
        for (const p of picsToFetch(item, local, mine)) {
          const ok = await fetchPic(row.id, p);
          if (!ok && p === mainPic(item)) missing = true;
        }
        if (missing) need.add(row.id);
        else need.delete(row.id);
        if (!unchanged('item', row.id, was)) continue;
        puts.push(item);
      }
      done.push({ id: row.id, stamp: row.updated_at });
    }
    await applyRemoteItems(puts, dels);
    for (const d of done) settle(`item:${d.id}`, d.stamp);
  }
  await db.setKV('sync:need', [...need]);
}

async function takeLooks(rows: RemoteRow<Look>[]) {
  const take = judge('look', rows, (id) => getState().looks.find((l) => l.id === id));
  const puts: Look[] = [];
  const dels: string[] = [];
  for (const { row } of take) {
    if (row.deleted || !row.data) dels.push(row.id);
    else puts.push({ ...row.data, id: row.id });
  }
  await applyRemoteLooks(puts, dels);
  for (const { row } of take) settle(`look:${row.id}`, row.updated_at);
}

/* pictures */

const picPath = (who: string, id: string, pic: db.Pic) => `${who}/${id}/${pic}`;

/** Download one picture into this device. False when the account doesn't have it (yet). */
async function fetchPic(id: string, pic: db.Pic): Promise<boolean> {
  const { data, error } = await sb.storage.from(BUCKET).download(picPath(uid!, id, pic));
  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 404) return false;
    fail(error, status);
  }
  await db.putBlobQuiet(`${id}:${pic}`, data);
  return true;
}

async function needSet() {
  return new Set((await db.getKV<string[]>('sync:need')) ?? []);
}

/** Pictures that weren't in the account yet when their piece arrived. */
async function fetchMissing(who: string) {
  const need = await needSet();
  if (!need.size) return;
  const have = new Set(await db.allBlobKeys());
  for (const id of [...need]) {
    if (uid !== who) return;
    const item = getItem(id);
    if (!item) {
      need.delete(id);
      continue;
    }
    const mine = new Set(db.PICS.filter((p) => have.has(`${id}:${p}`)));
    let got = false;
    for (const p of picsToFetch(item, item, mine)) {
      if (await fetchPic(id, p)) {
        got = true;
        mine.add(p);
      }
    }
    if (mine.has(mainPic(item))) need.delete(id);
    if (got) picsLanded(id);
  }
  await db.setKV('sync:need', [...need]);
}

async function pushPics(who: string) {
  for (const key of [...meta.outbox]) {
    const k = parseKey(key);
    if (k?.kind !== 'pic') continue;
    if (uid !== who) return;
    const g = genOf(key);
    const path = picPath(who, k.id, k.pic);
    const blob = await db.getBlob(`${k.id}:${k.pic}`);
    let res: { error: unknown };
    if (blob) {
      res = await sb.storage.from(BUCKET).upload(path, blob, {
        upsert: true,
        contentType: blob.type || 'image/png',
        // The same path gets a new picture after a redo: never serve an old one from a cache.
        cacheControl: '0',
      });
    } else if (await db.getItem(k.id)) {
      // The piece is still here but this picture isn't (it never had one): nothing to do.
      res = { error: null };
    } else {
      res = await sb.storage.from(BUCKET).remove([path]);
    }
    if (res.error) {
      const status = (res.error as { status?: number }).status;
      if (retryable(status)) fail(res.error as Error, status);
      // Refused for good (too big, wrong type): don't hold everything else up for it.
    }
    drop(key, g);
  }
}

async function pushRows(who: string) {
  for (const table of ['items', 'looks'] as const) {
    const kind = table === 'items' ? 'item' : 'look';
    const keys = [...meta.outbox].filter((k) => k.startsWith(kind + ':'))
      // A piece whose new pictures haven't gone up yet waits for them, so it never arrives first.
      .filter((k) => kind === 'look' || !db.PICS.some((p) => meta.outbox.has(`pic:${k.slice(5)}:${p}`)));
    for (let at = 0; at < keys.length; at += 100) {
      if (uid !== who) return;
      const batch = await Promise.all(keys.slice(at, at + 100).map(async (key) => {
        const id = key.slice(kind.length + 1);
        const g = genOf(key);
        const rec = kind === 'item' ? await db.getItem(id) : await db.getLook(id);
        let stamp = meta.stamps.get(key);
        if (stamp === undefined) {
          // Never changed since accounts arrived: it goes up with the stamp it was judged by.
          stamp = fallbackStamp(kind, rec) ?? Date.now();
          stampAs(key, stamp);
        }
        const dead = isTombstone(rec);
        return { key, g, row: { user_id: who, id, data: dead ? null : rec, updated_at: stamp, deleted: dead } };
      }));
      const { error, status } = await sb.from(table).upsert(batch.map((b) => b.row), { onConflict: 'user_id,id' });
      if (error) fail(error, status);
      for (const b of batch) drop(b.key, b.g);
    }
  }
}
