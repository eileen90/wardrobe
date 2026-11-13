/** Thin client for the Pollinations API (gen.pollinations.ai). */
import { b64ToBlob } from './img';
import { isCategory, LENGTHS, type Category, type Length } from './types';

const BASE = 'https://gen.pollinations.ai';

/**
 * Free community model used when the account runs out of credits. No quota, 8 requests a
 * minute, and its owner logs prompts and pictures. Rougher on prints, and it sometimes
 * refuses harmless photos (shoes, in testing).
 */
export const FREE_MODEL = 'community/scriptsnsenses-sys/flux-2-dev-free';

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
  } catch {
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

/** The cheapest model that can look at a picture. One look costs about 1/250 of a remake. */
const EYES = 'openai/gpt-5-nano';

/** Have a small vision model say what a photo shows: its kind, a short name, and how long it is. */
export async function look(key: string, photo: string, signal?: AbortSignal): Promise<Seen | null> {
  const j = await post('/v1/chat/completions', key, {
    model: EYES,
    reasoning_effort: 'minimal',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'This photo shows one piece of clothing or an accessory to be catalogued. Reply with JSON only: ' +
            '{"kind": one of outer|top|dress|bottom|shoes|bag|extra, ' +
            '"name": a 2-4 word product name in English with its colour and type, ' +
            '"length": where the hem falls when worn, one of cropped|hip|thigh|knee|calf|ankle, or null if it is not a garment}. ' +
            'outer = coats, jackets, blazers and cardigans worn over a top. bottom = trousers, jeans, shorts and skirts. extra = hats, scarves, belts, jewellery.',
        },
        { type: 'image_url', image_url: { url: photo, detail: 'low' } },
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
