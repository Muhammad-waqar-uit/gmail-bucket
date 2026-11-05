import http from 'node:http';
import { GmailBucket } from './bucket.js';

const MAX_BODY = 100 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large (max 100MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Minimal REST wrapper (NOT the S3 wire protocol):
 *   GET    /                      list buckets
 *   PUT    /:bucket               create bucket
 *   DELETE /:bucket?force=1       delete bucket
 *   GET    /:bucket?prefix=x      list objects
 *   PUT    /:bucket/path/to/key   upload (x-meta-* headers become metadata)
 *   GET    /:bucket/path/to/key   download
 *   HEAD   /:bucket/path/to/key   info
 *   DELETE /:bucket/path/to/key   delete
 * Set GMAIL_BUCKET_TOKEN to require "Authorization: Bearer <token>".
 */
export function serve(store: GmailBucket, port = 4566): http.Server {
  const token = process.env.GMAIL_BUCKET_TOKEN;

  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      const isBuf = Buffer.isBuffer(body);
      res.writeHead(code, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,PUT,DELETE,HEAD,OPTIONS',
        'access-control-expose-headers': '*',
        ...(isBuf ? {} : { 'content-type': 'application/json' }),
        ...headers,
      });
      res.end(isBuf ? body : body === undefined ? undefined : JSON.stringify(body));
    };

    try {
      if (req.method === 'OPTIONS') return send(204, undefined);
      if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });

      const url = new URL(req.url ?? '/', 'http://localhost');
      const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const [bucket, ...rest] = segs;
      const key = rest.join('/');

      if (!bucket) return send(200, { buckets: await store.listBuckets() });

      if (!key) {
        if (req.method === 'PUT') { await store.createBucket(bucket); return send(200, { ok: true }); }
        if (req.method === 'DELETE') {
          await store.deleteBucket(bucket, { force: url.searchParams.get('force') === '1' });
          return send(200, { ok: true });
        }
        if (req.method === 'GET') {
          const objects = await store.listObjects(bucket, { prefix: url.searchParams.get('prefix') ?? undefined });
          return send(200, { objects });
        }
      } else {
        if (req.method === 'PUT') {
          const metadata: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.startsWith('x-meta-') && typeof v === 'string') metadata[k.slice(7)] = v;
          }
          const body = await readBody(req);
          const r = await store.putObject(bucket, key, body, {
            contentType: req.headers['content-type'] ?? 'application/octet-stream',
            metadata,
          });
          return send(200, r, { etag: r.etag });
        }
        if (req.method === 'GET') {
          const { body, info } = await store.getObject(bucket, key);
          return send(200, body, {
            'content-type': info.contentType,
            'content-length': String(body.length),
            etag: info.etag,
            'last-modified': info.lastModified.toUTCString(),
          });
        }
        if (req.method === 'HEAD') {
          const info = await store.headObject(bucket, key);
          return send(200, undefined, {
            'content-type': info.contentType,
            'content-length': String(info.size),
            etag: info.etag,
            'last-modified': info.lastModified.toUTCString(),
          });
        }
        if (req.method === 'DELETE') { await store.deleteObject(bucket, key); return send(200, { ok: true }); }
      }
      send(405, { error: 'Method not allowed' });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      send(/NoSuch/.test(msg) ? 404 : 500, { error: msg });
    }
  });

  server.listen(port, () => console.log(`gmail-bucket listening on http://localhost:${port}`));
  return server;
}
