import * as db from './db';
import { loadImage, makeCanvas, toBlob } from './images';
import { getItem, imgKey, itemAspect, showsCut } from './store';
import { BOARD_H, BOARD_W, backdrop, type Layer } from './types';

export const FONT = {
  serif: '"Instrument Serif", "Iowan Old Style", Georgia, serif',
  sans: '"Inter Tight Variable", "Helvetica Neue", Arial, sans-serif',
};
export const LINE = 1.15;
export const GRID_STEP = 50;
export const DOT_STEP = 40;

/** Draw a board to a canvas `width` pixels wide. */
export async function renderBoard(
  bg: string,
  layers: Layer[],
  width: number,
  thumbs = false,
): Promise<HTMLCanvasElement> {
  const k = width / BOARD_W;
  const c = makeCanvas(width, BOARD_H * k);
  const ctx = c.getContext('2d')!;
  const bd = backdrop(bg);
  ctx.fillStyle = bd.color;
  ctx.fillRect(0, 0, c.width, c.height);
  if (bd.pattern === 'grid') {
    ctx.strokeStyle = 'rgba(27,26,23,0.07)';
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    for (let x = GRID_STEP; x < BOARD_W; x += GRID_STEP) {
      ctx.moveTo(x * k, 0);
      ctx.lineTo(x * k, c.height);
    }
    for (let y = GRID_STEP; y < BOARD_H; y += GRID_STEP) {
      ctx.moveTo(0, y * k);
      ctx.lineTo(c.width, y * k);
    }
    ctx.stroke();
  } else if (bd.pattern === 'dots') {
    ctx.fillStyle = 'rgba(27,26,23,0.16)';
    for (let x = DOT_STEP / 2; x < BOARD_W; x += DOT_STEP) {
      for (let y = DOT_STEP / 2; y < BOARD_H; y += DOT_STEP) {
        ctx.beginPath();
        ctx.arc(x * k, y * k, 2 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  await document.fonts?.ready;

  for (const l of layers) {
    ctx.save();
    ctx.translate(l.x * k, l.y * k);
    ctx.rotate((l.rot * Math.PI) / 180);
    if (l.kind === 'item') {
      const item = getItem(l.itemId);
      const blob = item && (await db.getBlob(imgKey(item, thumbs)));
      if (item && blob) {
        const img = await loadImage(blob);
        const w = l.w * k;
        const h = w / itemAspect(item);
        if (l.flip) ctx.scale(-1, 1);
        ctx.shadowColor = showsCut(item) ? 'rgba(40,28,16,0.22)' : 'rgba(40,28,16,0.16)';
        ctx.shadowBlur = 22 * k;
        ctx.shadowOffsetY = 10 * k;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    } else {
      const size = l.size * k;
      ctx.font = `${size}px ${FONT[l.font]}`;
      ctx.fillStyle = l.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = l.text.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * size * LINE);
      });
    }
    ctx.restore();
  }
  return c;
}

export async function saveBoardThumb(id: string, bg: string, layers: Layer[]) {
  const c = await renderBoard(bg, layers, 400, true);
  await db.putBlob(`board:${id}:t`, await toBlob(c, 'image/jpeg', 0.86));
}

/** Share (phone share sheet) or download a full-size picture of the board. */
export async function shareBoard(name: string, bg: string, layers: Layer[]) {
  const c = await renderBoard(bg, layers, 2000);
  const blob = await toBlob(c, 'image/png');
  const file = new File([blob], `${(name || 'outfit').replace(/[^\w\- ]+/g, '').trim() || 'outfit'}.png`, {
    type: 'image/png',
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(file, file.name);
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
