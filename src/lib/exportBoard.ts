import * as db from './db';
import { loadImage, makeCanvas, toBlob } from './img';
import { BOARD_RATIO, type Item, type Look } from './types';

/** Draw a look as a picture, with the same soft shadows as on screen. */
export async function renderLook(look: Look, items: Item[], width = 1600): Promise<Blob> {
  const W = width, H = Math.round(width / BOARD_RATIO);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = look.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  for (const p of look.pieces) {
    const item = items.find((i) => i.id === p.itemId);
    if (!item) continue;
    const blob = await db.getBlob(`${item.id}:${item.state === 'ready' ? 'cut' : 'raw'}`);
    if (!blob) continue;
    const img = await loadImage(blob);
    const w = p.w * W, h = w / item.aspect;
    ctx.save();
    ctx.translate(p.x * W, p.y * H);
    ctx.rotate((p.rot * Math.PI) / 180);
    if (p.flip) ctx.scale(-1, 1);
    // Canvas shadows ignore the transform, so the light stays overhead however a piece is turned.
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = W * 0.02;
    ctx.shadowOffsetY = W * 0.012;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return toBlob(c, 'image/png');
}

/** Hand the picture to the phone's share sheet, or download it where there is none. */
export async function shareLook(look: Look, items: Item[]) {
  const blob = await renderLook(look, items);
  const name = `${(look.name || 'look').replace(/[^\w\- ]+/g, '').trim() || 'look'}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: look.name });
      return 'shared' as const;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled' as const;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved' as const;
}
