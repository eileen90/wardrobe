/** Getting pictures in from the web: an image link or a shop page. */
import { brandFromSite, cleanUrl } from './links';
import { parsePrice } from './money';

const IMG_PROXY = (u: string) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&n=-1&output=png`;
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

interface Page { pic: string; title?: string; brand?: string; price?: string; currency?: string }

/**
 * Ask a link-preview service for a page's main picture, title and shop name.
 * Shops don't let other sites read their pages directly, so this has to go through a relay.
 */
async function readPage(page: string): Promise<Page | null> {
  try {
    const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(page)}`);
    if (r.ok) {
      const d = (await r.json())?.data;
      if (d?.image?.url) return { pic: d.image.url, title: d.title, brand: d.publisher };
    }
  } catch {
    /* try the next one */
  }
  try {
    const r = await fetch(`https://r.jina.ai/${page}`, {
      headers: { Accept: 'application/json', 'X-With-Images-Summary': 'true' },
    });
    if (r.ok) {
      const d = (await r.json())?.data;
      const m = d?.metadata ?? {};
      const pic = m['og:image'] ?? Object.values(d?.images ?? {})[0];
      if (typeof pic === 'string') {
        const amount = m['product:price:amount'] ?? m['og:price:amount'];
        return {
          pic,
          title: m['og:title'] ?? d?.title,
          brand: m['og:site_name'],
          price: amount ? parsePrice(String(amount)).amount : undefined,
          currency: m['product:price:currency'] ?? m['og:price:currency'],
        };
      }
    }
  } catch {
    /* nothing more to try */
  }
  return null;
}

/** "Linen Shirt | Some Shop" → "Linen Shirt": keep the longest part of a page title. */
function productName(title?: string) {
  if (!title) return undefined;
  const parts = title.split(/\s[|–—-]\s/).map((p) => p.trim()).filter(Boolean);
  return parts.sort((a, b) => b.length - a.length)[0]?.slice(0, 60);
}

export interface Imported { blob: Blob; url: string; name?: string; brand?: string; price?: string; currency?: string }

/** Turn a link into a picture. Throws a message meant for the person. */
export async function fromLink(input: string): Promise<Imported> {
  const href = cleanUrl(input);
  if (!href) throw new Error("That doesn't look like a link.");
  const url = new URL(href);
  if (/\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i.test(url.pathname + url.search)) {
    const b = await getImage(href);
    if (b) return { blob: b, url: href };
  }
  // A shop page: find its product picture.
  const found = await readPage(href);
  if (found) {
    const b = await getImage(found.pic);
    if (b) {
      return {
        blob: b, url: href, name: productName(found.title),
        brand: found.brand?.trim() || brandFromSite(href), price: found.price, currency: found.currency,
      };
    }
  }
  // Last try: maybe it was an image after all.
  const b = await getImage(href);
  if (b) return { blob: b, url: href };
  throw new Error("Couldn't get a picture from that link.");
}

/**
 * What a paste or a drop carries: picture files, and failing that a link (a picture dragged
 * out of another browser window arrives as its address, or as a scrap of HTML around it).
 */
export function readTransfer(dt: DataTransfer | null): { files: File[]; link: string | null } {
  if (!dt) return { files: [], link: null };
  const files = [...dt.files];
  let link: string | null = null;
  const html = dt.getData('text/html');
  const src = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  if (src && /^https?:/i.test(src)) link = src.replace(/&amp;/g, '&');
  if (!link) {
    const text = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'))?.trim();
    if (text && /^(https?:\/\/|www\.)\S+$/i.test(text)) link = text;
  }
  return { files, link };
}
