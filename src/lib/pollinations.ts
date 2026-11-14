/** Thin client for the Pollinations API (gen.pollinations.ai). */
import { b64ToBlob } from './img';
import { isCategory, LENGTHS, type Category, type Length } from './types';

const BASE = 'https://gen.pollinations.ai';

/** Where to buy more credits. */
export const TOP_UP_URL = 'https://enter.pollinations.ai/pollen#buy-pollen';

/**
 * Why a request did not go through:
 *   key     – the key was refused; only the person can fix that
 *   credits – the account has run out; picks up again once there is a balance
 *   busy    – too many requests; picks up again after a short wait
 *   offline – no connection; picks up again when it returns
 *   fail    – this one request went wrong; the next may be fine
 */
export type StudioFault = 'key' | 'credits' | 'busy' | 'offline' | 'fail';

export class StudioError extends Error {
  constructor(public kind: StudioFault, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function fail(res: Response): Promise<never> {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message ?? j?.message ?? '';
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) throw new StudioError('key', 'The studio key was not accepted.');
  if (res.status === 402) throw new StudioError('credits', 'The studio is out of credits.');
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after'));
    throw new StudioError('busy', 'The studio is busy.', Number.isFinite(wait) && wait > 0 ? wait : undefined);
  }
  throw new StudioError('fail', detail || `The studio answered with an error (${res.status}).`);
}

async function post(path: string, key: string, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) throw e; // stopped on purpose, not a lost connection
    throw new StudioError('offline', 'No connection to the studio.');
  }
  if (!res.ok) await fail(res);
  try {
    return await res.json();
  } catch {
    throw new StudioError('fail', 'The studio sent back something unreadable.');
  }
}

/** Ask the image model to redraw `photo` following `prompt`. Returns the new picture. */
export async function remake(opts: {
  key: string;
  model: string;
  prompt: string;
  photo: string; // data URL
  size: [number, number];
  signal?: AbortSignal;
}): Promise<Blob> {
  const j = await post('/v1/images/edits', opts.key, {
    model: opts.model,
    prompt: opts.prompt,
    image: [{ image_url: opts.photo }],
    size: `${opts.size[0]}x${opts.size[1]}`,
    response_format: 'b64_json',
  }, opts.signal);
  const first = j?.data?.[0];
  if (first?.b64_json) return b64ToBlob(first.b64_json);
  if (first?.url) {
    try {
      return await (await fetch(first.url)).blob();
    } catch {
      throw new StudioError('offline', 'No connection to the studio.');
    }
  }
  throw new StudioError('fail', 'The studio sent back no picture.');
}

export interface Seen { kind: Category; name: string; length?: Length }

/** A small model that looks at a picture. One look costs well under a hundredth of a remake. */
const EYES = 'openai/gpt-5.4-nano';

/**
 * What to ask. Home photos show clothes on wire hangers against a wall, or lying on a bed: a
 * hanger's shoulders and a bag's strap on a hook look like a jacket's, so the kinds are told
 * apart by what the piece has (sleeves, a neck opening, a closed body), not by how it hangs.
 */
const LOOK =
  'This photo shows one piece of clothing or one accessory to be catalogued, photographed at home: it may hang on a ' +
  'hanger or a hook against a wall, or lie on a bed or the floor. Ignore the hanger, the hook, the wall and the bed. ' +
  'Reply with JSON only: {"kind": one of outer|top|dress|bottom|socks|shoes|bag|extra, ' +
  '"name": a 2-4 word product name in English with its colour and type, ' +
  '"length": where the hem falls when worn, or null for socks, shoes, bags and accessories}. ' +
  'Length for tops, jackets and dresses: cropped (above the waist), hip, thigh, knee, calf or ankle. ' +
  'Length for trousers, shorts and skirts: thigh (shorts, mini), knee, calf (cropped trousers, culottes, midi) or ankle (full length). ' +
  'Kinds: bag = handbags, shoulder bags, crossbody bags, totes, backpacks, pouches, wallets: a closed body with handles or ' +
  'a strap, and no neck opening and no sleeves (a backpack is a bag even when its straps look like sleeves). ' +
  'outer = coats, jackets, blazers, waistcoats and vests, and cardigans: open all the way down the front and worn over another top. ' +
  'top = shirts and blouses (even with a collar and buttons), T-shirts, sweaters and jumpers pulled over the head, knit tops, ' +
  'tank tops, camisoles. dress = one piece from the shoulders past the hips, with or without sleeves. ' +
  'bottom = trousers, jeans, leggings, shorts and skirts. socks = socks and stockings. ' +
  'extra = scarves (a long strip or a flat square of fabric, with no neck opening and no sleeves), hats, belts, gloves, ' +
  'sunglasses, watches, jewellery, ties.';

/** Have a small vision model say what a photo shows: its kind, a short name, and how long it is. */
export async function look(key: string, photo: string, signal?: AbortSignal): Promise<Seen | null> {
  const j = await post('/v1/chat/completions', key, {
    model: EYES,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: LOOK },
        // 'low' detail is a 512 px thumbnail; a strap and a sleeve need more than that.
        { type: 'image_url', image_url: { url: photo, detail: 'high' } },
      ],
    }],
  }, signal);
  try {
    const text: string = j?.choices?.[0]?.message?.content ?? '';
    const v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!isCategory(v.kind)) return null;
    const name = typeof v.name === 'string' ? v.name.trim().slice(0, 48) : '';
    return {
      kind: v.kind,
      name: name ? name[0].toUpperCase() + name.slice(1) : '',
      length: LENGTHS.includes(v.length) ? v.length : undefined,
    };
  } catch {
    return null;
  }
}

/** A model that compares two pictures closely; still well under a cent a look. */
const JUDGE = 'openai/gpt-5.4-nano';

/**
 * Compare the original photo with the studio's last attempt and say what to fix: cut-off
 * parts, wrong colours, wrong or missing prints and logos, wrong shape or length.
 * Returns plain instructions for the image model, or '' when nothing stands out.
 */
export async function critique(key: string, photo: string, attempt: string, note: string, signal?: AbortSignal): Promise<string> {
  const j = await post('/v1/chat/completions', key, {
    model: JUDGE,
    reasoning_effort: 'low',
    max_completion_tokens: 1200,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Picture 1 is a photo of a piece of clothing or an accessory. Picture 2 is an attempt to redraw it as a clean ' +
            'product photo on a flat backdrop; the backdrop colour does not matter. List what picture 2 gets wrong compared ' +
            'with picture 1: parts cut off or missing (sleeves, hem, straps, toes), wrong colours or shades, prints, patterns, ' +
            'logos or text that are wrong, blurred or missing, wrong shape, length or proportions, extra things added. ' +
            (note ? `The owner, who knows this piece, says what is wrong: "${note.slice(0, 300)}". Your first fix must address that. ` : '') +
            'Reply with at most four short imperative fixes for an image model, one per line, each naming the exact detail ' +
            '(for example "Show both sleeves in full" or "Make the blue a deep navy, as in the photo"). Reply "none" if it is faithful.',
        },
        { type: 'image_url', image_url: { url: photo, detail: 'high' } },
        { type: 'image_url', image_url: { url: attempt, detail: 'high' } },
      ],
    }],
  }, signal);
  const text: string = (j?.choices?.[0]?.message?.content ?? '').trim();
  if (!text || /^none\.?$/i.test(text)) return '';
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
}

/** Remaining credits. `null` when it can't be read right now; 'bad' when the key is refused. */
export async function balance(key: string): Promise<number | 'bad' | null> {
  try {
    const res = await fetch(`${BASE}/account/balance`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return 'bad';
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.balance === 'number' ? j.balance : null;
  } catch {
    return null;
  }
}
