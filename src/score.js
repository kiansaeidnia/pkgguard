// Risk scoring.
//
// No single signal proves a package is a slopsquat. The giveaway is the
// *combination*: a package that is brand new, barely downloaded, published once,
// has no repository, and whose name is a near-miss of something popular. Real
// packages essentially never look like that; attacker-registered ones almost
// always do.

/** Signal weights, in risk points. Tuned against the documented real incidents. */
const W = {
  nameSubset: 34,      // "unused-imports" vs "eslint-plugin-unused-imports"
  nameTypo: 30,
  nameReshape: 26,
  brandNew: 18,        // < 30 days old
  recent: 8,           // < 180 days old
  noDownloads: 20,     // < 50/week
  lowDownloads: 11,    // < 1000/week
  singleVersion: 12,
  fewVersions: 5,
  noRepository: 14,
  publishedOnce: 8,    // created and last modified the same day
  thinReadme: 6,
  noLicense: 4
};

const DAY = 86_400_000;

export function scorePackage(meta, downloads, similar = []) {
  const reasons = [];
  let risk = 0;

  const add = (points, severity, text) => {
    risk += points;
    reasons.push({ severity, text, points });
  };

  // --- terminal states, short-circuit -------------------------------------
  if (!meta.exists) {
    return {
      verdict: 'not_found',
      risk: 100,
      reasons: [{
        severity: 'critical',
        text: 'No package by this name exists on the registry. If an AI assistant suggested it, it was invented.',
        points: 100
      }],
      recommendation: 'Do not install. Ask for the real package name, or search the registry directly.'
    };
  }

  if (meta.securityHeld) {
    return {
      verdict: 'blocked',
      risk: 100,
      reasons: [{
        severity: 'critical',
        text: 'This package has been security-held by npm, which happens when a package is found to be malicious or is seized after a takeover.',
        points: 100
      }],
      recommendation: 'Do not install under any circumstances.'
    };
  }

  const ageDays = meta.created ? (Date.now() - Date.parse(meta.created)) / DAY : null;
  const weeklyDownloads = downloads?.weekly ?? null;

  // A package with real adoption IS the legitimate package, whatever its name
  // resembles. Without this gate, "express" gets flagged against "cypress"
  // (2 edits apart) and "@types/node" against "@types/node-fetch". Slopsquats
  // are, by construction, new and unused — so similarity only carries risk for
  // packages that are not yet established.
  const established =
    (weeklyDownloads !== null && weeklyDownloads >= 5000) ||
    (weeklyDownloads !== null && weeklyDownloads >= 1000 && ageDays !== null && ageDays > 730);

  // --- name similarity, the strongest single signal ------------------------
  const top = established ? null : similar[0];
  if (top) {
    const points = top.kind === 'subset' ? W.nameSubset : top.kind === 'typo' ? W.nameTypo : W.nameReshape;
    add(points, 'high', `Name closely resembles the widely-used package "${top.known}" — ${top.detail}.`);
  }

  // --- age ------------------------------------------------------------------
  if (ageDays !== null) {
    if (ageDays < 30) add(W.brandNew, 'high', `First published ${Math.max(0, Math.round(ageDays))} days ago.`);
    else if (ageDays < 180) add(W.recent, 'medium', `First published ${Math.round(ageDays)} days ago, so it has little track record.`);
  }

  // --- adoption -------------------------------------------------------------
  const weekly = weeklyDownloads;
  if (weekly === null || weekly === undefined) {
    add(W.lowDownloads, 'medium', 'No download statistics are available for this package.');
  } else if (weekly < 50) {
    add(W.noDownloads, 'high', `Only ${weekly} downloads in the last week — effectively unused.`);
  } else if (weekly < 1000) {
    add(W.lowDownloads, 'medium', `${weekly.toLocaleString('en')} downloads in the last week, which is low for a general-purpose package.`);
  }

  // --- release history ------------------------------------------------------
  if (meta.versionCount <= 1) add(W.singleVersion, 'medium', 'Only one version has ever been published.');
  else if (meta.versionCount <= 3) add(W.fewVersions, 'low', `Only ${meta.versionCount} versions published.`);

  if (meta.created && meta.modified) {
    const spanDays = (Date.parse(meta.modified) - Date.parse(meta.created)) / DAY;
    if (spanDays < 1 && meta.versionCount <= 2) {
      add(W.publishedOnce, 'medium', 'Published and never updated, which is typical of a throwaway registration.');
    }
  }

  // --- provenance -----------------------------------------------------------
  if (!meta.repository) add(W.noRepository, 'high', 'No source repository is linked, so the code cannot be reviewed before install.');
  if (!meta.license) add(W.noLicense, 'low', 'No license is declared.');
  // README length is deliberately NOT scored: the registry omits the `readme`
  // field for many large packages (express and react both return an empty
  // string), so a short value means "not reported", not "no README". Scoring it
  // produced a false claim on the most popular packages there are.

  // --- deprecation is informational, not a risk of compromise ---------------
  if (meta.deprecated) {
    reasons.push({
      severity: 'medium',
      text: `Marked deprecated by its maintainer${meta.deprecatedReason ? `: ${meta.deprecatedReason}` : '.'}`,
      points: 0
    });
  }

  risk = Math.min(100, Math.round(risk));

  const verdict = risk >= 55 ? 'suspicious' : risk >= 28 ? 'caution' : 'trusted';

  return { verdict, risk, reasons, recommendation: recommend(verdict, top, meta) };
}

function recommend(verdict, top, meta) {
  if (verdict === 'suspicious') {
    return top
      ? `Do not install without verifying. Check whether you actually meant "${top.known}".`
      : 'Do not install without verifying this package by hand first.';
  }
  if (verdict === 'caution') {
    return top
      ? `Confirm this is the package you intended and not "${top.known}" before installing.`
      : 'Review the source repository before adding this to a project.';
  }
  if (meta.deprecated) return 'Established and safe to install, but deprecated — look for the maintained replacement.';
  return 'Established package with a normal publication history. Safe to install.';
}
