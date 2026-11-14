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

/**
 * Draw `src` scaled so its longest side is at most `max`. Big reductions go in halves, each
 * step averaging the pixels it drops: one large jump samples only a few of them, and fine
 * stripes come out as coarse false ones (moiré).
 */
export function scaled(src: CanvasImageSource & { width: number; height: number }, max: number) {
  const w = 'naturalWidth' in src ? (src as HTMLImageElement).naturalWidth : src.width;
  const h = 'naturalHeight' in src ? (src as HTMLImageElement).naturalHeight : src.height;
  const k = Math.min(1, max / Math.max(w, h));
  let from: CanvasImageSource = src, fw = w, fh = h;
  while (fw / 2 >= w * k && fh / 2 >= 1) {
    const half = makeCanvas(fw / 2, fh / 2);
    const hx = half.getContext('2d')!;
    hx.imageSmoothingQuality = 'high';
    hx.drawImage(from, 0, 0, half.width, half.height);
    from = half; fw = half.width; fh = half.height;
  }
  const c = makeCanvas(w * k, h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, 0, 0, c.width, c.height);
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

/* ---------- opening whatever file comes in ---------- */

/** HEIC / HEIF files start with an `ftyp` box naming one of these brands. */
async function isHeic(file: Blob) {
  if (/hei[cf]/i.test(file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && /heic|heix|heim|heis|hevc|hevx|mif1|msf1|avci/.test(text.slice(8, 32));
}

/**
 * Open a picture file of any kind the phone or computer might hand over. iPhone photos (HEIC)
 * are opened natively where the browser can (Safari), and converted on the device elsewhere;
 * the converter is only downloaded the first time one is needed.
 */
export async function openPicture(file: Blob): Promise<HTMLImageElement> {
  try {
    return await loadImage(file);
  } catch (e) {
    if (!(await isHeic(file))) throw e;
  }
  try {
    const { heicTo } = await import('heic-to');
    return await loadImage(await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 }));
  } catch {
    throw new Error("That iPhone photo couldn't be opened.");
  }
}

/** True for anything that might be a picture, judged by type or file name. */
export const mightBePicture = (f: Blob & { name?: string }) =>
  f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name ?? '');

/** A short fingerprint of a file's bytes. */
export async function fingerprint(file: Blob): Promise<string> {
  try {
    const sum = await crypto.subtle.digest('SHA-1', await file.arrayBuffer());
    return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  } catch {
    return '';
  }
}
