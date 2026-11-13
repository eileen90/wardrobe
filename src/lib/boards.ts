import { realSize } from './kind';
import { BOARD_RATIO, uid, type Item, type Look, type Placed } from './types';

export function newLook(n: number, pieces: Placed[] = []): Look {
  return {
    id: uid(), name: `Look ${String(n + 1).padStart(2, '0')}`, createdAt: Date.now(), updatedAt: Date.now(),
    paper: '#ECECEC', pieces,
  };
}

/**
 * Where a piece lands on a board: near the middle (or where it was dropped), at the size it
 * really is next to the others. A board stands for about 1.8 m top to bottom.
 */
export function placeFresh(item: Item, n = 0, at?: { x: number; y: number }): Placed {
  const s = realSize(item);
  const cm = Math.max(180, s.h / 0.8);
  return {
    id: uid(), itemId: item.id,
    x: at?.x ?? 0.5 + ((n % 3) - 1) * 0.06,
    y: at?.y ?? 0.48 + ((n % 4) - 1.5) * 0.04,
    w: s.w / (cm * BOARD_RATIO), rot: 0, flip: false,
  };
}
