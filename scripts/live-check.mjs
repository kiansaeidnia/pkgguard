// Live smoke test against real registry data, including the documented
// slopsquat incidents. Run: node test/live-check.mjs
import { checkPackage } from '../src/index.js';

const CASES = [
  // --- should be trusted -------------------------------------------------
  ['express', 'trusted'],
  ['react', 'trusted'],
  ['lodash', 'trusted'],
  ['eslint-plugin-unused-imports', 'trusted'],
  ['@types/node', 'trusted'],

  // --- documented real slopsquat / incident packages ---------------------
  ['unused-imports', 'flagged'],   // hallucinated instead of eslint-plugin-unused-imports
  ['react-codeshift', 'flagged'],  // claimed Jan 2026

  // --- should not exist at all -------------------------------------------
  ['react-hooks-superstate', 'not_found'],
  ['express-async-router-utils-pro', 'not_found']
];

const pad = (s, n) => String(s).padEnd(n);
const ICON = { trusted: 'OK  ', caution: 'WARN', suspicious: 'RISK', blocked: 'STOP', not_found: 'GONE', error: 'ERR ' };

let pass = 0, fail = 0;

for (const [name, expected] of CASES) {
  let r;
  try {
    r = await checkPackage(name);
  } catch (err) {
    console.log(`ERR  ${pad(name, 34)} ${err.message}`);
    fail++;
    continue;
  }

  const ok =
    expected === 'trusted' ? r.verdict === 'trusted'
    : expected === 'not_found' ? r.verdict === 'not_found'
    : /* flagged */ ['suspicious', 'caution', 'blocked', 'not_found'].includes(r.verdict);

  ok ? pass++ : fail++;

  console.log(
    `${ICON[r.verdict] || '????'} ${pad(name, 34)} risk=${pad(r.risk, 4)} ${pad(r.verdict, 11)} ${ok ? '' : `<-- EXPECTED ${expected}`}`
  );
  for (const reason of (r.reasons || []).slice(0, 3)) {
    console.log(`       · [${reason.severity}] ${reason.text}`);
  }
  if (r.recommendation) console.log(`       => ${r.recommendation}`);
  console.log('');
}

console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
process.exit(fail ? 1 : 0);
