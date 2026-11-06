// Tiny i18n layer: translations live in locales/<lang>.json.

let dict = {};
let lang = 'cs';
const cache = {};

export const LANGS = ['cs', 'en'];

export async function loadLocale(next) {
  if (!cache[next]) {
    const res = await fetch(new URL(`../../locales/${next}.json`, import.meta.url));
    cache[next] = await res.json();
  }
  dict = cache[next];
  lang = next;
  document.documentElement.lang = next;
}

export const getLang = () => lang;

// t('a.b.c', { n: 3 }) -> string with {n} placeholders filled; arrays/objects are returned as-is.
export function t(key, vars) {
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  if (v === undefined) return key;
  if (typeof v !== 'string' || !vars) return v;
  return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

const formatters = {};
export function fmt(v, digits = 2) {
  const id = `${lang}-${digits}`;
  formatters[id] ||= new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Avoid "-0,00"
  const out = formatters[id].format(Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v);
  return out.replace('-', '−');
}

// Equation references in texts ([[IS]], [[NKPC]], [[TR]], [[E]], open economy also
// [[CPI]] and [[UIP]]) become buttons
// that highlight the equation.
export function eqRefs(html) {
  return String(html).replace(/\[\[(IS|NKPC|TR|E|CPI|UIP)\]\]/g,
    (_, id) => `<button type="button" class="eqref" data-eq="${id}">(${id})</button>`);
}

export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.innerHTML = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
}
