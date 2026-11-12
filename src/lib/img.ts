/** Small canvas helpers shared by the studio, the boards and export. */

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture this browser can open."));
    };
    img.src = url;
  });
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draw `src` scaled so its longest side is at most `max`. */
export function scaled(src: CanvasImageSource & { width: number; height: number }, max: number) {
  const w = 'naturalWidth' in src ? (src as HTMLImageElement).naturalWidth : src.width;
  const h = 'naturalHeight' in src ? (src as HTMLImageElement).naturalHeight : src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = makeCanvas(w * k, h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function toBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the picture.'))), type, q),
  );
}

/** JPEG on white: for photos, where transparency would only waste space. */
export function flatJpeg(c: HTMLCanvasElement, q = 0.88) {
  const f = makeCanvas(c.width, c.height);
  const ctx = f.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.drawImage(c, 0, 0);
  return toBlob(f, 'image/jpeg', q);
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Could not read the picture.'));
    r.readAsDataURL(b);
  });
}

export function b64ToBlob(b64: string, type = 'image/png') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
