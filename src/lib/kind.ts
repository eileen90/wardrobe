/**
 * Working out what a piece is and how big it really is, without asking anyone.
 *
 * Kind, cheapest source first:
 *   1. words (a product title, a file name)            – free
 *   2. one small look by a vision model (in studio.ts) – about 1/250 of a remake
 *   3. the outline of the cut-out                      – free, a rough guess
 */
import { makeCanvas } from './img';
import type { Category, Item, Length } from './types';

/* ---------- 1. words ---------- */

const WORDS: [Category, RegExp][] = [
  ['shoes', /\b(shoes?|sneakers?|trainers?|boots?|booties|loafers?|sandals?|heels?|pumps|flats|mules?|slippers?|slides|oxfords?|derbys?|espadrilles?|clogs?|footwear)\b|鞋|靴|スニーカー|ブーツ|サンダル|パンプス/i],
  ['bag', /\b(bags?|handbags?|totes?|backpacks?|rucksacks?|clutch(es)?|purses?|satchels?|crossbody|pouch(es)?|wallets?|duffels?)\b|包|袋|バッグ|リュック|トート/i],
  ['dress', /\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|overalls|dungarees)\b|洋裝|連身裙|連衣裙|连衣裙|連身|连衣|ワンピース|원피스/i],
  ['outer', /\b(coats?|jackets?|blazers?|parkas?|trench|puffers?|windbreakers?|anoraks?|cardigans?|gilets?|vests?|overcoats?|bombers?|raincoats?|outerwear|peacoats?|capes?|ponchos?|fleece)\b|外套|大衣|夾克|夹克|風衣|风衣|西裝外套|羽絨|羽绒|罩衫|背心外套|コート|ジャケット|アウター|カーディガン|코트|자켓|재킷/i],
  ['bottom', /\b(pants|trousers|jeans|denims?|shorts|skirts?|skorts?|leggings|joggers|sweatpants|chinos|slacks|culottes|cargos?|tights|bermudas?)\b|褲|裤|裙|パンツ|スカート|デニム|ジーンズ|바지|스커트|치마/i],
  ['top', /\b(t-?shirts?|tees?|shirts?|blouses?|tops?|sweaters?|jumpers?|hoodies?|sweatshirts?|pullovers?|knits?|polos?|tanks?|camis?|camisoles?|turtlenecks?|bodysuits?|henleys?|tunics?|crewnecks?|jerseys?)\b|上衣|襯衫|衬衫|毛衣|針織|针织|衛衣|卫衣|帽T|T恤|背心|シャツ|ニット|トップス|パーカー|セーター|티셔츠|셔츠|니트|후드/i],
  ['socks', /\b(socks?|stockings?|hosiery|ankle socks|knee.?highs?)\b|襪|袜|靴下|ソックス|양말/i],
  ['extra', /\b(hats?|caps?|beanies?|scarf|scarves|belts?|gloves?|sunglasses|glasses|watch(es)?|necklaces?|earrings?|bracelets?|rings?|ties?|jewel+e?ry|headbands?|bandanas?)\b|帽|圍巾|围巾|皮帶|皮带|手套|眼鏡|眼镜|項鍊|项链|耳環|耳环|手錶|手表|帽子|マフラー|ベルト|모자|목도리/i],
];

/** A kind read from words, or null when they don't say. The word nearest the end wins ("shirt dress" is a dress). */
export function kindFromWords(text: string | undefined): Category | null {
  if (!text) return null;
  let best: { cat: Category; at: number } | null = null;
  for (const [cat, re] of WORDS) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      const at = m.index + m[0].length;
      if (!best || at > best.at) best = { cat, at };
      if (!m[0]) g.lastIndex++;
    }
  }
  return best?.cat ?? null;
}

/* ---------- 3. outline ---------- */

/**
 * A rough kind from the outline of a clean cut-out. Only used when nothing better is
 * available, so it sticks to the cases an outline can actually tell apart.
 */
export function kindFromShape(cut: HTMLCanvasElement): Category {
  const N = 48;
  const c = makeCanvas(N, N);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(cut, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const solid = (x: number, y: number) => d[(y * N + x) * 4 + 3] > 110;
  const aspect = cut.width / cut.height;

  /** How many separate filled stretches cross a row, and how wide the filled part is. */
  const row = (y: number) => {
    let runs = 0, on = false, first = -1, last = -1;
    for (let x = 0; x < N; x++) {
      const s = solid(x, y);
      if (s && !on) runs++;
      if (s) { if (first < 0) first = x; last = x; }
      on = s;
    }
    return { runs, width: first < 0 ? 0 : (last - first + 1) / N };
  };
  const band = (from: number, to: number) => {
    const rows = [];
    for (let y = Math.round(from * N); y < Math.round(to * N); y++) rows.push(row(y));
    const n = rows.length || 1;
    return {
      split: rows.filter((r) => r.runs >= 2).length / n,
      width: rows.reduce((t, r) => t + r.width, 0) / n,
    };
  };
  const top = band(0.04, 0.2), upper = band(0.22, 0.36), mid = band(0.4, 0.6), low = band(0.72, 0.94);
  const widest = Math.max(top.width, upper.width, mid.width, low.width) || 1;

  if (aspect > 1.45) return 'shoes';
  // Two legs: the lower part splits in two while the waist is one piece.
  if (aspect < 0.95 && low.split > 0.55 && top.split < 0.3) return 'bottom';
  // A handle or strap above a wider body is a bag. Garments have shoulders or a waistband
  // nearly as wide as the rest; a bag hung up by its strap used to be filed as a jacket.
  // (A dress is narrow at the straps too, but full width again by the chest.)
  if (aspect > 0.4 && top.width < 0.5 * widest && upper.width < 0.65 * widest && low.split < 0.5) return 'bag';
  if (aspect < 0.52) return low.split > 0.3 ? 'bottom' : 'dress';
  // Sleeves hanging beside the body split the lower rows into three stretches: a long top or a
  // coat. Without that, a long narrow outline is a dress.
  if (aspect < 0.66) return low.split > 0.3 ? 'outer' : 'dress';
  return 'top';
}

/* ---------- real size ---------- */

/**
 * Shoulder (or waist, for bottoms) to hem, in centimetres. "Cropped" trousers are the ones
 * that stop above the ankle, not shorts: reading it as 34 cm drew a pair of cropped trousers
 * at a third of the height of the others.
 */
const DROP: Record<'body' | 'legs', Record<Length, number>> = {
  body: { cropped: 44, hip: 64, thigh: 80, knee: 98, calf: 114, ankle: 128 },
  legs: { cropped: 88, hip: 26, thigh: 38, knee: 60, calf: 82, ankle: 100 },
};

/** Typical flat-lay width and the heights a kind can believably have, in centimetres. */
const BUILD: Record<Category, { w: number; min: number; max: number }> = {
  outer: { w: 66, min: 50, max: 132 },
  top: { w: 60, min: 42, max: 82 },
  dress: { w: 54, min: 76, max: 132 },
  bottom: { w: 44, min: 30, max: 106 },
  // A pair side by side: ankle socks about 18 cm, knee socks up to 45. (22 made an ankle sock 36 cm.)
  socks: { w: 16, min: 12, max: 45 },
  // A pair from the side is about 30 cm long; from above no more than 34 tall.
  shoes: { w: 30, min: 12, max: 34 },
  // A shoulder bag's outline includes its strap: 48 cm squeezed the body of a long-strapped
  // crossbody bag to a sliver. Still kept below a top's 64 cm.
  bag: { w: 32, min: 16, max: 56 },
  extra: { w: 26, min: 6, max: 40 },
};

/** Scarves are the big accessories: a square silk one is 70–90 cm, a long one over 150. */
const SCARF = { w: 70, min: 30, max: 170 };
const isScarf = (name: string | undefined) => !!name && /scarf|scarves|shawl|stole|wrap|bandana|圍巾|围巾|披肩|マフラー|スカーフ|스카프|목도리/i.test(name);

/**
 * How big a piece is in real life, in centimetres. The hem length is used when it is known;
 * otherwise the outline's proportions on a typical width for its kind. This is what lets a
 * long coat lie longer than a cropped jacket everywhere pieces are shown side by side.
 */
export function realSize(item: Pick<Item, 'category' | 'aspect' | 'length' | 'state'> & { name?: string }): { w: number; h: number } {
  const a = item.aspect > 0 ? item.aspect : 1;
  // A photo that is not cut out yet says nothing about the garment's shape: show it as a print.
  if (item.state !== 'ready') return a >= 1 ? { w: 46, h: 46 / a } : { w: 46 * a, h: 46 };
  const b = item.category === 'extra' && isScarf(item.name) ? SCARF : BUILD[item.category];
  // From the outline alone: a typical width for the kind, and the cut-out's proportions.
  const byShape = Math.min(b.max, Math.max(b.min, b.w / a));
  let h: number;
  if (item.length && (item.category === 'outer' || item.category === 'top' || item.category === 'dress')) h = DROP.body[item.length];
  else if (item.length && item.category === 'bottom') h = DROP.legs[item.length];
  else h = byShape;
  // A length that the outline flatly contradicts (long narrow legs "knee length", a short wide
  // pair "ankle length") is a misreading: the outline wins.
  if (h !== byShape && (item.category === 'bottom' || item.category === 'dress') && (h < byShape / 1.6 || h > byShape * 1.6)) h = byShape;
  let w = h * a;
  // Sleeves spread wide (or a very full skirt) can make the outline far wider than any body.
  const widest = b.w * 1.9;
  if (w > widest) { h *= widest / w; w = widest; }
  return { w, h };
}

/**
 * Size on screen for a real size. Small things are drawn a little larger than true scale so a
 * pair of shoes next to a coat is still easy to see and to tap.
 */
export function drawn(size: { w: number; h: number }, pxPerCm: number) {
  const big = Math.max(size.w, size.h);
  const k = Math.pow(big / 100, -0.2) * pxPerCm;
  return { w: size.w * k, h: size.h * k };
}
