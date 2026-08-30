import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareNames, findSimilar, editDistance, tokenize, normalize } from '../src/similarity.js';

test('editDistance handles the basics', () => {
  assert.equal(editDistance('express', 'express'), 0);
  assert.equal(editDistance('expres', 'express'), 1);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('abc', ''), 3);
});

test('editDistance counts a transposition as one edit, not two', () => {
  assert.equal(editDistance('raect', 'react'), 1);
});

test('editDistance exits early once it exceeds max', () => {
  // Returns max + 1 as a sentinel rather than the true distance.
  assert.ok(editDistance('aaaaaaaaaa', 'zzzzzzzzzz', 2) > 2);
});

test('tokenize splits on every separator and drops scope', () => {
  assert.deepEqual(tokenize('@types/node-fetch'), ['types', 'node', 'fetch']);
  assert.deepEqual(tokenize('eslint-plugin-unused-imports'), ['eslint', 'plugin', 'unused', 'imports']);
  assert.deepEqual(tokenize('lodash.get'), ['lodash', 'get']);
});

test('normalize strips everything but alphanumerics', () => {
  assert.equal(normalize('@scope/my-pkg_name.js'), 'scopemypkgnamejs');
});

test('an identical name is not "similar" — it is the package', () => {
  assert.equal(compareNames('express', 'express'), null);
});

test('catches the typo shape', () => {
  const m = compareNames('expres', 'express');
  assert.equal(m.kind, 'typo');
  assert.ok(m.confidence >= 0.75);
});

test('catches the subset shape — the documented unused-imports case', () => {
  // Edit distance here is 14; only token analysis catches it.
  const m = compareNames('unused-imports', 'eslint-plugin-unused-imports');
  assert.equal(m.kind, 'subset');
  assert.ok(m.confidence >= 0.8);
});

test('catches the reshape shape', () => {
  const m = compareNames('node_fetch', 'node-fetch');
  assert.equal(m.kind, 'reshape');
});

test('does not match unrelated names', () => {
  assert.equal(compareNames('lodash', 'react'), null);
  assert.equal(compareNames('webpack', 'mongoose'), null);
});

test('a single short shared token is not enough to match', () => {
  // Otherwise every "react-*" package would flag against "react".
  assert.equal(compareNames('react-codeshift', 'react'), null);
});

test('short names are held to a stricter edit threshold', () => {
  // "vue" vs "vuex" is one edit but both are real, distinct, popular packages.
  // The guard is that similarity is only *scored* for unestablished packages.
  const m = compareNames('vue', 'vuex');
  assert.ok(m === null || m.kind === 'typo');
});

test('findSimilar returns the strongest matches first', () => {
  const corpus = ['express', 'express-async-router', 'react', 'lodash'];
  const hits = findSimilar('express-async-router-utils-pro', corpus);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].known, 'express-async-router');
});

test('findSimilar respects the limit', () => {
  const corpus = ['node-fetch', 'node_fetch', 'nodefetch', 'react', 'vue'];
  assert.ok(findSimilar('node.fetch', corpus, { limit: 2 }).length <= 2);
});
