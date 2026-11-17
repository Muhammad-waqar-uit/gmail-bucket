/**
 * Object responses must never let an uploaded document run on the API origin:
 * nosniff always, inline only for plain images, attachment for everything else.
 * Run: npm run test:server
 */
import assert from 'node:assert/strict';
import { createServer, MemoryStore, BASE_BUCKET } from '../dist/index.js';

const info = {
  store: new MemoryStore(),
  mode: 'memory',
  base: 'in-process memory',
  reason: 'test',
  rootLabel: 'gmail-bucket',
};

const server = createServer(info, {});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const objects = `http://127.0.0.1:${port}/api/buckets/${BASE_BUCKET}/objects`;

let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`  ok  ${++passed}. ${name}`);
}

async function put(key, contentType) {
  const res = await fetch(`${objects}/${key}`, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: 'payload',
  });
  assert.equal(res.status, 200, `PUT ${key} -> ${res.status}`);
}

try {
  await check('HTML is downloaded, not rendered, and cannot be sniffed', async () => {
    await put('evil.html', 'text/html');
    const res = await fetch(`${objects}/evil.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-type'), 'text/html');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="evil\.html"$/);
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(await res.text(), 'payload');
  });

  await check('SVG is an attachment (it can carry script)', async () => {
    await put('logo.svg', 'image/svg+xml');
    const res = await fetch(`${objects}/logo.svg`);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  await check('PNG renders inline with nosniff', async () => {
    await put('cat.png', 'image/png');
    const res = await fetch(`${objects}/cat.png`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-disposition'), 'inline');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await check('?download=1 forces an attachment even for images', async () => {
    const res = await fetch(`${objects}/cat.png?download=1`);
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  await check('a script-bearing content type is reduced to a plain type', async () => {
    await put('sneaky.png', 'image/png; charset="><script>alert(1)</script>');
    const res = await fetch(`${objects}/sneaky.png`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-disposition'), 'inline');
  });

  await check('a well-formed charset survives', async () => {
    await put('notes.txt', 'text/plain; charset=utf-8');
    const res = await fetch(`${objects}/notes.txt`);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  await check('a nonsense content type becomes application/octet-stream', async () => {
    await put('blob.bin', 'not a mime type');
    const res = await fetch(`${objects}/blob.bin`);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  await check('HEAD carries the same protection and no body', async () => {
    const res = await fetch(`${objects}/evil.html`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(res.headers.get('content-length'), String('payload'.length));
    assert.equal(await res.text(), '');
  });

  console.log(`\n${passed} checks passed (object headers)`);
} finally {
  server.close();
}
