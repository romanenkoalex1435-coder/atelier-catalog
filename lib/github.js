const path = 'data/products.json';

function config() {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO || '')) throw new Error('GITHUB_TOKEN и GITHUB_REPO не настроены.');
  return { token: GITHUB_TOKEN, repo: GITHUB_REPO };
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

export async function deletePhoto(imagePath) {
  const file = String(imagePath || '').replace(/^\//, '');
  if (!/^images\/[a-z0-9-]+\.jpg$/.test(file)) return;
  try {
    const { sha } = await request(file);
    await request(file, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `Remove photo ${file}`, sha }) });
  } catch (error) {
    console.error('Photo cleanup failed:', error.message);
  }
}
