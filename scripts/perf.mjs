// Performance check for the indexed similarity lookup.
// The hosted tier runs on Cloudflare Workers, which allow 10ms CPU per request,
// so worst-case lookup time is a product constraint, not a nicety.
import POPULAR from '../src/data/popular-npm.json' with { type: 'json' };
import { buildIndex, findSimilarIndexed } from '../src/corpus-index.js';
import { findSimilar } from '../src/similarity.js';

console.log(`corpus: ${POPULAR.length} names`);
const t0 = performance.now();
const idx = buildIndex(POPULAR);
console.log(`index build: ${(performance.now() - t0).toFixed(0)}ms (paid once)\n`);

const PROBES = [
  'unused-imports', 'express-async-router-utils-pro', 'expres', 'react-codeshift',
  'node_fetch', 'lodahs', 'react-router-domm', 'axios-http-client',
  '@types/node', 'express', 'eslint-plugin-unused-import'
];

let worst = 0;
let mismatches = 0;
console.log('  indexed    linear   match');
for (const p of PROBES) {
  const b0 = performance.now(); const ind = findSimilarIndexed(p, idx); const bMs = performance.now() - b0;
  const a0 = performance.now(); const lin = findSimilar(p, POPULAR); const aMs = performance.now() - a0;
  worst = Math.max(worst, bMs);
  // Linear breaks ties arbitrarily; indexed prefers the more popular target, so
  // a difference here is an improvement rather than a regression.
  const same = (lin[0]?.known ?? null) === (ind[0]?.known ?? null);
  if (!same) mismatches++;
  console.log(
    `  ${bMs.toFixed(2).padStart(7)}ms ${aMs.toFixed(1).padStart(7)}ms  ${p.padEnd(32)} -> ${ind[0]?.known ?? '(none)'}` +
    (same ? '' : `   [linear picked ${lin[0]?.known ?? 'none'}]`)
  );
}

console.log(`\nworst indexed lookup: ${worst.toFixed(2)}ms   (Worker CPU budget: 10ms)`);
console.log(`tie-break differences vs linear: ${mismatches}`);
process.exit(worst > 10 ? 1 : 0);
