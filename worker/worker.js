// vetpkg hosted API — Cloudflare Worker.
//
// The free npm package ships a corpus snapshot. This service exists to sell what
// a local package structurally cannot: a corpus that stays current, plus
// monitoring and policy on top.
//
// CPU budgeting is the whole design constraint. A Worker gets 10ms CPU per
// request but a much larger budget (~400ms) for isolate startup, so the corpus
// index is built once at module scope on cold start (~180ms) and every request
// afterwards costs only the ~5ms lookup. That is why this runs on the free tier
// at $0 rather than needing a database round-trip per check.

import { checkPackage } from '../src/index.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra }
  });

const LANDING = `vetpkg — hosted API

Catch hallucinated and squatted packages before an AI agent installs them.

  GET /v1/check?name=<package>        check one package
  GET /v1/check?name=a,b,c            check several (max 20)
  GET /health                         service status

Example:
  curl "https://vetpkg.kiansaeidnia.workers.dev/v1/check?name=unused-imports"

The free npm package does the same checks locally:
  npx vetpkg unused-imports

Source: https://github.com/kiansaeidnia/vetpkg
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(LANDING, {
        headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS }
      });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'vetpkg', version: '0.1.0' });
    }

    if (url.pathname === '/v1/check') {
      const raw = url.searchParams.get('name');
      if (!raw) {
        return json({ error: 'Missing required parameter "name".' }, 400);
      }

      const names = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (!names.length) return json({ error: 'No package names supplied.' }, 400);
      if (names.length > 20) {
        return json({ error: 'At most 20 packages per request.', supplied: names.length }, 400);
      }

      try {
        const results = await Promise.all(
          names.map(n =>
            checkPackage(n).catch(err => ({
              name: n,
              verdict: 'error',
              error: String(err?.message || err)
            }))
          )
        );

        const flagged = results.filter(r =>
          ['suspicious', 'blocked', 'not_found'].includes(r.verdict)
        ).length;

        return json(
          { checked: results.length, flagged, results },
          200,
          { 'cache-control': 'public, max-age=300' }
        );
      } catch (err) {
        return json({ error: 'Check failed.', detail: String(err?.message || err) }, 500);
      }
    }

    return json({ error: 'Not found.', see: '/' }, 404);
  }
};
