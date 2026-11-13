/** 'extra' is shown as "accessory"; the id stays for closets saved by earlier versions. */
export type Category = 'outer' | 'top' | 'dress' | 'bottom' | 'socks' | 'shoes' | 'bag' | 'extra';

export const CATEGORIES: { id: Category; label: string; plural: string }[] = [
  { id: 'outer', label: 'jacket', plural: 'jackets & coats' },
  { id: 'top', label: 'top', plural: 'tops' },
  { id: 'dress', label: 'dress', plural: 'dresses' },
  { id: 'bottom', label: 'bottom', plural: 'bottoms' },
  { id: 'socks', label: 'socks', plural: 'socks' },
  { id: 'shoes', label: 'shoes', plural: 'shoes' },
  { id: 'bag', label: 'bag', plural: 'bags' },
  { id: 'extra', label: 'accessory', plural: 'accessories' },
];
export const catLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)!.label;
export const catPlural = (c: Category) => CATEGORIES.find((x) => x.id === c)!.plural;
export const isCategory = (v: unknown): v is Category => CATEGORIES.some((c) => c.id === v);

/** Where a garment's hem falls on the body. */
export type Length = 'cropped' | 'hip' | 'thigh' | 'knee' | 'calf' | 'ankle';
export const LENGTHS: Length[] = ['cropped', 'hip', 'thigh', 'knee', 'calf', 'ankle'];

/**
 * queued  – waiting for the studio (also while it is out of credits or offline: the backlog)
 * working – being remade / cut out right now
 * ready   – clean cut-out available
 * raw     – only the original photo: no studio key yet, or this one could not be cut out
 */
export type ItemState = 'queued' | 'working' | 'ready' | 'raw';

export interface Item {
  id: string;
  name: string;
  category: Category;
  /** false while the kind is only the app's first guess and nothing has confirmed it */
  kindSure: boolean;
  length?: Length;
  status: 'owned' | 'wish';
  brand: string;
  /** plain number as text, e.g. "1280" */
  price: string;
  /** ISO code, e.g. "TWD" */
  currency: string;
  url: string;
  note: string;
  colors: string[];
  createdAt: number;
  state: ItemState;
  /** why the last studio run did not produce a cut-out, in plain words */
  problem?: string;
  /** true when the cut-out came from the image generator rather than the original pixels */
  remade: boolean;
  /** width / height of the cut-out (or of the photo while there is no cut-out) */
  aspect: number;
  /** where the picture came from: your own camera roll, or the web */
  from: 'photo' | 'web';
  /** bumped whenever the pictures change, so cached URLs refresh */
  rev: number;
  /** where it was put on the floor, in floor cells from the middle; `t` orders the pile */
  spot?: { x: number; y: number; t: number };
  /** position inside its rail when the closet is lined up */
  order?: number;
  /** fingerprint of the picture file, so the same file isn't added twice */
  hash?: string;
  /** set while a removal can still be undone */
  gone?: number;
}

export interface Placed {
  id: string;
  itemId: string;
  /** centre, as a fraction of the board width / height */
  x: number;
  y: number;
  /** width as a fraction of the board width */
  w: number;
  rot: number;
  flip: boolean;
}

export interface Look {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  paper: string;
  pieces: Placed[];
}

export interface Settings {
  /** Pollinations secret key, kept on this device only */
  key: string;
  model: string;
  closetView: 'scatter' | 'grid';
  /** currency new prices start in: the one used last */
  currency: string;
}

/** Credits one remake costs with each model. */
export const MODELS = [
  { id: 'black-forest-labs/flux.2-klein-4b', label: 'Quick', hint: 'About 10 seconds a photo', cost: 0.005 },
  { id: 'black-forest-labs/flux.1-kontext-pro', label: 'Careful', hint: 'Closer on prints and logos, six times the credits', cost: 0.03 },
  { id: 'microsoft/mai-image-2.6', label: 'Best', hint: 'Truest colours and prints, about 20 seconds, eight times the credits', cost: 0.04 },
];
/** What a redo uses unless you pick another: usually something came out wrong, so the most faithful. */
export const REDO_MODEL = 'microsoft/mai-image-2.6';
export const costOf = (model: string) => MODELS.find((m) => m.id === model)?.cost ?? MODELS[0].cost;

export const PAPERS = ['#ECECEC', '#FFFFFF', '#DAD7D0', '#C9D3DD', '#111111', '#0A14FF'];

export const BOARD_RATIO = 4 / 5;

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
