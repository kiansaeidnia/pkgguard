// pkgguard — public API.
//
// checkPackage("some-name") -> verdict, risk score, human-readable reasons.
// Designed to be called by an AI coding agent *before* it installs anything.

import { fetchPackage, fetchDownloads } from './registries/npm.js';
import { findSimilar } from './similarity.js';
import { buildIndex, findSimilarIndexed } from './corpus-index.js';
import { scorePackage } from './score.js';
import POPULAR from './data/popular-npm.json' with { type: 'json' };

export { findSimilar, compareNames, editDistance, tokenize } from './similarity.js';
export { buildIndex, findSimilarIndexed } from './corpus-index.js';
export { scorePackage } from './score.js';

// The index is built once on first use and reused for every later lookup.
// A linear scan costs ~108ms, which is over the CPU budget a Worker gets.
let defaultIndex = null;
const indexCache = new WeakMap();

function indexFor(corpus) {
  if (corpus === POPULAR) {
    return (defaultIndex ??= buildIndex(POPULAR));
  }
  if (typeof corpus === 'object') {
    let idx = indexCache.get(corpus);
    if (!idx) indexCache.set(corpus, (idx = buildIndex(corpus)));
    return idx;
  }
  return buildIndex(corpus);
}

/** Similarity lookup against a corpus, indexed and cached. */
function similarTo(name, corpus) {
  return findSimilarIndexed(name, indexFor(corpus));
}

/**
 * Check a single package.
 *
 * @param {string} name                 package name, e.g. "express" or "@scope/pkg"
 * @param {object} [opts]
 * @param {'npm'} [opts.registry]       only npm today; pypi is next
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string[]} [opts.corpus]      override the popular-package corpus
 */
export async function checkPackage(name, opts = {}) {
  const { registry = 'npm', fetchImpl = fetch, corpus = POPULAR } = opts;

  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('checkPackage requires a non-empty package name');
  }
  if (registry !== 'npm') {
    throw new Error(`Unsupported registry "${registry}". Only "npm" is supported today.`);
  }

  const clean = name.trim();
  const meta = await fetchPackage(clean, { fetchImpl });

  // Similarity is worth computing even when the package does not exist — it is
  // how we tell the agent what it probably meant.
  const similar = similarTo(clean, corpus);

  if (!meta.exists) {
    const result = scorePackage(meta, null, similar);
    if (similar[0]) {
      result.reasons.push({
        severity: 'high',
        text: `Closest real package is "${similar[0].known}" — ${similar[0].detail}.`,
        points: 0
      });
      result.recommendation = `Do not install. The intended package was most likely "${similar[0].known}".`;
    }
    return { name: clean, registry, ...result, meta: null, similar };
  }

  const downloads = await fetchDownloads(clean, { fetchImpl });
  const { established, ...result } = scorePackage(meta, downloads, similar);

  return {
    name: clean,
    registry,
    ...result,
    // Similarity is suppressed for established packages. It did not influence
    // the verdict for them, and reporting that "express" resembles "cypress"
    // reads as a warning when it is not one.
    similar: established ? [] : similar,
    meta: {
      description: meta.description,
      created: meta.created,
      modified: meta.modified,
      versionCount: meta.versionCount,
      latestVersion: meta.latestVersion,
      weeklyDownloads: downloads.weekly,
      repository: meta.repository?.url || null,
      license: meta.license,
      deprecated: meta.deprecated
    }
  };
}

/** Check many packages concurrently, with a small pool to stay polite. */
export async function checkPackages(names, opts = {}) {
  const { concurrency = 5 } = opts;
  const out = new Array(names.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, names.length) }, async () => {
      while (i < names.length) {
        const idx = i++;
        try {
          out[idx] = await checkPackage(names[idx], opts);
        } catch (err) {
          out[idx] = { name: names[idx], verdict: 'error', error: String(err?.message || err) };
        }
      }
    })
  );
  return out;
}
