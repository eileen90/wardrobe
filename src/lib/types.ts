export type Category = 'outer' | 'top' | 'dress' | 'bottom' | 'shoes' | 'bag' | 'extra';

export const CATEGORIES: { id: Category; label: string; plural: string }[] = [
  { id: 'outer', label: 'jacket', plural: 'jackets & coats' },
  { id: 'top', label: 'top', plural: 'tops' },
  { id: 'dress', label: 'dress', plural: 'dresses' },
  { id: 'bottom', label: 'bottom', plural: 'bottoms' },
  { id: 'shoes', label: 'shoes', plural: 'shoes' },
  { id: 'bag', label: 'bag', plural: 'bags' },
  { id: 'extra', label: 'extra', plural: 'extras' },
];
export const catLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)!.label;
export const catPlural = (c: Category) => CATEGORIES.find((x) => x.id === c)!.plural;

/**
 * queued  – waiting for the studio
 * working – being remade / cut out right now
 * ready   – clean cut-out available
 * raw     – only the original photo (studio not connected, or it could not be cut out)
 */
export type ItemState = 'queued' | 'working' | 'ready' | 'raw';

export interface Item {
  id: string;
  name: string;
  category: Category;
  status: 'owned' | 'wish';
  brand: string;
  price: string;
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
  /** bumped whenever the pictures change, so cached URLs refresh */
  rev: number;
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
}

export const MODELS = [
  { id: 'black-forest-labs/flux.2-klein-4b', label: 'quick', hint: 'about 10 seconds a photo, lowest credit use' },
  { id: 'black-forest-labs/flux.1-kontext-pro', label: 'careful', hint: 'stays closer to prints and logos, uses about six times the credits' },
];

export const PAPERS = ['#ECECEC', '#FFFFFF', '#DAD7D0', '#C9D3DD', '#111111', '#0A14FF'];

export const BOARD_RATIO = 4 / 5;

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
