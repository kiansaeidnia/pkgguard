// Builds src/data/popular-npm.json — the corpus of real package names used as
// similarity targets.
//
// Rate-limit note, learned the hard way: registry.npmjs.org sits behind
// Cloudflare and returns "error code: 1015" on DEEP PAGINATION specifically.
// A burst of six single-page queries all succeed, but `from=500` fails
// immediately. So this sweeps MANY queries ONE page deep rather than few
// queries many pages deep. The earlier deep-pagination version silently lost
// most of its results and produced a corpus missing "express".
//
// Coverage note: v1 missed "eslint-plugin-unused-imports", the exact target of
// the documented unused-imports slopsquat, so the real incident scored far too
// low. Plugin ecosystems and scoped orgs are swept explicitly.
//
// Run: node scripts/build-popular.mjs
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data', 'popular-npm.json');

const BASE = [
  'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'remix', 'astro', 'solid', 'preact',
  'node', 'express', 'fastify', 'koa', 'nest', 'hapi', 'server', 'http', 'fetch', 'axios',
  'test', 'jest', 'vitest', 'mocha', 'chai', 'sinon', 'playwright', 'cypress', 'puppeteer',
  'lint', 'eslint', 'prettier', 'stylelint', 'babel', 'swc', 'esbuild', 'terser',
  'webpack', 'vite', 'rollup', 'parcel', 'turbo', 'typescript', 'types', 'tsconfig', 'tsx',
  'cli', 'parser', 'compiler', 'transform', 'plugin', 'preset', 'loader', 'config', 'dotenv',
  'database', 'sql', 'orm', 'mongo', 'mongoose', 'redis', 'postgres', 'mysql', 'sqlite',
  'prisma', 'drizzle', 'knex', 'typeorm', 'sequelize', 'migration', 'seed',
  'auth', 'jwt', 'oauth', 'passport', 'crypto', 'hash', 'bcrypt', 'password', 'session',
  'cookie', 'csrf', 'helmet', 'cors', 'security', 'sanitize', 'escape', 'xss',
  'date', 'dayjs', 'moment', 'luxon', 'time', 'timezone', 'string', 'array', 'object',
  'util', 'lodash', 'ramda', 'immer', 'clone', 'merge', 'deep', 'equal',
  'stream', 'buffer', 'file', 'fs', 'path', 'glob', 'watch', 'chokidar', 'rimraf', 'mkdir',
  'log', 'logger', 'winston', 'pino', 'debug', 'chalk', 'colors', 'ora', 'spinner',
  'error', 'validate', 'schema', 'zod', 'joi', 'yup', 'ajv', 'valibot',
  'json', 'yaml', 'toml', 'csv', 'xml', 'markdown', 'mdx', 'html', 'css', 'sass', 'less',
  'postcss', 'tailwind', 'styled', 'emotion', 'stitches', 'vanilla-extract',
  'ui', 'component', 'form', 'table', 'modal', 'dropdown', 'tooltip', 'toast', 'carousel',
  'router', 'routing', 'state', 'redux', 'zustand', 'jotai', 'recoil', 'mobx', 'xstate',
  'query', 'graphql', 'apollo', 'relay', 'trpc', 'api', 'rest', 'openapi', 'swagger',
  'aws', 'azure', 'gcp', 'cloud', 'docker', 'kubernetes', 'serverless', 'lambda', 'vercel',
  'cloudflare', 'netlify', 'supabase', 'firebase', 'stripe', 'twilio', 'sendgrid',
  'image', 'sharp', 'jimp', 'video', 'audio', 'canvas', 'chart', 'd3', 'three', 'gsap',
  'animation', 'motion', 'spring', 'icon', 'color', 'font', 'pdf', 'excel', 'docx',
  'email', 'nodemailer', 'sms', 'notification', 'push', 'webhook',
  'queue', 'bull', 'cache', 'socket', 'websocket', 'grpc', 'proto', 'rpc', 'event',
  'emitter', 'pubsub', 'worker', 'thread', 'cluster', 'child-process',
  'i18n', 'locale', 'intl', 'currency', 'math', 'random', 'uuid', 'nanoid', 'shortid',
  'semver', 'npm', 'yarn', 'pnpm', 'git', 'github', 'gitlab', 'release', 'changelog',
  'monorepo', 'workspace', 'package', 'bundle', 'minify', 'treeshake', 'polyfill', 'shim',
  'ai', 'llm', 'openai', 'anthropic', 'langchain', 'mcp', 'agent', 'embedding', 'vector',
  'token', 'tokenizer', 'prompt', 'rag', 'chat', 'completion', 'transformer', 'onnx',
  'browser', 'dom', 'jsdom', 'cheerio', 'scrape', 'crawler', 'selenium',
  'native', 'expo', 'electron', 'tauri', 'capacitor', 'cordova', 'ionic',
  'terminal', 'prompt-cli', 'inquirer', 'commander', 'yargs', 'meow', 'clack',
  'compression', 'zip', 'tar', 'gzip', 'archive', 'upload', 'multer', 'formidable',
  'rate-limit', 'retry', 'throttle', 'debounce', 'memoize', 'lru', 'circuit-breaker',
  'observability', 'telemetry', 'opentelemetry', 'sentry', 'metrics', 'tracing', 'profiler',
  // plugin ecosystems and scoped orgs - where squat targets concentrate
  'eslint-plugin', 'eslint-config', 'babel-plugin', 'babel-preset', 'webpack-plugin',
  'webpack-loader', 'vite-plugin', 'rollup-plugin', 'postcss-plugin', 'prettier-plugin',
  'jest-preset', 'jest-environment', 'remark', 'rehype', 'unified', 'storybook',
  'nx', 'lerna', 'changesets', 'husky', 'lint-staged', 'commitlint',
  '@types', '@babel', '@aws-sdk', '@azure', '@google-cloud', '@nestjs', '@angular',
  '@vue', '@sveltejs', '@remix-run', '@radix-ui', '@mui', '@chakra-ui', '@headlessui',
  '@tanstack', '@trpc', '@prisma', '@sentry', '@opentelemetry', '@octokit', '@slack',
  '@modelcontextprotocol', '@langchain', '@aws-cdk', '@nx', '@storybook', '@testing-library',
  '@eslint', '@typescript-eslint', '@vitest', '@playwright', '@swc', '@rollup', '@esbuild'
];

const SPACING_MS = 600;
const MAX_RETRIES = 5;
const CACHE = join(__dirname, '.seed-cache.json');
const seen = new Map(Object.entries(
  existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let rateLimitWaits = 0;
let completed = 0;
const failures = [];

async function search(topic) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(topic)}&size=250`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'pkgguard-seed/0.5', accept: 'application/json' },
        signal: AbortSignal.timeout(15_000)
      });
      const text = await res.text();

      // Rate-limit detection must NOT substring-match the body. A successful
      // response is ~240KB of JSON, and "1015" appears inside it constantly —
      // in download counts, timestamps, version numbers. Matching on that
      // treated every good response as throttled and retried it five times.
      // Cloudflare's 1015 page is short and is not valid JSON, so parse first
      // and only then look for the error.
      if (res.status === 429 || res.status === 403) {
        rateLimitWaits++;
        await sleep(Math.min(20_000, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return null;

      try {
        return JSON.parse(text);
      } catch {
        if (text.includes('1015')) {
          rateLimitWaits++;
          await sleep(Math.min(20_000, 1000 * 2 ** attempt));
          continue;
        }
        return null; // genuinely malformed, not throttled
      }
    } catch {
      await sleep(Math.min(20_000, 1000 * 2 ** attempt));
    }
  }
  return null;
}

async function sweep(topic) {
  const json = await search(topic);
  if (!json) { failures.push(topic); }
  else {
    for (const obj of json.objects || []) {
      const name = obj?.package?.name;
      if (!name) continue;
      // Rank by REAL weekly downloads, which the search API now returns inline.
      // npm's own score.detail.popularity is not a usable proxy: it ranked
      // eslint-plugin-unused-imports 76,394th out of 76,494 despite millions of
      // weekly downloads, so trimming by it would drop the exact package the
      // documented slopsquat imitates.
      const weekly = obj?.downloads?.weekly ?? 0;
      const prev = seen.get(name);
      if (prev === undefined || weekly > prev) seen.set(name, weekly);
    }
  }
  completed++;
  if (completed % 20 === 0) {
    process.stdout.write(`  ${completed}/${BASE.length} · ${seen.size} names · ${rateLimitWaits} waits\n`);
    // Checkpoint: an interrupted sweep resumes from here instead of restarting.
    writeFileSync(CACHE, JSON.stringify(Object.fromEntries(seen)));
  }
  await sleep(SPACING_MS);
}

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

console.log(`Sweeping ${BASE.length} queries, one page each...`);
const started = Date.now();
await pool(BASE, 1, sweep);

writeFileSync(CACHE, JSON.stringify(Object.fromEntries(seen)));

// A real package with sustained downloads is a plausible squat target; one
// with almost none is neither worth imitating nor worth warning about.
const MIN_WEEKLY = 500;
const ranked = [...seen.entries()]
  .filter(([, weekly]) => weekly >= MIN_WEEKLY)
  .sort((a, b) => b[1] - a[1])
  .map(([name]) => name);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(ranked, null, 0));

const kb = (JSON.stringify(ranked).length / 1024).toFixed(0);
console.log(`\nWrote ${ranked.length} names (${kb} KB) in ${((Date.now() - started) / 1000).toFixed(0)}s · ${rateLimitWaits} rate-limit waits`);
if (failures.length) console.log(`  FAILED queries: ${failures.length} — ${failures.slice(0, 10).join(', ')}`);
const kept = [...seen.values()].filter(w => w >= 500).length;
console.log(`  kept ${kept} of ${seen.size} names at >=500 weekly downloads`);
console.log('  coverage probes:');
for (const probe of ['express', 'react', 'lodash', '@types/node', 'cypress',
                     'eslint-plugin-unused-imports', 'eslint-plugin-import', 'express-async-router']) {
  console.log(`    ${ranked.includes(probe) ? 'yes' : 'NO '}  ${probe}`);
}
