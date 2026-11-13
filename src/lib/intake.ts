/**
 * The one way in. Files, pasted pictures, dropped pictures and links all end up here, and
 * every piece goes straight to the floor: nothing to fill in first.
 *
 *   your own picture → yours     a link to a shop → wishlist
 *   kind, name, brand and price are read from whatever came with it; the studio works out the rest.
 */
import { fromLink, readTransfer } from './importers';
import { fingerprint, mightBePicture, openPicture } from './img';
import { kindFromWords } from './kind';
import { getState } from './store';
import { addPicture, fetching } from './studio';

export interface Taken { added: number; twice: number; failed: number; message?: string }

const nothing = (): Taken => ({ added: 0, twice: 0, failed: 0 });

/** A camera file name ("IMG_2041.HEIC") says nothing; a saved product picture often does. */
const wordsIn = (name: string | undefined) =>
  (name ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[_\-+.]+/g, ' ').replace(/\b(img|dsc|pxl|image|photo|screenshot|截圖|螢幕)\b/gi, ' ');

export async function takeFiles(files: (Blob & { name?: string })[]): Promise<Taken> {
  const out = nothing();
  for (const file of files) {
    if (!mightBePicture(file)) { out.failed++; continue; }
    try {
      const hash = await fingerprint(file);
      if (hash && getState().items.some((i) => i.hash === hash)) { out.twice++; continue; }
      const img = await openPicture(file);
      // A file called "blue linen shirt.jpg" has named itself.
      const words = wordsIn(file.name).replace(/\s+/g, ' ').trim();
      const category = kindFromWords(words);
      await addPicture(img, file, {
        status: 'owned', from: 'photo', category, hash,
        name: category && words.length < 50 ? words[0].toUpperCase() + words.slice(1) : '',
      });
      out.added++;
    } catch (e) {
      out.failed++;
      out.message = e instanceof Error ? e.message : undefined;
    }
  }
  return out;
}

export async function takeLink(link: string): Promise<Taken> {
  const out = nothing();
  fetching(1);
  try {
    const got = await fromLink(link);
    const hash = await fingerprint(got.blob);
    if (hash && getState().items.some((i) => i.hash === hash)) return { ...out, twice: 1 };
    const img = await openPicture(got.blob);
    // A bare picture address is just a picture; a page is something you could buy.
    const isPage = !!got.name;
    await addPicture(img, got.blob, {
      status: isPage ? 'wish' : 'owned', from: 'web', url: isPage ? got.url : '',
      name: got.name, brand: got.brand, price: got.price, currency: got.currency,
      category: kindFromWords(got.name), hash,
    });
    out.added = 1;
  } catch (e) {
    out.failed = 1;
    out.message = e instanceof Error ? e.message : undefined;
  } finally {
    fetching(-1);
  }
  return out;
}

/** Take whatever a paste or a drop carries. */
export async function takeTransfer(dt: DataTransfer | null): Promise<Taken> {
  const { files, link } = readTransfer(dt);
  const pictures = files.filter(mightBePicture);
  if (pictures.length) return takeFiles(pictures);
  if (link) return takeLink(link);
  return nothing();
}

/** What to tell the person about it, or null when there is nothing worth saying. */
export function report(t: Taken): string | null {
  if (t.added) return null; // the pieces landing on the floor say it better
  if (t.twice) return t.twice === 1 ? 'Already in your closet' : 'Those are already in your closet';
  if (t.failed) return t.message ?? "That isn't a picture";
  return null;
}
