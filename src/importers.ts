// Getting pictures in from the web and the clipboard.

async function tryFetchImage(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith('image/') ? b : null;
  } catch {
    return null;
  }
}

// Free public image proxy that adds the CORS headers shops usually lack.
const viaProxy = (u: string) =>
  `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=1600&h=1600&fit=inside&we&output=png`;

async function fetchImage(url: string) {
  return (await tryFetchImage(url)) ?? (await tryFetchImage(viaProxy(url)));
}

/** For a product-page link: find the page's main picture (og:image). */
async function findPagePicture(pageUrl: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`);
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 600_000);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const found =
      doc.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content') ||
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
    return found ? new URL(found, pageUrl).href : null;
  } catch {
    return null;
  }
}

export async function importFromUrl(raw: string): Promise<Blob> {
  let url: URL;
  try {
    url = new URL(raw.trim());
    if (!/^https?:$/.test(url.protocol)) throw 0;
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  const direct = await fetchImage(url.href);
  if (direct) return direct;
  const pic = await findPagePicture(url.href);
  const viaPage = pic && (await fetchImage(pic));
  if (viaPage) return viaPage;
  throw new Error(
    "Couldn't grab a picture from that link. Try pressing and holding the picture on the site, choose Copy, then use Paste here.",
  );
}

export async function importFromClipboard(): Promise<{ image?: Blob; text?: string }> {
  if (!navigator.clipboard?.read) {
    throw new Error("This browser won't let me read the clipboard. Save the picture and add it from Photos instead.");
  }
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error('Clipboard access was blocked. Tap Paste again and allow it.');
  }
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) return { image: await it.getType(type) };
  }
  for (const it of items) {
    if (it.types.includes('text/plain')) {
      const text = (await (await it.getType('text/plain')).text()).trim();
      if (/^https?:\/\//.test(text)) return { text };
    }
  }
  throw new Error('No picture or link on the clipboard.');
}
