import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPackage } from '../src/registries/npm.js';

/** Minimal fetch stub returning a canned packument. */
const stub = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

// Shape taken verbatim from the real seized `unused-imports` package.
const SEIZED = {
  name: 'unused-imports',
  description: 'security holding package',
  repository: 'npm/security-holder',
  maintainers: [],
  'dist-tags': { latest: '0.0.1-security' },
  versions: { '0.0.1-security': {} },
  time: { created: '2025-10-27T00:00:00.000Z', modified: '2025-10-27T00:00:00.000Z' }
};

const HEALTHY = {
  name: 'express',
  description: 'Fast, unopinionated, minimalist web framework',
  repository: { url: 'git+https://github.com/expressjs/express.git' },
  maintainers: [{ name: 'dougwilson' }],
  'dist-tags': { latest: '4.19.2' },
  versions: { '4.19.2': { license: 'MIT' } },
  time: { created: '2010-12-29T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  license: 'MIT'
};

test('detects a security-held package', async () => {
  // REGRESSION GUARD. The original check looked for a sole maintainer named
  // "npm", which never matches — seized packages have NO maintainers. A
  // known-malicious package therefore scored "suspicious" rather than "blocked",
  // and only an end-to-end run surfaced it.
  const meta = await fetchPackage('unused-imports', { fetchImpl: stub(SEIZED) });
  assert.equal(meta.securityHeld, true);
});

test('each security-hold marker is sufficient on its own', async () => {
  const cases = [
    ['repository', { ...SEIZED, description: 'x', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }],
    ['description', { ...SEIZED, repository: undefined, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }],
    ['version suffix', { ...SEIZED, repository: undefined, description: 'x' }],
    ['legacy sole npm maintainer', {
      ...SEIZED, repository: undefined, description: 'x',
      maintainers: [{ name: 'npm' }], 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }
    }]
  ];
  for (const [label, doc] of cases) {
    const meta = await fetchPackage('x', { fetchImpl: stub(doc) });
    assert.equal(meta.securityHeld, true, `marker "${label}" should be sufficient`);
  }
});

test('does not flag a healthy package as security-held', async () => {
  const meta = await fetchPackage('express', { fetchImpl: stub(HEALTHY) });
  assert.equal(meta.securityHeld, false);
});

test('reports a missing package rather than throwing', async () => {
  const meta = await fetchPackage('nope', { fetchImpl: stub({}, 404) });
  assert.equal(meta.exists, false);
});

test('throws on an unexpected registry error', async () => {
  await assert.rejects(() => fetchPackage('x', { fetchImpl: stub({}, 500) }), /500/);
});

test('normalizes a git repository URL to a browsable one', async () => {
  const meta = await fetchPackage('express', { fetchImpl: stub(HEALTHY) });
  assert.equal(meta.repository.host, 'github');
  assert.equal(meta.repository.owner, 'expressjs');
  assert.equal(meta.repository.repo, 'express');
  assert.ok(!meta.repository.url.startsWith('git+'));
  assert.ok(!meta.repository.url.endsWith('.git'));
});

test('handles a package with no repository', async () => {
  const doc = { ...HEALTHY, repository: undefined, versions: { '4.19.2': {} } };
  const meta = await fetchPackage('x', { fetchImpl: stub(doc) });
  assert.equal(meta.repository, null);
});
