/**
 * True size on the looks board. `realSize` (kind.ts) reads a top's and a bottom's height off a
 * typical width, but their width is what varies most: sleeves spread a sweater far wider than a
 * tee, and trouser legs lie apart. That drew a pair of trousers (44 cm wide, so 75 cm long) not
 * much longer than a sweater, and wide-leg trousers read "ankle length" were overruled by their
 * outline down to 55 cm. Here tops are read from their length, and bottoms from what they are:
 * long trousers about 100 cm, skirts by their width, shorts short. Every other kind is as
 * realSize has it.
 */
import { realSize } from './kind';
import type { Item, Length } from './types';

type Sized = Pick<Item, 'category' | 'aspect' | 'length' | 'state'> & { name?: string };

const LEGS: Record<Length, number> = { cropped: 88, hip: 26, thigh: 38, knee: 60, calf: 82, ankle: 100 };
const SHORT = /shorts|bermudas?|短褲|短裤|ショーツ|ショートパンツ|반바지/i;
const SKIRT = /skirts?|skorts?|裙|スカート|스커트|치마/i;
const LONG = /pants|trousers|jeans|denims?|slacks|chinos|joggers|sweatpants|leggings|culottes|cargos?|tights|褲|裤|パンツ|ジーンズ|デニム|바지/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Waist to hem from the outline and the name, in centimetres. */
function legs(a: number, name = ''): number {
  if (SHORT.test(name)) return clamp(54 / a, 24, 60);
  if (SKIRT.test(name)) return clamp(50 / a, 30, 100);
  // Taller than wide by this much, only trousers: about a metre, whatever the cut.
  if (a <= 0.72) return clamp(100 + (0.5 - a) * 20, 96, 106);
  // Wide legs and culottes are still trousers when they say so.
  if (LONG.test(name)) return clamp(100 - (a - 0.72) * 40, 84, 100);
  // Squarer and wider: shorts or a short skirt; in between, somewhere between the two.
  if (a >= 1.05) return clamp(54 / a, 24, 60);
  const t = (a - 0.72) / (1.05 - 0.72);
  return 100 * (1 - t) + (54 / 1.05) * t;
}

export function trueSize(item: Sized): { w: number; h: number } {
  const a = item.aspect > 0 ? item.aspect : 1;
  if (item.state !== 'ready') return realSize(item);
  if (item.category === 'bottom') {
    const shape = legs(a, item.name);
    let h = item.length ? LEGS[item.length] : shape;
    // A length the outline flatly contradicts is a misreading: the outline wins.
    if (h < shape / 1.6 || h > shape * 1.6) h = shape;
    let w = h * a;
    if (w > 84) { h *= 84 / w; w = 84; }
    return { w, h };
  }
  if (item.category === 'top' && !item.length) {
    // Collar to hem is 60 to 70 cm on most tops; sleeves only widen the outline.
    const h = clamp(64 * Math.pow(0.94 / a, 0.35), 42, 82);
    let w = h * a;
    const hh = w > 114 ? (h * 114) / w : h;
    w = Math.min(w, 114);
    return { w, h: hh };
  }
  return realSize(item);
}
