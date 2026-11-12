export const CATEGORIES = [
  'Tops',
  'Bottoms',
  'Dresses',
  'Outerwear',
  'Shoes',
  'Bags',
  'Accessories',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Item {
  id: string;
  name: string;
  category: Category;
  /** owned = in my closet, wish = thinking about buying */
  status: 'owned' | 'wish';
  brand: string;
  price: string;
  url: string;
  notes: string;
  colors: string[];
  createdAt: number;
  /** cleaning = waiting for / running background removal */
  state: 'cleaning' | 'ready' | 'failed';
  hasCut: boolean;
  /** which picture is shown: the cleaned cut-out or the original photo */
  view: 'cut' | 'orig';
  cutAspect: number;
  origAspect: number;
  /** bumped whenever the pictures change, to refresh caches */
  rev: number;
}

export interface ItemLayer {
  id: string;
  kind: 'item';
  itemId: string;
  x: number;
  y: number;
  /** width in artboard units */
  w: number;
  rot: number;
  flip: boolean;
}
export interface TextLayer {
  id: string;
  kind: 'text';
  text: string;
  x: number;
  y: number;
  /** font size in artboard units */
  size: number;
  rot: number;
  font: 'serif' | 'sans';
  color: string;
}
export type Layer = ItemLayer | TextLayer;

export interface Board {
  id: string;
  name: string;
  bg: string;
  layers: Layer[];
  createdAt: number;
  updatedAt: number;
  rev: number;
}

export const BOARD_W = 1000;
export const BOARD_H = 1400;

export interface Backdrop {
  id: string;
  color: string;
  pattern?: 'grid' | 'dots';
  dark?: boolean;
}
export const BACKDROPS: Backdrop[] = [
  { id: 'paper', color: '#F6F3EC' },
  { id: 'white', color: '#FFFFFF' },
  { id: 'grid', color: '#F6F3EC', pattern: 'grid' },
  { id: 'dots', color: '#FFFFFF', pattern: 'dots' },
  { id: 'oat', color: '#E7DFD1' },
  { id: 'blush', color: '#F1DDD6' },
  { id: 'butter', color: '#F3E9C6' },
  { id: 'sage', color: '#D5DDCB' },
  { id: 'sky', color: '#D3DEE8' },
  { id: 'lilac', color: '#DDD6E8' },
  { id: 'cocoa', color: '#4A3A30', dark: true },
  { id: 'ink', color: '#1B1A17', dark: true },
];
export const backdrop = (id: string) => BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
