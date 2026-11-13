import { useEffect, useRef, useState } from 'react';
import {
  byModifier, bindingOf, defaultOf, describe, modName, modifierOf, rebind, setRecording, SHORTCUTS, useBindings,
  withModifier, bindingFrom, held, type Mod, type ShortcutId,
} from '../lib/shortcuts';
import { Icon, Sheet, toast } from '../ui';

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.where))];

/** One shortcut's binding: pressed anew from the keyboard, or, for gestures and arrows, a modifier chosen. */
function Binding({ id, open, onOpen }: { id: ShortcutId; open: boolean; onOpen: (on: boolean) => void }) {
  const say = (m: string | null) => { if (m) toast(m); };
  const listening = open && !byModifier(id);
  const done = useRef(onOpen);
  done.current = onOpen;
  useEffect(() => {
    if (!open) return;
    const away = () => done.current(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (!listening) return;
    setRecording(true);
    const k = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Tab and a bare Esc leave the binding as it was.
      if (e.key === 'Tab' || (e.key === 'Escape' && !held(e))) return done.current(false);
      const b = bindingFrom(e);
      if (!b) return;
      done.current(false);
      say(rebind(id, b));
    };
    window.addEventListener('keydown', k, true);
    return () => {
      setRecording(false);
      window.removeEventListener('keydown', k, true);
    };
  }, [listening, id]);

  const changed = bindingOf(id) !== defaultOf(id);
  const mods: (Mod | null)[] = defaultOf(id) === 'arrows' ? [null, 'mod', 'alt', 'shift'] : ['mod', 'alt', 'shift'];
  const cur = modifierOf(id);
  return (
    <span className="keys__bind" onPointerDown={(e) => e.stopPropagation()}>
      {open && byModifier(id) ? mods.map((m) => (
        <button key={m ?? 'none'} className="pill is-key" aria-pressed={cur === m}
          onClick={() => { say(rebind(id, withModifier(id, m))); onOpen(false); }}>{m ? modName(m) : 'none'}</button>
      )) : (
        <button className="pill is-key" aria-pressed={listening} aria-label={`Change: ${describe(bindingOf(id))}`}
          onClick={() => onOpen(!open)}>
          {listening ? 'press keys' : describe(bindingOf(id))}
        </button>
      )}
      {changed && !open && (
        <button className="iconbtn is-small" aria-label="Back to default" title={`Back to ${describe(defaultOf(id))}`}
          onClick={() => say(rebind(id, null))}><Icon name="undo" /></button>
      )}
    </span>
  );
}

/** Every shortcut, grouped by where it works; in Settings each one can be changed. */
export function ShortcutList({ edit = false }: { edit?: boolean }) {
  useBindings();
  const [open, setOpen] = useState<ShortcutId | null>(null);
  return (
    <div className="keys">
      {GROUPS.map((g) => (
        <div key={g} className="keys__group">
          <span className="label">{g}</span>
          {SHORTCUTS.filter((s) => s.where === g).map((s) => (
            <div key={s.id} className="keys__row">
              <span>{s.label}</span>
              {edit
                ? <Binding id={s.id} open={open === s.id} onOpen={(on) => setOpen(on ? s.id : null)} />
                : <kbd className="pill is-key">{describe(bindingOf(s.id))}</kbd>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The shortcuts, from anywhere (F12). */
export function ShortcutsSheet({ open, onClose, onChange }: { open: boolean; onClose: () => void; onChange: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label="Shortcuts">
      <div className="sheet__head">
        <h2>Shortcuts</h2>
        <button className="small link" onClick={onChange}>change</button>
      </div>
      <ShortcutList />
    </Sheet>
  );
}
