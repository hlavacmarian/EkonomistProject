import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (l) => JSON.parse(readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));

function shape(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push(`${key}[${v.length}]`);
    else if (v && typeof v === 'object') out.push(...shape(v, key));
    else out.push(key);
  }
  return out.sort();
}

test('Czech and English translations have the same keys and paragraph counts', () => {
  assert.deepEqual(shape(load('en')), shape(load('cs')));
});

test('equation references in texts point to existing equations', () => {
  for (const l of ['cs', 'en']) {
    const text = JSON.stringify(load(l));
    for (const [, id] of text.matchAll(/\[\[(\w+)\]\]/g)) assert.ok(['IS', 'NKPC', 'TR', 'E'].includes(id), id);
  }
});
