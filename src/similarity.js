// Name-similarity detection.
//
// Hallucinated and squatted package names come in three distinct shapes, and
// edit distance alone only catches the first:
//
//   1. TYPO      "expres" vs "express"            — tiny edit distance
//   2. SUBSET    "unused-imports" vs              — edit distance 14, but the
//                "eslint-plugin-unused-imports"     token set is a strict subset
//   3. RESHAPE   "node-fetch-api" vs "node-fetch" — same tokens, different order
//                                                    or separators
//
// Shape 2 is the one that matters most in practice: it is exactly what models
// produce when they "simplify" a package name they half-remember, and it is the
// documented shape of the real unused-imports incident.

/** Split a package name into comparable tokens, ignoring scope and separators. */
export function tokenize(name) {
  return String(name)
    .toLowerCase()
    .replace(/^@/, '')
    .split(/[/\-_.]+/)
    .filter(Boolean);
}

/** Strip everything but alphanumerics — catches separator-only differences. */
export function normalize(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Damerau-Levenshtein distance with early exit.
 * Returns `max + 1` once the distance is known to exceed `max`, so we can bail
 * out cheaply while scanning thousands of candidates.
 */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }
  return prev[b.length];
}

/**
 * Compare one candidate name against one known-good name.
 * Returns null when they are unrelated, otherwise a match descriptor.
 */
export function compareNames(candidate, known) {
  if (candidate === known) return null; // identical is not "similar", it IS the package

  const cNorm = normalize(candidate);
  const kNorm = normalize(known);

  // Shape 3 — identical once separators and scope are stripped.
  if (cNorm === kNorm) {
    return { kind: 'reshape', known, confidence: 0.95, detail: 'identical once separators and scope are removed' };
  }

  const cTok = tokenize(candidate);
  const kTok = tokenize(known);

  // Shape 2 — strict token subset in either direction.
  if (cTok.length && kTok.length && cTok.length !== kTok.length) {
    const cSet = new Set(cTok);
    const kSet = new Set(kTok);
    const shorter = cTok.length < kTok.length ? cSet : kSet;
    const longer = cTok.length < kTok.length ? kSet : cSet;
    let contained = true;
    for (const t of shorter) {
      if (!longer.has(t)) { contained = false; break; }
    }
    // Require the shared part to be substantial, so "core" does not match everything.
    if (contained && shorter.size >= 2) {
      return {
        kind: 'subset',
        known,
        confidence: 0.85,
        detail: `every word in the shorter name appears in "${known}"`
      };
    }
    if (contained && shorter.size === 1 && [...shorter][0].length >= 8) {
      return {
        kind: 'subset',
        known,
        confidence: 0.7,
        detail: `"${[...shorter][0]}" is the distinctive part of "${known}"`
      };
    }
  }

  // Shape 1 — small edit distance, scaled to name length so short names are strict.
  const threshold = cNorm.length <= 6 ? 1 : cNorm.length <= 12 ? 2 : 3;
  const dist = editDistance(cNorm, kNorm, threshold);
  if (dist <= threshold) {
    return {
      kind: 'typo',
      known,
      confidence: dist === 1 ? 0.9 : 0.75,
      detail: `${dist} character${dist === 1 ? '' : 's'} away from "${known}"`
    };
  }

  return null;
}

/**
 * Scan a candidate against the popular-package corpus.
 * Returns the strongest matches, best first.
 */
export function findSimilar(candidate, corpus, { limit = 3 } = {}) {
  const hits = [];
  for (const known of corpus) {
    const m = compareNames(candidate, known);
    if (m) hits.push(m);
    // A perfect reshape match is as good as it gets; stop early.
    if (m && m.confidence >= 0.95 && hits.length >= limit) break;
  }
  hits.sort((a, b) => b.confidence - a.confidence);
  return hits.slice(0, limit);
}
