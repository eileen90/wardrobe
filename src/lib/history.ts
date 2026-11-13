/**
 * Everything you do can be taken back, in order, for as long as the app is open: the toast
 * offers it right away, and later the undo button (or ⌘Z / Ctrl+Z) walks back step by step.
 */
import { useSyncExternalStore } from 'react';
import { toast } from '../ui';

interface Step { label: string; undo: () => void | Promise<void> }

const steps: Step[] = [];
const MAX = 100;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

/** Remember how to take something back, and offer it in a toast. */
export function record(label: string, undo: Step['undo'], { quiet = false } = {}) {
  const step = { label, undo };
  steps.push(step);
  if (steps.length > MAX) steps.shift();
  changed();
  if (!quiet) toast(label, { label: 'Undo', run: () => void take(step) });
}

/** Take back one particular step (the toast's own), wherever it sits in the history. */
async function take(step: Step) {
  const at = steps.lastIndexOf(step);
  if (at < 0) return;
  steps.splice(at, 1);
  changed();
  await step.undo();
}

/** Take back the most recent step. */
export async function undoLast() {
  const step = steps[steps.length - 1];
  if (!step) return;
  await take(step);
  toast(`Undone: ${step.label.toLowerCase()}`);
}

/** The step the undo button would take back, if any. */
export function useLastStep() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => steps[steps.length - 1]?.label ?? null,
  );
}
