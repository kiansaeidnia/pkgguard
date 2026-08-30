import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findSimilarIndexed } from '../src/corpus-index.js';
import { findSimilar } from '../src/similarity.js';

// Ordered by notional popularity, matching how the real corpus is built.
const CORPUS = [
  'react', 'express', 'lodash', 'axios', 'cypress',
  'react-router-dom', 'node-fetch', 'express-async-router',
  'eslint-plugin-unused-imports', 'ts-remove-unused-imports',
  '@types/node', '@types/node-fetch', 'eslint-plugin-import'
];

const idx = buildIndex(CORPUS);

test('finds the typo shape', () => {
  assert.equal(findSimilarIndexed('expres', idx)[0]?.known, 'express');
  assert.equal(findSimilarIndexed('lodahs', idx)[0]?.known, 'lodash');
});

test('finds the reshape shape', () => {
  assert.equal(findSimilarIndexed('node_fetch', idx)[0]?.known, 'node-fetch');
});

test('finds a subset match where the CORPUS entry is longer', () => {
  // "unused-imports" -> "eslint-plugin-unused-imports"
  const hit = findSimilarIndexed('unused-imports', idx)[0];
  assert.equal(hit?.kind, 'subset');
  assert.equal(hit?.known, 'eslint-plugin-unused-imports');
});

test('finds a subset match where the CORPUS entry is shorter', () => {
  // REGRESSION GUARD. An earlier index capped posting-list scans, which made
  // this return nothing — the linear scan found it, so the bug was silent.
  const hit = findSimilarIndexed('express-async-router-utils-pro', idx)[0];
  assert.equal(hit?.known, 'express-async-router');
});

test('ties break toward the more popular target', () => {
  // Both "eslint-plugin-unused-imports" and "ts-remove-unused-imports" are
  // valid subset matches with equal confidence. The corpus is ordered by
  // downloads, so the earlier entry must win.
  const hits = findSimilarIndexed('unused-imports', idx);
  const known = hits.map(h => h.known);
  assert.ok(known.includes('eslint-plugin-unused-imports'));
  assert.equal(known[0], 'eslint-plugin-unused-imports');
});

test('agrees with the linear scan on every probe', () => {
  const probes = [
    'expres', 'lodahs', 'node_fetch', 'react-router-domm', 'unused-imports',
    'express-async-router-utils-pro', 'react', 'totally-unrelated-thing-xyz'
  ];
  for (const p of probes) {
    const lin = findSimilar(p, CORPUS).map(h => h.known);
    const ind = findSimilarIndexed(p, idx).map(h => h.known);
    // The index may order ties differently (deliberately, by popularity), so
    // compare membership rather than order.
    assert.deepEqual(new Set(ind), new Set(lin), `mismatch for "${p}"`);
  }
});

test('returns nothing for an unrelated name', () => {
  assert.deepEqual(findSimilarIndexed('totally-unrelated-thing-xyz', idx), []);
});

test('an exact corpus member is not similar to itself', () => {
  const hits = findSimilarIndexed('react', idx);
  assert.ok(!hits.some(h => h.known === 'react'));
});

test('respects the limit', () => {
  assert.ok(findSimilarIndexed('unused-imports', idx, { limit: 1 }).length <= 1);
});

test('handles an empty corpus without throwing', () => {
  assert.deepEqual(findSimilarIndexed('anything', buildIndex([])), []);
});
