const path = 'data/products.json';

function config() {
  const { GITHUB_TOKEN, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } = process.env;
  // Vercel exposes the connected repository, so only the token has to be configured
  const repo = process.env.GITHUB_REPO || (VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG ? `${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}` : '');
  if (!GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_TOKEN не настроен.');
  return { token: GITHUB_TOKEN, repo };
}

async function request(file, options = {}) {
  const { token, repo } = config();
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
    ...options,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  return response.json();
}

export async function getCatalog() {
  const file = await request(path);
  return { sha: file.sha, products: JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8')) };
}

export async function saveCatalog(products, sha, message) {
  return request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, sha, content: Buffer.from(JSON.stringify(products, null, 2) + '\n').toString('base64') }) });
}

export async function savePhoto(name, photoBytes) {
  const file = `images/${name}.jpg`;
  await request(file, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `Add photo ${name}`, content: Buffer.from(photoBytes).toString('base64') }) });
  return `/${file}`;
}

export async function savePreview(name, bytes, ext) {
  const file = `images/preview/${name}.${ext}`;
  await request(file, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `Add preview ${name}`, content: Buffer.from(bytes).toString('base64') }) });
  return `/${file}`;
}

export async function deletePhoto(imagePath) {
  const file = String(imagePath || '').replace(/^\//, '');
  if (!/^images\/(preview\/)?[a-z0-9-]+\.(jpg|webp|png)$/.test(file)) return;
  try {
    const { sha } = await request(file);
    await request(file, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `Remove photo ${file}`, sha }) });
  } catch (error) {
    console.error('Photo cleanup failed:', error.message);
  }
}

// Private settings (admin credentials) live in private/<name>.json: excluded from the Vercel deployment by .vercelignore,
// so they are never served as static files; functions read them through the GitHub API.
export async function readPrivate(name) {
  let file;
  try { file = await request(`private/${name}.json`); } catch (error) { if (/GitHub 404/.test(error.message)) return null; throw error; }
  if (!file?.content) return null;
  return JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
}

export async function writePrivate(name, value) {
  const path = `private/${name}.json`;
  let sha;
  try { sha = (await request(path)).sha; } catch (error) { if (!/GitHub 404/.test(error.message)) throw error; }
  await request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `Update ${name} settings`, ...(sha ? { sha } : {}), content: Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64') }) });
}
