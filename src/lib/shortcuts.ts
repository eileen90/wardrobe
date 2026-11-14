/**
 * Every shortcut in one place, so a gesture means the same thing on every screen and the
 * owner can rebind any of them in Settings. Screens never test keys or modifiers themselves:
 * they ask `isKey(e, 'undo')` or `isPointer(e, 'resize')`.
 *
 * A binding is a string: modifiers joined with '+', then a key name (as in KeyboardEvent.key,
 * case-insensitive), 'arrows' for all four arrow keys, or a pointer gesture ('click' | 'drag' |
 * 'wheel'). 'mod' = ⌘ on Apple devices, Ctrl elsewhere. Examples: 'mod+z', 'alt+drag', 'F12'.
 */
import { record } from './history';
import { getState, saveSettings, useStore } from './store';

export type ShortcutId =
  | 'undo' | 'shortcuts' | 'close' | 'remove'
  | 'select' | 'selectRange' | 'selectAll' | 'resize' | 'zoom' | 'fit'
  | 'open' | 'nudge' | 'shove' | 'grow' | 'shrink' | 'turn' | 'turnBack' | 'forward' | 'backward' | 'flip' | 'duplicate'
  | 'railUp' | 'railDown' | 'keep' | 'pickAll' | 'shuffle' | 'save' | 'prev' | 'next';

/**
 * The screens a shortcut works on, for telling clashes apart from shortcuts that never meet.
 * Saved looks live on the looks board now, so 'board' is the same screen as 'looks'.
 */
type Screen = 'closet' | 'looks' | 'piece';
const ALL: Screen[] = ['closet', 'looks', 'piece'];
const CANVAS: Screen[] = ['closet', 'looks'];

interface Shortcut {
  id: ShortcutId;
  label: string;
  where: string;
  keys: string;
  on: Screen[];
  /** Keys for selected pieces sit over the page's own keys (arrows nudge while pieces are selected). */
  selected?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'undo', label: 'Undo', where: 'Everywhere', keys: 'mod+z', on: ALL },
  { id: 'remove', label: 'Remove', where: 'Everywhere', keys: 'Backspace', on: ALL },
  { id: 'close', label: 'Close or clear', where: 'Everywhere', keys: 'Escape', on: ALL },
  { id: 'shortcuts', label: 'Shortcuts', where: 'Everywhere', keys: 'F12', on: ALL },

  { id: 'select', label: 'Add to the selection', where: 'Closet and looks', keys: 'mod+click', on: CANVAS },
  { id: 'selectRange', label: 'Select a range', where: 'Closet and looks', keys: 'shift+click', on: CANVAS },
  { id: 'selectAll', label: 'Select all', where: 'Closet and looks', keys: 'mod+a', on: CANVAS },
  { id: 'open', label: 'Open the piece (or enter a look)', where: 'Closet and looks', keys: 'dblclick', on: CANVAS },
  { id: 'resize', label: 'Resize', where: 'Closet and looks', keys: 'alt+drag', on: CANVAS },
  { id: 'zoom', label: 'Zoom', where: 'Closet and looks', keys: 'mod+wheel', on: CANVAS },
  { id: 'fit', label: 'Fit (again: everything)', where: 'Closet and looks', keys: '0', on: CANVAS },
  { id: 'nudge', label: 'Nudge', where: 'Closet and looks', keys: 'arrows', on: ['closet'], selected: true },
  { id: 'shove', label: 'Nudge on the looks board', where: 'Closet and looks', keys: 'shift+arrows', on: ['looks'], selected: true },
  { id: 'grow', label: 'Bigger', where: 'Closet and looks', keys: '=', on: CANVAS, selected: true },
  { id: 'shrink', label: 'Smaller', where: 'Closet and looks', keys: '-', on: CANVAS, selected: true },
  { id: 'forward', label: 'Bring forward', where: 'Closet and looks', keys: ']', on: CANVAS, selected: true },
  { id: 'backward', label: 'Send back', where: 'Closet and looks', keys: '[', on: CANVAS, selected: true },
  { id: 'flip', label: 'Flip', where: 'Closet and looks', keys: 'f', on: CANVAS, selected: true },
  { id: 'turnBack', label: 'Turn left', where: 'Looks', keys: 'shift+r', on: ['looks'], selected: true },
  { id: 'turn', label: 'Turn right', where: 'Looks', keys: 'r', on: ['looks'], selected: true },
  { id: 'duplicate', label: 'Copy', where: 'Looks', keys: 'mod+d', on: ['looks'], selected: true },

  { id: 'prev', label: 'Previous of its kind', where: 'Looks and a piece', keys: 'ArrowLeft', on: ['looks', 'piece'] },
  { id: 'next', label: 'Next of its kind', where: 'Looks and a piece', keys: 'ArrowRight', on: ['looks', 'piece'] },
  { id: 'railUp', label: 'Select the piece above', where: 'Looks', keys: 'ArrowUp', on: ['looks'] },
  { id: 'railDown', label: 'Select the piece below', where: 'Looks', keys: 'ArrowDown', on: ['looks'] },
  { id: 'keep', label: 'Keep', where: 'Looks', keys: 'l', on: ['looks'] },
  { id: 'pickAll', label: 'All of this kind', where: 'Looks', keys: 'Enter', on: ['looks'] },
  { id: 'shuffle', label: 'Shuffle', where: 'Looks', keys: ' ', on: ['looks'] },
  { id: 'save', label: 'Save the look', where: 'Looks', keys: 's', on: ['looks'] },
];
const SHORTCUT = new Map(SHORTCUTS.map((s) => [s.id, s]));

const isApple = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);

/** The binding in force: the owner's, else the default. */
export function bindingOf(id: ShortcutId): string {
  return getState().settings.shortcuts?.[id] ?? SHORTCUT.get(id)!.keys;
}
export const defaultOf = (id: ShortcutId) => SHORTCUT.get(id)!.keys;

/* ---------- reading bindings and events ---------- */

export type Mod = 'mod' | 'alt' | 'shift';
interface Parsed { mod: boolean; alt: boolean; shift: boolean; key: string }
const GESTURES = ['click', 'dblclick', 'drag', 'wheel'];
/** Keys that are one key under two names: Delete is what a Mac labels Backspace. */
const SAME: Record<string, string> = { delete: 'backspace', '+': '=', esc: 'escape', spacebar: ' ' };
const ARROWS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'];

function parse(binding: string): Parsed {
  const plus = binding.endsWith('+');
  const parts = binding.split('+').filter(Boolean);
  const key = plus ? '+' : parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const k = key.toLowerCase();
  return { mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift'), key: SAME[k] ?? k };
}
const gesture = (b: Parsed) => GESTURES.includes(b.key);
/** Shortcuts rebound by choosing a modifier rather than pressing keys. */
export const byModifier = (id: ShortcutId) => { const b = parse(defaultOf(id)); return gesture(b) || b.key === 'arrows'; };

const modDown = (e: { metaKey: boolean; ctrlKey: boolean }) => (isApple ? e.metaKey : e.ctrlKey);
/** The modifier that has no part in shortcuts here (Ctrl on a Mac, the Windows key elsewhere). */
const otherDown = (e: { metaKey: boolean; ctrlKey: boolean }) => (isApple ? e.ctrlKey : e.metaKey);

/** The key pressed, read from the key's place when ⌥ turned it into another character. */
function keyOf(e: KeyboardEvent | React.KeyboardEvent): string {
  const code = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1];
  const k = (e.altKey && code ? code : e.key).toLowerCase();
  return SAME[k] ?? k;
}

/** A text field (or anything typed into) has the keyboard: no shortcut fires there. */
export const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

/** Enter and Space belong to a focused button: they press it. */
const pressing = (e: KeyboardEvent | React.KeyboardEvent, k: string) =>
  (k === 'enter' || k === ' ') && e.target instanceof HTMLElement && !!e.target.closest('button, a, [role="button"]');

/**
 * Who has the keyboard: whatever lies on top. A page (the closet, the looks board) is under a
 * piece's page, which is under any sheet. ('board' stays for callers from before saved looks
 * moved onto the looks board.)
 */
const ABOVE = { page: '.focus, .sheet.is-on', board: '.focus, .sheet.is-on', focus: '.sheet.is-on' };
export const covered = (layer: keyof typeof ABOVE) => !!document.querySelector(ABOVE[layer]);

let recording = false;
/** While Settings is listening for a new binding, no shortcut fires. */
export const setRecording = (on: boolean) => void (recording = on);

/** Does this key press trigger the shortcut? `inField` lets it fire while typing (Esc to leave a field). */
export function isKey(e: KeyboardEvent | React.KeyboardEvent, id: ShortcutId, { inField = false } = {}): boolean {
  if (recording || ('nativeEvent' in e ? e.nativeEvent : e).isComposing) return false;
  if (!inField && typing(e.target)) return false;
  const b = parse(bindingOf(id));
  if (gesture(b) || otherDown(e)) return false;
  if (modDown(e) !== b.mod || e.altKey !== b.alt) return false;
  const k = keyOf(e);
  if (!b.mod && !b.alt && pressing(e, k)) return false;
  // Shift counts for named keys; a typed character already says whether it was shifted.
  if (b.shift ? !e.shiftKey : e.shiftKey && (k.length > 1 || b.key === 'arrows')) return false;
  return b.key === 'arrows' ? ARROWS.includes(k) : k === b.key;
}

/** Which way an arrow key points, for nudging. */
export function arrowOf(e: KeyboardEvent): [number, number] | null {
  const d: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  return d[keyOf(e)] ?? null;
}

/** Enter in a text field: done with it (unless an input method is still composing a word). */
export const isDone = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.nativeEvent.isComposing;

/** Is this click, drag or wheel the shortcut's gesture (judged by the modifiers held)? */
export function isPointer(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, id: ShortcutId): boolean {
  if (recording) return false;
  const b = parse(bindingOf(id));
  return gesture(b) && modDown(e) === b.mod && e.altKey === b.alt && e.shiftKey === b.shift;
}

/** Some modifier is held. */
export const held = (e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) =>
  e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;

/* ---------- showing bindings ---------- */

const MOD_NAMES: Record<Mod, string> = isApple ? { mod: '⌘', alt: '⌥', shift: '⇧' } : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };
export const modName = (m: Mod) => MOD_NAMES[m];

/** How a binding reads on this device: '⌘Z', '⌥ drag', 'F12'. */
export function describe(binding: string): string {
  const b = parse(binding);
  const name: Record<string, string> = {
    ' ': 'Space', escape: 'Esc', backspace: '⌫', enter: '↩', arrows: '← → ↑ ↓', tab: 'Tab',
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', wheel: 'scroll', dblclick: 'double-click',
  };
  const key = name[b.key] ?? (b.key.length === 1 || GESTURES.includes(b.key) ? b.key.toUpperCase() : binding.split('+').pop()!);
  const mods = (['mod', 'alt', 'shift'] as Mod[]).filter((m) => b[m]).map((m) => MOD_NAMES[m]);
  if (gesture(b) || b.key === 'arrows') return [...mods, gesture(b) ? key.toLowerCase() : key].join(' ');
  return isApple ? mods.join('') + key : [...mods, key].join('+');
}
/** The binding of a shortcut as it reads, for tooltips. */
export const hint = (id: ShortcutId) => describe(bindingOf(id));

/** Record a key press as a binding string (for rebinding in Settings); null for a lone modifier. */
export function bindingFrom(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn'].includes(e.key)) return null;
  const k = keyOf(e);
  const key = k.length === 1 ? k : e.key;
  return [modDown(e) && 'mod', e.altKey && 'alt', e.shiftKey && k.length > 1 && 'shift', key].filter(Boolean).join('+');
}
/** The same gesture (or arrows) with another modifier, or none. */
export const withModifier = (id: ShortcutId, m: Mod | null) => (m ? m + '+' : '') + parse(defaultOf(id)).key;
export const modifierOf = (id: ShortcutId): Mod | null => {
  const b = parse(bindingOf(id));
  return b.mod ? 'mod' : b.alt ? 'alt' : b.shift ? 'shift' : null;
};

/* ---------- rebinding ---------- */

const sameMods = (a: Parsed, b: Parsed) => a.mod === b.mod && a.alt === b.alt && a.shift === b.shift;
/** Would two bindings be set off by the same press? */
function overlap(x: string, y: string) {
  const a = parse(x), b = parse(y);
  if (gesture(a) !== gesture(b) || !sameMods(a, b)) return false;
  // A click and a drag start the same way; the wheel is its own thing.
  if (gesture(a)) return (a.key === 'wheel') === (b.key === 'wheel');
  const arrows = (p: Parsed) => (p.key === 'arrows' ? ARROWS : [p.key]);
  return arrows(a).some((k) => arrows(b).includes(k));
}
/** The shortcut that `binding` would collide with on a screen they share, if any. */
function clashWith(id: ShortcutId, binding: string, map: Record<string, string>): Shortcut | null {
  const me = SHORTCUT.get(id)!;
  const of = (s: Shortcut) => map[s.id] ?? s.keys;
  return SHORTCUTS.find((s) => s.id !== id
    && s.on.some((x) => me.on.includes(x))
    && (!!s.selected === !!me.selected || s.where === 'Everywhere' || me.where === 'Everywhere')
    && overlap(binding, of(s))) ?? null;
}
/** A binding that can't be used at all: a bare gesture is already moving or opening a piece. */
const unusable = (b: string) => { const p = parse(b); return gesture(p) && !p.mod && !p.alt && !p.shift; };

/**
 * Give a shortcut a new binding (null: its default). On a clash the other shortcut takes this
 * one's old binding, when that fits; otherwise nothing changes. Returns what to tell her.
 */
export function rebind(id: ShortcutId, keys: string | null): string | null {
  const before = { ...(getState().settings.shortcuts ?? {}) };
  const want = keys ?? defaultOf(id);
  const was = bindingOf(id);
  if (want === was) return null;
  if (unusable(want) && want !== defaultOf(id)) return 'Needs a modifier';
  const put = (m: Record<string, string>, k: ShortcutId, b: string) => { if (b === defaultOf(k)) delete m[k]; else m[k] = b; };
  const next = { ...before };
  put(next, id, want);
  let said = keys === null ? 'Shortcut reset' : 'Shortcut changed';
  const other = clashWith(id, want, next);
  if (other) {
    // The other one takes the old binding: for a gesture, only its modifier.
    const theirs = parse(defaultOf(other.id));
    const swap = byModifier(other.id) ? withMods(was, theirs.key) : was;
    put(next, other.id, swap);
    if (unusable(swap) || byModifier(other.id) !== byModifier(id) || clashWith(other.id, swap, next)) return `Taken by ${other.label.toLowerCase()}`;
    said = `Swapped with ${other.label.toLowerCase()}`;
  }
  void saveSettings({ shortcuts: next });
  record(said, () => void saveSettings({ shortcuts: before }));
  return null;
}
const withMods = (from: string, key: string) => {
  const p = parse(from);
  return [p.mod && 'mod', p.alt && 'alt', p.shift && 'shift', key].filter(Boolean).join('+');
};

/** Re-render when bindings change. */
export const useBindings = () => useStore((s) => s.settings.shortcuts);
