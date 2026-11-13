import { useEffect, useState, type FormEvent } from 'react';
import {
  cloudConfigured, sendReset, setCloud, setNewPassword, signIn, signOut, signUp, syncNow, useCloud, type Outcome,
} from '../lib/cloud';
import { Sheet, toast } from '../ui';

function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

/** The Account block at the top of Settings. */
export function Account() {
  const c = useCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Outcome>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // A broken email link is told wherever she lands.
  useEffect(() => {
    if (c.linkProblem) toast(c.linkProblem);
  }, [c.linkProblem]);

  if (!cloudConfigured) {
    return (
      <section className="block">
        <h2>Account</h2>
        <p className="note">Accounts aren't set up yet.</p>
      </section>
    );
  }

  const act = async (f: () => Promise<Outcome>) => {
    setBusy(true);
    setSaid({});
    try {
      const out = await f();
      setSaid(out);
      if (!out.error) setPassword('');
    } catch {
      setSaid({ error: 'Something went wrong. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };

  const tidy = email.trim();
  const ok = tidy.includes('@') && password.length > 0;

  if (c.email) {
    return (
      <section className="block">
        <h2>Account</h2>
        <div className="acct__who">
          <b>{c.email}</b>
          <span className="small muted">
            {c.syncing ? 'Syncing…' : c.lastSync ? `Synced ${ago(c.lastSync, now)}` : 'Not synced yet'}
            {c.pending > 0 && !c.syncing ? ` · ${c.pending} ${c.pending === 1 ? 'change' : 'changes'} waiting` : ''}
          </span>
        </div>
        {c.trouble && <p className="problem">{c.trouble}</p>}
        {said.error && <p className="problem">{said.error}</p>}
        <div className="rowbtns">
          <button className="pill" disabled={c.syncing} onClick={() => void syncNow()}>sync now</button>
          <button className="pill" disabled={busy} onClick={() => void act(signOut)}>sign out</button>
        </div>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !busy) void act(() => signIn(tidy, password));
  };

  return (
    <section className="block">
      <h2>Account</h2>
      <p className="note">Sign in to keep the closet on every device.</p>
      {c.linkProblem && <p className="problem">{c.linkProblem}</p>}
      <form className="acct__form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" value={email} autoComplete="email" autoCapitalize="off" autoCorrect="off"
            spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {said.error && <p className="problem">{said.error}</p>}
        {said.notice && <p className="note">{said.notice}</p>}
        <div className="rowbtns">
          <button className="pill is-on" type="submit" disabled={busy || !ok}>sign in</button>
          <button className="pill" type="button" disabled={busy || !ok} onClick={() => void act(() => signUp(tidy, password))}>
            create account
          </button>
        </div>
        <p className="note">
          <button type="button" disabled={busy} onClick={() => {
            if (!tidy.includes('@')) return setSaid({ error: 'Type your email above first.' });
            void act(() => sendReset(tidy));
          }}>Forgot password?</button>
        </p>
      </form>
    </section>
  );
}

/** Shown on top of whatever screen she lands on after opening a password reset email. */
export function ResetPassword() {
  const { recovery } = useCloud();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => setCloud({ recovery: false });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await setNewPassword(password);
      if (out.error) setError(out.error);
      else {
        setPassword('');
        toast(out.notice ?? 'Password changed.');
      }
    } catch {
      setError('Something went wrong. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  if (!cloudConfigured) return null;
  return (
    <Sheet open={recovery} onClose={close} label="New password">
      <form className="acct__form" onSubmit={save}>
        <h2>New password</h2>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" value={password} autoComplete="new-password" autoFocus
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="problem">{error}</p>}
        <div className="rowbtns">
          <button className="pill is-on" type="submit" disabled={busy || !password}>save</button>
          <button className="pill" type="button" onClick={close}>not now</button>
        </div>
      </form>
    </Sheet>
  );
}
