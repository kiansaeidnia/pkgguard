import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePackage } from '../src/score.js';

const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

/** A well-established package: old, popular, many versions, linked repo. */
const established = (over = {}) => ({
  exists: true,
  name: 'express',
  created: daysAgo(5000),
  modified: daysAgo(10),
  versionCount: 288,
  maintainers: ['dougwilson'],
  securityHeld: false,
  deprecated: false,
  repository: { url: 'https://github.com/expressjs/express', host: 'github' },
  license: 'MIT',
  readmeLength: 0,
  ...over
});

/** The classic slopsquat shape: new, unused, one version, no repo. */
const squat = (over = {}) => ({
  exists: true,
  name: 'unused-imports',
  created: daysAgo(12),
  modified: daysAgo(12),
  versionCount: 1,
  maintainers: ['someone'],
  securityHeld: false,
  deprecated: false,
  repository: null,
  license: null,
  readmeLength: 0,
  ...over
});

test('a missing package is terminal and unambiguous', () => {
  const r = scorePackage({ exists: false }, null, []);
  assert.equal(r.verdict, 'not_found');
  assert.equal(r.risk, 100);
});

test('a security-held package is hard-blocked', () => {
  const r = scorePackage(established({ securityHeld: true }), { weekly: 900_000 }, []);
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.risk, 100);
});

test('an established package is trusted', () => {
  const r = scorePackage(established(), { weekly: 132_000_000 }, []);
  assert.equal(r.verdict, 'trusted');
  assert.ok(r.risk < 28);
});

test('an established package is NOT penalised for a similar name', () => {
  // The express/cypress false positive. A package with 132M weekly downloads
  // IS the real package, whatever it happens to resemble.
  const similar = [{ kind: 'typo', known: 'cypress', confidence: 0.75, detail: '2 characters away' }];
  const r = scorePackage(established(), { weekly: 132_000_000 }, similar);
  assert.equal(r.verdict, 'trusted');
  assert.ok(!r.reasons.some(x => /resembles/.test(x.text)), 'should not mention name similarity');
});

test('the full slopsquat shape scores suspicious', () => {
  const similar = [{ kind: 'subset', known: 'eslint-plugin-unused-imports', confidence: 0.85, detail: 'every word appears' }];
  const r = scorePackage(squat(), { weekly: 40 }, similar);
  assert.equal(r.verdict, 'suspicious');
  assert.ok(r.risk >= 55);
  assert.match(r.recommendation, /eslint-plugin-unused-imports/);
});

test('an unestablished package IS penalised for a similar name', () => {
  const similar = [{ kind: 'typo', known: 'express', confidence: 0.9, detail: '1 character away' }];
  const withSim = scorePackage(squat(), { weekly: 20 }, similar);
  const without = scorePackage(squat(), { weekly: 20 }, []);
  assert.ok(withSim.risk > without.risk, 'similarity must raise risk for unestablished packages');
});

test('a new but otherwise clean package is caution, not suspicious', () => {
  const r = scorePackage(
    squat({ repository: { url: 'https://github.com/someone/thing', host: 'github' }, license: 'MIT', versionCount: 4 }),
    { weekly: 300 },
    []
  );
  assert.equal(r.verdict, 'caution');
});

test('deprecation is reported but does not itself create risk', () => {
  const plain = scorePackage(established(), { weekly: 50_000 }, []);
  const dep = scorePackage(established({ deprecated: true, deprecatedReason: 'use x instead' }), { weekly: 50_000 }, []);
  assert.equal(dep.risk, plain.risk, 'deprecation must not change the risk score');
  assert.ok(dep.reasons.some(x => /deprecated/i.test(x.text)));
  assert.match(dep.recommendation, /deprecated/i);
});

test('missing download data is treated as unknown, not as zero', () => {
  const unknown = scorePackage(established(), { weekly: null }, []);
  const zero = scorePackage(established(), { weekly: 0 }, []);
  assert.ok(unknown.risk < zero.risk, 'unknown downloads must be less damning than zero downloads');
});

test('README length is never scored', () => {
  // The registry omits `readme` for many large packages, so it means
  // "not reported", not "no README".
  const a = scorePackage(established({ readmeLength: 0 }), { weekly: 132_000_000 }, []);
  const b = scorePackage(established({ readmeLength: 9000 }), { weekly: 132_000_000 }, []);
  assert.equal(a.risk, b.risk);
  assert.ok(!a.reasons.some(x => /readme/i.test(x.text)));
});

test('every reason carries a severity and human-readable text', () => {
  const r = scorePackage(squat(), { weekly: 10 }, []);
  for (const reason of r.reasons) {
    assert.ok(['low', 'medium', 'high', 'critical'].includes(reason.severity));
    assert.ok(reason.text.length > 10);
  }
});
