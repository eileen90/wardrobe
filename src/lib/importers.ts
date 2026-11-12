/** Getting pictures in from the web: a pasted image, an image link, or a shop page. */

const IMG_PROXY = (u: string) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&n=-1&output=png`;
const PAGE_PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function getImage(url: string): Promise<Blob | null> {
  // Straight from the site first (works when it allows other sites to read it),
  // then through an image relay that does.
  for (const u of [url, IMG_PROXY(url)]) {
    try {
      const r = await fetch(u, { referrerPolicy: 'no-referrer' });
      if (!r.ok) continue;
      const b = await r.blob();
      if (b.type.startsWith('image/') && b.size > 800) return b;
    } catch {
      /* try the next way */
    }
  }
  return null;
}

/** The main product picture a shop page advertises. */
function pictureFromPage(html: string, base: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content');
  let found =
    meta('meta[property="og:image:secure_url"]') ??
    meta('meta[property="og:image"]') ??
    meta('meta[name="twitter:image"]') ??
    meta('meta[name="twitter:image:src"]');
  if (!found) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const walk = (o: unknown): string | null => {
          if (!o || typeof o !== 'object') return null;
          const img = (o as Record<string, unknown>).image;
          if (typeof img === 'string') return img;
          if (Array.isArray(img) && typeof img[0] === 'string') return img[0];
          if (img && typeof img === 'object' && typeof (img as Record<string, unknown>).url === 'string')
            return (img as Record<string, string>).url;
          for (const v of Object.values(o)) {
            const r = walk(v);
            if (r) return r;
          }
          return null;
        };
        found = walk(JSON.parse(s.textContent ?? ''));
        if (found) break;
      } catch {
        /* not valid JSON */
      }
    }
  }
  if (!found) return null;
  try {
    return new URL(found, base).href;
  } catch {
    return null;
  }
}

export interface Imported { blob: Blob; url: string; name?: string }

/** Turn a pasted link into a picture. Throws a message meant for the person. */
export async function fromLink(input: string): Promise<Imported> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  if (/\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i.test(url.pathname + url.search)) {
    const b = await getImage(url.href);
    if (b) return { blob: b, url: url.href };
  }
  // A page: read it through a relay and look for its product picture.
  for (const p of PAGE_PROXIES) {
    try {
      const r = await fetch(p(url.href));
      if (!r.ok) continue;
      const type = r.headers.get('content-type') ?? '';
      if (type.startsWith('image/')) return { blob: await r.blob(), url: url.href };
      const html = await r.text();
      const pic = pictureFromPage(html, url.href);
      if (!pic) continue;
      const b = await getImage(pic);
      if (!b) continue;
      const title = new DOMParser().parseFromString(html, 'text/html')
        .querySelector('meta[property="og:title"]')?.getAttribute('content') ?? undefined;
      return { blob: b, url: url.href, name: title?.slice(0, 60) };
    } catch {
      /* try the next relay */
    }
  }
  // Last try: maybe it was an image after all.
  const b = await getImage(url.href);
  if (b) return { blob: b, url: url.href };
  throw new Error("Couldn't get a picture from that link. Save the picture to your photos and add it from there.");
}

/** Whatever picture or link is on the clipboard. */
export async function fromClipboard(): Promise<Imported | string | null> {
  if (!navigator.clipboard?.read) {
    const text = await navigator.clipboard?.readText?.();
    return text?.trim() || null;
  }
  const entries = await navigator.clipboard.read();
  for (const e of entries) {
    const type = e.types.find((t) => t.startsWith('image/'));
    if (type) return { blob: await e.getType(type), url: '' };
  }
  for (const e of entries) {
    if (e.types.includes('text/plain')) {
      const text = (await (await e.getType('text/plain')).text()).trim();
      if (text) return text;
    }
  }
  return null;
}
