/** Links: tidy what was pasted, and show it as the shop's name rather than a wall of characters. */

const TRACKING = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_[ce]id|igshid|igsh|ref_?src|ref|spm|scm|_ga|_gl|yclid|ttclid|twclid|li_fat_id|cmpid|campaign_?id|ad_?id|share_?id|si|srsltid|vero_\w+|pk_\w+|trk\w*|aff\w*|irclickid|irgwc)$/i;

/** A full, clean address from whatever was typed, or '' if it isn't one. */
export function cleanUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = u.hash.startsWith('#:~:') ? '' : u.hash;
  return u.href.replace(/\?$/, '');
}

/** "https://www.uniqlo.com/tw/zh_TW/products/E123" → "uniqlo.com" */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|shop|store)\./, '');
  } catch {
    return url;
  }
}

/** A brand guess from the address: "uniqlo.com" → "Uniqlo". Marketplaces don't count. */
const MARKETS = /^(amazon|ebay|shopee|momo|momoshop|pchome|rakuten|taobao|tmall|etsy|zalora|asos|farfetch|ssense|yahoo|google|instagram|facebook|pinterest|line|books|pinkoi|ruten|coupang|mercari|vinted|depop|lyst|zozo|shopify|myshopify)$/;
export function brandFromSite(url: string): string {
  const parts = siteOf(url).split('.');
  // Drop country endings like .com.tw so the name is what is left.
  while (parts.length > 1 && /^(com|co|net|org|shop|store|tw|jp|kr|hk|cn|us|uk|eu|de|fr|it|es|ca|au|sg)$/.test(parts[parts.length - 1])) parts.pop();
  const name = parts[parts.length - 1] ?? '';
  if (!name || MARKETS.test(name) || name.length < 2) return '';
  return name.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
