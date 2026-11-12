/** Thin client for the Pollinations image API (gen.pollinations.ai). */
import { b64ToBlob } from './img';

const BASE = 'https://gen.pollinations.ai';

/** An error whose message is already written for the person using the app. */
export class StudioError extends Error {
  /** 'key' = fix the key in settings, 'credits' = top up, 'retry' = try again later */
  constructor(message: string, public kind: 'key' | 'credits' | 'retry') {
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
  if (res.status === 401 || res.status === 403)
    throw new StudioError('The studio key was not accepted. Check it in settings.', 'key');
  if (res.status === 402)
    throw new StudioError('The studio account is out of credits.', 'credits');
  if (res.status === 429)
    throw new StudioError('The studio is busy. Try again in a minute.', 'retry');
  throw new StudioError(
    detail ? `The studio could not remake this photo: ${detail}` : 'The studio could not remake this photo.',
    'retry',
  );
}

/** Ask the image model to redraw `photo` following `prompt`. Returns the new picture. */
export async function remake(opts: {
  key: string;
  model: string;
  prompt: string;
  photo: string; // data URL
  signal?: AbortSignal;
}): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/v1/images/edits`, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        image: [{ image_url: opts.photo }],
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    });
  } catch {
    throw new StudioError('No connection to the studio. Check the internet and try again.', 'retry');
  }
  if (!res.ok) await fail(res);
  const j = await res.json();
  const first = j?.data?.[0];
  if (first?.b64_json) return b64ToBlob(first.b64_json);
  if (first?.url) return (await fetch(first.url)).blob();
  throw new StudioError('The studio sent back no picture. Try again.', 'retry');
}

/** Remaining credits, or null when the key cannot be read. */
export async function balance(key: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/account/balance`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.balance === 'number' ? j.balance : null;
  } catch {
    return null;
  }
}
