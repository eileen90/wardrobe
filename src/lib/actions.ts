/** Things that can be taken back: they happen at once, and a toast offers the way back. */
import { removeItem, removeLook } from './store';
import { resume } from './studio';
import { toast } from '../ui';

export function removePiece(id: string) {
  const undo = removeItem(id);
  toast('Removed', {
    label: 'Undo',
    run: () => {
      undo();
      // If the studio was still working on it, it goes back in line.
      resume();
    },
  });
}

export function deleteLook(id: string) {
  const undo = removeLook(id);
  toast('Look deleted', { label: 'Undo', run: undo });
}
