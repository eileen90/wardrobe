/** Prices: a plain number plus a currency, however it was typed or pasted. */

export const CURRENCIES = [
  { code: 'TWD', sign: 'NT$' },
  { code: 'USD', sign: '$' },
  { code: 'JPY', sign: '¥' },
  { code: 'KRW', sign: '₩' },
  { code: 'CNY', sign: 'CN¥' },
  { code: 'HKD', sign: 'HK$' },
  { code: 'EUR', sign: '€' },
  { code: 'GBP', sign: '£' },
] as const;

export const signOf = (code: string) => CURRENCIES.find((c) => c.code === code)?.sign ?? code;

/** Marks that give a currency away, most specific first. */
const MARKS: [RegExp, string][] = [
  [/NT\$|NTD|TWD|新台幣|台幣/i, 'TWD'],
  [/HK\$|HKD|港幣/i, 'HKD'],
  [/US\$|USD/i, 'USD'],
  [/CN¥|CNY|RMB|人民幣|人民币/i, 'CNY'],
  [/JPY|円|日圓|日元/i, 'JPY'],
  [/KRW|₩|원/i, 'KRW'],
  [/EUR|€/i, 'EUR'],
  [/GBP|£/i, 'GBP'],
  [/¥|￥/, 'JPY'],
  [/元/, 'TWD'],
  [/\$/, 'USD'],
];

/**
 * Read whatever was typed: "1,280", "NT$1280", "¥4,990", "39.90 USD", "€ 49,95".
 * Returns the bare number as text and the currency if the text named one.
 */
export function parsePrice(text: string): { amount: string; currency?: string } {
  const t = text.trim();
  if (!t) return { amount: '' };
  const currency = MARKS.find(([re]) => re.test(t))?.[1];
  let num = (t.match(/\d[\d.,\s]*/)?.[0] ?? '').replace(/\s/g, '').replace(/[.,]+$/, '');
  if (!num) return { amount: '', currency };
  const lastDot = num.lastIndexOf('.'), lastComma = num.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  // The last separator is a decimal point only when one or two digits follow it.
  const decimals = last >= 0 && num.length - last - 1 <= 2 ? num.slice(last + 1) : '';
  const whole = (decimals ? num.slice(0, last) : num).replace(/[.,]/g, '');
  num = decimals && +decimals ? `${+whole}.${decimals.padEnd(2, '0')}` : String(+whole);
  return { amount: num === 'NaN' ? '' : num, currency };
}

/** "1280" → "1,280" */
export function groupDigits(amount: string) {
  if (!amount) return '';
  const [w, d] = amount.split('.');
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
}
