// npm registry adapter.
// Every network call goes through an injected `fetch` so the same code runs in
// Node, in a Cloudflare Worker, and against stubs in tests.

const REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS = 'https://api.npmjs.org';
const UA = 'vetpkg (+https://github.com/kiansaeidnia/vetpkg)';

/** npm marks seized/malicious packages by transferring them to this user. */
const SECURITY_HOLDER = 'npm';

export async function fetchPackage(name, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${REGISTRY}/${encodeURIComponent(name).replace(/%40/, '@').replace(/%2F/g, '/')}`, {
    headers: { accept: 'application/json', 'user-agent': UA }
  });

  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for "${name}"`);

  const doc = await res.json();
  const versions = Object.keys(doc.versions || {});
  const time = doc.time || {};
  const latestTag = doc['dist-tags']?.latest;
  const latest = latestTag ? doc.versions?.[latestTag] : undefined;

  const maintainers = (doc.maintainers || []).map(m => m?.name).filter(Boolean);

  return {
    exists: true,
    name: doc.name,
    description: doc.description || '',
    created: time.created || null,
    modified: time.modified || null,
    versionCount: versions.length,
    latestVersion: latestTag || null,
    maintainers,
    // npm security-holds a package by making "npm" the sole maintainer.
    securityHeld: maintainers.length === 1 && maintainers[0] === SECURITY_HOLDER,
    deprecated: Boolean(latest?.deprecated),
    deprecatedReason: typeof latest?.deprecated === 'string' ? latest.deprecated : null,
    repository: normalizeRepo(doc.repository || latest?.repository),
    homepage: doc.homepage || null,
    readmeLength: typeof doc.readme === 'string' ? doc.readme.length : 0,
    license: doc.license || latest?.license || null
  };
}

export async function fetchDownloads(name, { fetchImpl = fetch } = {}) {
  const enc = encodeURIComponent(name).replace(/%40/, '@').replace(/%2F/g, '/');
  try {
    const res = await fetchImpl(`${DOWNLOADS}/downloads/point/last-week/${enc}`, {
      headers: { accept: 'application/json', 'user-agent': UA }
    });
    if (!res.ok) return { weekly: null };
    const json = await res.json();
    return { weekly: typeof json.downloads === 'number' ? json.downloads : null };
  } catch {
    return { weekly: null };
  }
}

function normalizeRepo(repo) {
  if (!repo) return null;
  const url = typeof repo === 'string' ? repo : repo.url;
  if (!url) return null;
  const cleaned = String(url)
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/');
  const gh = cleaned.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  return { url: cleaned, host: gh ? 'github' : 'other', owner: gh?.[1] || null, repo: gh?.[2] || null };
}
