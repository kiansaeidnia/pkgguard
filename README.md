# pkgguard

**Stop AI coding agents installing packages that don't exist.**

Zero dependencies. Works as an MCP server, a CLI, or a library.

```bash
npx pkgguard express-async-router-utils-pro
```
```
 none  express-async-router-utils-pro         risk 100
        ! No package by this name exists on the registry. If an AI assistant
          suggested it, it was invented.
        ! Closest real package is "express-async-router" — every word in the
          shorter name appears in "express-async-router".
        => Do not install. The intended package was most likely "express-async-router".
```

---

## The problem

AI coding assistants recommend packages that **do not exist about 19.7% of the time** ([576,000-sample study](https://arxiv.org/pdf/2605.17062)). Open-weight models average 21.7%; commercial models around 5.2%.

That alone would just be annoying. What makes it dangerous is that **the hallucinations repeat**. When researchers re-ran 500 prompts that had produced a fabricated package name, **43% returned the same fabricated name every single time**.

A predictable hallucination is an attackable one. The attack is called **slopsquatting**:

1. A model invents a plausible package name that has never existed.
2. An attacker registers that exact name on npm.
3. The next developer — or autonomous agent — who runs the install command pulls attacker-controlled code straight into the build.

This is not hypothetical. `unused-imports` is the textbook case: models hallucinate it instead of the real `eslint-plugin-unused-imports`. `react-codeshift` was claimed in January 2026.

Meanwhile **over 50% of organisations have already had an outage or security incident from AI-generated code using outdated or wrong APIs** (Snyk). Models are trained infrequently — a model shipped this summer can be confidently wrong about a library that changed a year ago.

## What pkgguard does

It answers one question, before anything gets installed:

> Is this a real, established package — or did a model invent it?

It checks the live registry and scores what it finds:

| Signal | Why it matters |
|---|---|
| **Existence** | The package may simply not be real. |
| **Name similarity** | Catches three distinct shapes — typos, token subsets, and reshapes. |
| **Age** | Slopsquats are registered *after* the hallucination becomes common. |
| **Adoption** | Real packages have sustained downloads; squats have almost none. |
| **Release history** | One version, published once, never updated is a throwaway registration. |
| **Provenance** | No linked repository means the code can't be reviewed. |
| **Security holds** | npm seizes malicious packages; that's detected and hard-blocked. |

No single signal is proof. The giveaway is the **combination** — brand new, barely downloaded, published once, no repository, and named a near-miss of something popular. Real packages essentially never look like that.

### Why name similarity needs three mechanisms

Edit distance alone misses the most common real-world shape:

| Shape | Example | Caught by |
|---|---|---|
| **Typo** | `expres` → `express` | edit distance 1 |
| **Subset** | `unused-imports` → `eslint-plugin-unused-imports` | edit distance is **14** — only token analysis catches this |
| **Reshape** | `node_fetch` → `node-fetch` | normalisation |

The subset shape is exactly what models produce when they "simplify" a name they half-remember, and it's the shape of the documented `unused-imports` incident. A tool checking only edit distance will miss it.

## Use it as an MCP server

This is the point. A CLI only helps if you remember to run it. An **MCP server sits inside the agent's tool loop**, so the check happens automatically, at the moment the agent is about to install something.

**Claude Desktop** / **Claude Code** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pkgguard": {
      "command": "npx",
      "args": ["-y", "pkgguard", "pkgguard-mcp"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pkgguard": { "command": "npx", "args": ["-y", "pkgguard", "pkgguard-mcp"] }
  }
}
```

Two tools are exposed:

- `check_package` — verify one package
- `check_packages` — verify several at once

Then tell your agent, once: *"Always check packages with pkgguard before installing them."*

## Use it as a CLI

```bash
# check specific packages
npx pkgguard express react lodash

# check everything in package.json
npx pkgguard scan

# production dependencies only
npx pkgguard scan --prod

# machine-readable
npx pkgguard express --json
```

Exits non-zero if anything is suspicious, blocked, or missing — so it works as a CI gate or a pre-install hook:

```json
{ "scripts": { "preinstall": "pkgguard scan || true" } }
```

## Use it as a library

```js
import { checkPackage } from 'pkgguard';

const result = await checkPackage('unused-imports');

result.verdict;         // 'trusted' | 'caution' | 'suspicious' | 'blocked' | 'not_found'
result.risk;            // 0–100
result.reasons;         // [{ severity, text, points }]
result.recommendation;  // plain-English next step
result.similar;         // closest real packages, if any
```

## FAQ

**Does this replace `npm audit` or Socket?**
No, and it isn't trying to. `npm audit` finds known vulnerabilities in packages you already trust. pkgguard asks whether the package should be trusted *at all* — whether it's real, and whether it's what you meant. Run both.

**Why not just check if the package exists?**
Because the dangerous case is that it *does* exist. Once an attacker registers a hallucinated name, an existence check passes and hands you the payload. Existence is the easy half.

**Will it flag legitimate new packages?**
Sometimes, and deliberately. A brand-new package with no downloads is genuinely unverifiable — that's `caution`, not `suspicious`. The scoring only reaches `suspicious` when several independent signals agree.

**Does it flag popular packages with similar names?**
No. Packages with real adoption are exempt from name-similarity scoring — `express` is not warned about for resembling `cypress`. Slopsquats are by construction new and unused, so similarity only carries risk for packages that aren't established.

**Does it send my dependency list anywhere?**
No. It queries the public npm registry directly from your machine. There is no telemetry and no account.

**Which registries are supported?**
npm today. PyPI is next — the same attack works there, and the research covering it sampled both.

**Why zero dependencies?**
A tool that vets your dependency tree shouldn't arrive with one.

## How scoring works

| Verdict | Risk | Meaning |
|---|---|---|
| `trusted` | 0–27 | Established, normal publication history. |
| `caution` | 28–54 | Unverifiable or unusual. Look before installing. |
| `suspicious` | 55–99 | Several signals agree. Do not install without checking. |
| `blocked` | 100 | Security-held by npm. Never install. |
| `not_found` | 100 | Does not exist. If an AI suggested it, it was invented. |

## Limitations

Worth being straight about:

- **A determined attacker can fake the signals.** Downloads can be inflated and repositories can be fabricated. This raises the cost of the attack; it does not make it impossible.
- **The bundled name corpus is a snapshot.** A squat targeting a package that isn't in the corpus won't be caught by similarity — though the age, adoption and provenance signals still apply.
- **New legitimate packages score low.** That's correct behaviour, not a bug, but it means low scores need judgement rather than blind obedience.

## Licence

MIT
