// MCP server over stdio — zero dependencies.
//
// This is the whole point of the product. The competing tools are CLIs you have
// to remember to run; none of them got traction. An MCP server sits inside the
// agent's tool loop, so the check happens automatically at the moment the agent
// is about to install something.
//
// Implemented directly against the JSON-RPC 2.0 / MCP stdio contract rather than
// via the SDK: a tool that vets your dependency tree should not arrive with one.

import { createInterface } from 'node:readline';
import { checkPackage, checkPackages } from './index.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'vetpkg', version: '0.1.0' };

const TOOLS = [
  {
    name: 'check_package',
    description:
      'Verify that an npm package is real and safe before installing it. Detects hallucinated package names that do not exist, and slopsquats — attacker-registered packages whose names imitate popular ones. Call this before running any install command.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The npm package name, e.g. "express" or "@scope/pkg".' }
      },
      required: ['name']
    }
  },
  {
    name: 'check_packages',
    description:
      'Verify several npm packages at once before installing them. Use when adding multiple dependencies in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'npm package names to check.' }
      },
      required: ['names']
    }
  }
];

/* ---------------------------------------------------------------- rendering */

const BADGE = {
  trusted: 'TRUSTED',
  caution: 'CAUTION',
  suspicious: 'SUSPICIOUS',
  blocked: 'BLOCKED',
  not_found: 'DOES NOT EXIST'
};

function render(r) {
  const lines = [`${BADGE[r.verdict] || r.verdict.toUpperCase()} — ${r.name} (risk ${r.risk}/100)`];

  if (r.meta) {
    const m = r.meta;
    const bits = [];
    if (m.weeklyDownloads !== null && m.weeklyDownloads !== undefined) bits.push(`${m.weeklyDownloads.toLocaleString('en')} downloads/week`);
    if (m.versionCount) bits.push(`${m.versionCount} versions`);
    if (m.created) bits.push(`first published ${m.created.slice(0, 10)}`);
    if (bits.length) lines.push(bits.join(' · '));
    if (m.repository) lines.push(`repo: ${m.repository}`);
  }

  if (r.reasons?.length) {
    lines.push('');
    for (const reason of r.reasons) lines.push(`- [${reason.severity}] ${reason.text}`);
  }
  if (r.recommendation) {
    lines.push('');
    lines.push(`Recommendation: ${r.recommendation}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------ tool dispatch */

async function callTool(name, args) {
  if (name === 'check_package') {
    if (!args?.name) throw new Error('check_package requires a "name" argument');
    const r = await checkPackage(String(args.name));
    return { text: render(r), isError: r.verdict === 'blocked' };
  }

  if (name === 'check_packages') {
    const names = Array.isArray(args?.names) ? args.names.map(String) : null;
    if (!names?.length) throw new Error('check_packages requires a non-empty "names" array');
    const results = await checkPackages(names);
    const risky = results.filter(r => ['suspicious', 'blocked', 'not_found'].includes(r.verdict));
    const header = risky.length
      ? `${risky.length} of ${results.length} packages need attention before installing.\n`
      : `All ${results.length} packages look established and safe to install.\n`;
    return { text: header + '\n' + results.map(render).join('\n\n'), isError: false };
  }

  throw new Error(`Unknown tool "${name}"`);
}

/* -------------------------------------------------------------- jsonrpc i/o */

let out = process.stdout;
let closed = false;

/**
 * Write one JSON-RPC message.
 * An agent can disconnect at any moment, which surfaces as EPIPE mid-write.
 * That is a normal shutdown, not a crash, so it is swallowed rather than thrown.
 */
function send(msg) {
  if (closed) return;
  try {
    out.write(JSON.stringify(msg) + '\n');
  } catch (err) {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') closed = true;
    else throw err;
  }
}

function reply(id, result) {
  if (id === undefined || id === null) return; // notification: no response
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });

    case 'notifications/initialized':
    case 'initialized':
      return; // no response expected

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: TOOLS });

    case 'tools/call': {
      try {
        const { text, isError } = await callTool(params?.name, params?.arguments);
        return reply(id, { content: [{ type: 'text', text }], isError: Boolean(isError) });
      } catch (err) {
        // Tool errors are reported in-band so the model can react, per MCP.
        return reply(id, {
          content: [{ type: 'text', text: `vetpkg error: ${err?.message || err}` }],
          isError: true
        });
      }
    }

    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

export function serve({ input = process.stdin, output = process.stdout } = {}) {
  out = output;
  closed = false;
  // A disconnecting client must shut the server down quietly, not crash it.
  out.on?.('error', (err) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') closed = true;
  });

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    try {
      await handle(msg);
    } catch (err) {
      replyError(msg?.id, -32603, `Internal error: ${err?.message || err}`);
    }
  });
  return rl;
}
