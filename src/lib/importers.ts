/** Getting pictures in from the web: a pasted image, an image link, or a shop page. */

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

/**
 * Ask a link-preview service for a page's main picture and title.
 * Shops don't let other sites read their pages directly, so this has to go through a relay.
 */
async function pictureFromPage(page: string): Promise<{ pic: string; title?: string } | null> {
  try {
    const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(page)}`);
    if (r.ok) {
      const d = (await r.json())?.data;
      if (d?.image?.url) return { pic: d.image.url, title: d.title };
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
      const pic = d?.metadata?.['og:image'] ?? Object.values(d?.images ?? {})[0];
      if (typeof pic === 'string') return { pic, title: d?.title };
    }
  } catch {
    /* nothing more to try */
  }
  return null;
}

/** "Linen Shirt | Some Shop" → "Linen Shirt": keep the longest part of a page title. */
function productName(title?: string) {
  if (!title) return undefined;
  const parts = title.split(/\s[|\u2013\u2014-]\s/).map((p) => p.trim()).filter(Boolean);
  return parts.sort((a, b) => b.length - a.length)[0]?.slice(0, 60);
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
  // A shop page: find its product picture.
  const found = await pictureFromPage(url.href);
  if (found) {
    const b = await getImage(found.pic);
    if (b) return { blob: b, url: url.href, name: productName(found.title) };
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
