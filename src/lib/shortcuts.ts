/**
 * Every shortcut in one place, so a gesture means the same thing on every screen and the
 * owner can rebind any of them in Settings. Screens never test keys or modifiers themselves:
 * they ask `isKey(e, 'undo')` or `isPointer(e, 'resize')`.
 *
 * A binding is a string: modifiers joined with '+', then a key name (as in KeyboardEvent.key,
 * case-insensitive) or a pointer gesture ('click' | 'drag').
 *   'mod' = ⌘ on Apple devices, Ctrl elsewhere.  Examples: 'mod+z', 'alt+drag', 'shift+click', 'F12'.
 */
import { getState, saveSettings, useStore } from './store';

export type ShortcutId =
  // everywhere
  | 'undo' | 'shortcuts' | 'close'
  // pieces on any canvas (closet floor, look boards)
  | 'select' | 'selectRange' | 'selectAll' | 'resize' | 'remove' | 'nudge'
  | 'duplicate' | 'forward' | 'backward' | 'grow' | 'shrink' | 'flip' | 'fit'
  // looks
  | 'railUp' | 'railDown' | 'prev' | 'next' | 'keep' | 'clear' | 'pickAll' | 'shuffle' | 'save';

export interface Shortcut { id: ShortcutId; label: string; where: string; keys: string }

export const SHORTCUTS: Shortcut[] = [
  { id: 'undo', label: 'Undo', where: 'Everywhere', keys: 'mod+z' },
  { id: 'shortcuts', label: 'Show shortcuts', where: 'Everywhere', keys: 'F12' },
  { id: 'close', label: 'Close or clear', where: 'Everywhere', keys: 'Escape' },

  { id: 'select', label: 'Select a piece', where: 'Closet and looks', keys: 'mod+click' },
  { id: 'selectRange', label: 'Select a range', where: 'Closet and looks', keys: 'shift+click' },
  { id: 'selectAll', label: 'Select all', where: 'Closet and looks', keys: 'mod+a' },
  { id: 'resize', label: 'Resize (drag up or down)', where: 'Closet and looks', keys: 'alt+drag' },
  { id: 'remove', label: 'Remove', where: 'Closet and looks', keys: 'Backspace' },
  { id: 'nudge', label: 'Nudge', where: 'Closet and looks', keys: 'arrows' },
  { id: 'duplicate', label: 'Duplicate', where: 'Looks', keys: 'mod+d' },
  { id: 'forward', label: 'Bring forward', where: 'Closet and looks', keys: ']' },
  { id: 'backward', label: 'Send backward', where: 'Closet and looks', keys: '[' },
  { id: 'grow', label: 'Bigger', where: 'Closet and looks', keys: '=' },
  { id: 'shrink', label: 'Smaller', where: 'Closet and looks', keys: '-' },
  { id: 'flip', label: 'Flip', where: 'Closet and looks', keys: 'f' },
  { id: 'fit', label: 'Fit everything in view', where: 'Closet and looks', keys: '0' },

  { id: 'railUp', label: 'Previous kind', where: 'Looks', keys: 'ArrowUp' },
  { id: 'railDown', label: 'Next kind', where: 'Looks', keys: 'ArrowDown' },
  { id: 'prev', label: 'Previous piece', where: 'Looks and a piece', keys: 'ArrowLeft' },
  { id: 'next', label: 'Next piece', where: 'Looks and a piece', keys: 'ArrowRight' },
  { id: 'keep', label: 'Keep this piece', where: 'Looks', keys: 'l' },
  { id: 'clear', label: 'Take this piece off', where: 'Looks', keys: 'Delete' },
  { id: 'pickAll', label: 'All pieces of this kind', where: 'Looks', keys: 'Enter' },
  { id: 'shuffle', label: 'Shuffle', where: 'Looks', keys: ' ' },
  { id: 'save', label: 'Save the look', where: 'Looks', keys: 's' },
];

const isApple = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);

/** The binding in force: the owner's, else the default. */
export function bindingOf(id: ShortcutId): string {
  return getState().settings.shortcuts?.[id] ?? SHORTCUTS.find((s) => s.id === id)!.keys;
}

interface Parsed { mod: boolean; alt: boolean; shift: boolean; key: string }
function parse(binding: string): Parsed {
  const parts = binding === '+' ? ['+'] : binding.split('+').filter(Boolean);
  const key = binding.endsWith('++') ? '+' : parts[parts.length - 1] ?? '';
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  return { mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift'), key: key.toLowerCase() };
}

const modDown = (e: { metaKey: boolean; ctrlKey: boolean }) => (isApple ? e.metaKey : e.ctrlKey);
const ARROWS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'];

/** Does this key press trigger the shortcut? */
export function isKey(e: KeyboardEvent | React.KeyboardEvent, id: ShortcutId): boolean {
  const b = parse(bindingOf(id));
  if (b.key === 'click' || b.key === 'drag') return false;
  if (modDown(e) !== b.mod || e.altKey !== b.alt) return false;
  const k = e.key.toLowerCase();
  if (b.key === 'arrows') return ARROWS.includes(k);
  // Shift is implied for keys that need it to be typed ('+', ']' on some layouts).
  if (b.shift && !e.shiftKey) return false;
  return k === b.key || (b.key === '=' && k === '+');
}

/** Is this click or drag the shortcut's gesture (judged by the modifiers held)? */
export function isPointer(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, id: ShortcutId): boolean {
  const b = parse(bindingOf(id));
  if (b.key !== 'click' && b.key !== 'drag') return false;
  return modDown(e) === b.mod && e.altKey === b.alt && e.shiftKey === b.shift;
}

/** How a binding reads on this device: '⌘Z', '⌥ drag', 'F12'. */
export function describe(binding: string): string {
  const b = parse(binding);
  const name: Record<string, string> = {
    ' ': 'Space', escape: 'Esc', backspace: '⌫', delete: '⌦', enter: '↩', arrows: '← → ↑ ↓',
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', click: 'click', drag: 'drag',
  };
  const key = name[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : binding.split('+').pop()!);
  const mods = [
    b.mod && (isApple ? '⌘' : 'Ctrl+'),
    b.alt && (isApple ? '⌥' : 'Alt+'),
    b.shift && (isApple ? '⇧' : 'Shift+'),
  ].filter(Boolean).join('');
  return b.key === 'click' || b.key === 'drag' ? `${mods.replace(/\+$/, '')} ${key}`.trim() : mods + key;
}

/** Record a key press as a binding string (for rebinding in Settings). */
export function bindingFrom(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  return [modDown(e) && 'mod', e.altKey && 'alt', e.shiftKey && e.key.length > 1 && 'shift', e.key]
    .filter(Boolean).join('+');
}

export async function rebind(id: ShortcutId, keys: string | null) {
  const cur = { ...(getState().settings.shortcuts ?? {}) };
  if (keys === null) delete cur[id];
  else cur[id] = keys;
  await saveSettings({ shortcuts: cur });
}

/** Re-render when bindings change. */
export const useBindings = () => useStore((s) => s.settings.shortcuts);
