#!/usr/bin/env node
// pkgguard CLI.
//
//   pkgguard express react              check named packages
//   pkgguard scan                       check every dependency in ./package.json
//   pkgguard scan --prod                skip devDependencies
//   pkgguard express --json             machine-readable output
//
// Exit code is 1 when anything is suspicious, blocked, or missing, so this can
// gate a CI job or a pre-install hook.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPackage, checkPackages } from '../src/index.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('-')));
const args = argv.filter(a => !a.startsWith('-'));
const asJson = flags.has('--json');
const noColor = flags.has('--no-color') || process.env.NO_COLOR;

const C = noColor
  ? { dim: s => s, bold: s => s, green: s => s, yellow: s => s, red: s => s, grey: s => s }
  : {
      dim: s => `\x1b[2m${s}\x1b[0m`,
      bold: s => `\x1b[1m${s}\x1b[0m`,
      green: s => `\x1b[32m${s}\x1b[0m`,
      yellow: s => `\x1b[33m${s}\x1b[0m`,
      red: s => `\x1b[31m${s}\x1b[0m`,
      grey: s => `\x1b[90m${s}\x1b[0m`
    };

const BADGE = {
  trusted: () => C.green('  ok  '),
  caution: () => C.yellow(' warn '),
  suspicious: () => C.red(' risk '),
  blocked: () => C.red(' STOP '),
  not_found: () => C.red(' none '),
  error: () => C.grey(' err  ')
};

function usage() {
  console.log(`
${C.bold('pkgguard')} — catch hallucinated and squatted packages before you install them

  ${C.bold('pkgguard')} <package...>     check one or more npm packages
  ${C.bold('pkgguard')} scan             check every dependency in ./package.json

  ${C.dim('--prod')}       scan only dependencies, not devDependencies
  ${C.dim('--json')}       output JSON
  ${C.dim('--no-color')}   disable colour

Exits non-zero if anything is suspicious, blocked, or does not exist.
`);
}

function readManifest(prodOnly) {
  const path = resolve(process.cwd(), 'package.json');
  if (!existsSync(path)) {
    console.error(C.red('No package.json found in the current directory.'));
    process.exit(2);
  }
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const names = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...(prodOnly ? [] : Object.keys(pkg.devDependencies || {}))
  ]);
  return [...names];
}

function printResult(r) {
  const risk = String(r.risk ?? '--').padStart(3);
  console.log(`${BADGE[r.verdict]?.() || '  ?   '} ${C.bold(r.name.padEnd(34))} ${C.grey(`risk ${risk}`)}`);

  if (r.verdict === 'trusted') return;

  for (const reason of r.reasons || []) {
    const mark = reason.severity === 'high' || reason.severity === 'critical' ? C.red('!') : C.yellow('·');
    console.log(`        ${mark} ${reason.text}`);
  }
  if (r.recommendation) console.log(`        ${C.dim('=> ' + r.recommendation)}`);
  console.log('');
}

/* --------------------------------------------------------------------- main */

if (flags.has('--help') || flags.has('-h') || (!args.length && !flags.size)) {
  usage();
  process.exit(0);
}

let names;
if (args[0] === 'scan') {
  names = readManifest(flags.has('--prod'));
  if (!names.length) {
    console.log('No dependencies found in package.json.');
    process.exit(0);
  }
  if (!asJson) console.log(C.dim(`\nChecking ${names.length} dependencies from package.json...\n`));
} else {
  names = args;
  if (!asJson) console.log('');
}

const results = names.length === 1
  ? [await checkPackage(names[0]).catch(e => ({ name: names[0], verdict: 'error', error: String(e.message || e) }))]
  : await checkPackages(names);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) printResult(r);

  const bad = results.filter(r => ['suspicious', 'blocked', 'not_found'].includes(r.verdict));
  const warn = results.filter(r => r.verdict === 'caution');
  const parts = [C.green(`${results.filter(r => r.verdict === 'trusted').length} ok`)];
  if (warn.length) parts.push(C.yellow(`${warn.length} caution`));
  if (bad.length) parts.push(C.red(`${bad.length} flagged`));
  console.log(parts.join(C.grey(' · ')) + '\n');
}

process.exit(results.some(r => ['suspicious', 'blocked', 'not_found'].includes(r.verdict)) ? 1 : 0);
