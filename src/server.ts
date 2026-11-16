import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { StoreInfo } from './store.js';
import { BASE_BUCKET } from './layout.js';

const MAX_BODY = 100 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface ServerOptions {
  /** Serve a built frontend from this directory (with an index.html SPA fallback). */
  staticDir?: string;
  /** Require `Authorization: Bearer <token>`. Defaults to env GMAIL_BUCKET_TOKEN. */
  token?: string;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large (max 100MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function statusFor(msg: string): number {
  if (/NoSuchBucket|NoSuchKey/.test(msg)) return 404;
  if (/BucketNotEmpty|BucketExists/.test(msg)) return 409;
  if (/Bucket names|Body too large|Invalid key|not a bucket/.test(msg)) return 400;
  return 500;
}

function validateKey(key: string): void {
  if (!key || key.length > 1024 || key.endsWith('/') || /[\u0000-\u001f]/.test(key)) {
    throw new Error('Invalid key: must be 1-1024 chars, no control characters, must not end with "/"');
  }
}

function serveStatic(root: string, pathname: string, res: http.ServerResponse): void {
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`staticDir has no index.html: ${root}`);
    return;
  }

  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return;
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.resolve(root, '.' + rel);
  if (file.startsWith(path.resolve(root)) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = !file.endsWith('index.html');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    res.end(fs.readFileSync(file));
    return;
  }

  // Single page app: unknown paths fall back to index.html.
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(indexFile));
}

/**
 * REST API over any ObjectStore (NOT the S3 wire protocol).
 *
 *   GET    /api/status                         backend, base, limits
 *   GET    /api/buckets                        list buckets
 *   PUT    /api/buckets/:bucket                create bucket
 *   DELETE /api/buckets/:bucket?force=1        delete bucket
 *   GET    /api/buckets/:bucket?prefix=x       list objects
 *   PUT    /api/buckets/:bucket/objects/:key   upload (x-meta-<name> headers -> metadata)
 *   GET    /api/buckets/:bucket/objects/:key   download (?download=1 forces attachment)
 *   HEAD   /api/buckets/:bucket/objects/:key   object info
 *   DELETE /api/buckets/:bucket/objects/:key   delete
 *
 * Bucket `_root` is the base folder itself, so objects can live outside any bucket.
 */
export function createServer(info: StoreInfo, opts: ServerOptions = {}): http.Server {
  const { store, mode, reason, rootLabel, base } = info;
  const token = opts.token ?? process.env.GMAIL_BUCKET_TOKEN;
  const staticDir = opts.staticDir ? path.resolve(opts.staticDir) : undefined;

  return http.createServer(async (req, res) => {
    const send = (code: number, body?: unknown, headers: Record<string, string> = {}) => {
      const isBuf = Buffer.isBuffer(body);
      res.writeHead(code, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,PUT,DELETE,HEAD,OPTIONS',
        'access-control-expose-headers': 'ETag, Content-Length, Content-Disposition',
        'cache-control': 'no-store',
        ...(isBuf ? {} : body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      });
      res.end(isBuf ? body : body === undefined ? undefined : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return send(204);
    const url = new URL(req.url ?? '/', 'http://localhost');

    // ---------- non-API routes ----------
    if (!url.pathname.startsWith('/api/')) {
      if (staticDir) return serveStatic(staticDir, url.pathname, res);
      if (url.pathname === '/' || url.pathname === '/api') {
        return send(200, {
          name: 'gmail-bucket',
          mode,
          base,
          baseBucket: BASE_BUCKET,
          hint: 'API only. Pass { staticDir } to serve a frontend.',
          endpoints: [
            'GET /api/status',
            'GET /api/buckets',
            'PUT /api/buckets/:bucket',
            'DELETE /api/buckets/:bucket?force=1',
            'GET /api/buckets/:bucket?prefix=',
            'PUT|GET|HEAD|DELETE /api/buckets/:bucket/objects/:key',
          ],
        });
      }
      return send(404, { error: 'Not found' });
    }

    try {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        return send(401, { error: 'Unauthorized' });
      }

      const parts = url.pathname.slice('/api/'.length).split('/');
      const resource = parts[0];

      if (resource === 'status' && parts.length === 1) {
        return send(200, {
          mode,
          reason,
          base,
          baseBucket: BASE_BUCKET,
          rootLabel,
          maxUploadBytes: MAX_BODY,
          chunkBytes: 12 * 1024 * 1024,
        });
      }

      if (resource !== 'buckets') return send(404, { error: 'Not found' });

      const bucket = parts[1] ? decodeURIComponent(parts[1]) : undefined;

      // ---------- buckets ----------
      if (!bucket) {
        if (req.method === 'GET') return send(200, { buckets: await store.listBuckets() });
        return send(405, { error: 'Method not allowed' });
      }

      if (parts.length === 2) {
        if (req.method === 'GET') {
          const prefix = url.searchParams.get('prefix') ?? undefined;
          return send(200, { bucket, objects: await store.listObjects(bucket, { prefix }) });
        }
        if (req.method === 'PUT') {
          await store.createBucket(bucket);
          return send(200, { ok: true, bucket });
        }
        if (req.method === 'DELETE') {
          await store.deleteBucket(bucket, { force: url.searchParams.get('force') === '1' });
          return send(200, { ok: true, bucket });
        }
        return send(405, { error: 'Method not allowed' });
      }

      if (parts[2] !== 'objects') return send(404, { error: 'Not found' });

      // ---------- objects ----------
      const key = parts.slice(3).map(decodeURIComponent).join('/');
      validateKey(key);

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
        return send(200, r, { etag: `"${r.etag}"` });
      }

      if (req.method === 'HEAD') {
        const obj = await store.headObject(bucket, key);
        return send(200, undefined, {
          'content-type': obj.contentType,
          'content-length': String(obj.size),
          etag: `"${obj.etag}"`,
          'last-modified': obj.lastModified.toUTCString(),
        });
      }

      if (req.method === 'GET') {
        const { body, info: obj } = await store.getObject(bucket, key);
        const headers: Record<string, string> = {
          'content-type': obj.contentType,
          'content-length': String(body.length),
          etag: `"${obj.etag}"`,
          'last-modified': obj.lastModified.toUTCString(),
        };
        if (url.searchParams.get('download') === '1') {
          const name = key.split('/').pop() || 'download';
          headers['content-disposition'] = `attachment; filename="${name.replace(/["\\]/g, '_')}"`;
        }
        return send(200, body, headers);
      }

      if (req.method === 'DELETE') {
        await store.deleteObject(bucket, key);
        return send(200, { ok: true });
      }

      return send(405, { error: 'Method not allowed' });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return send(statusFor(msg), { error: msg });
    }
  });
}

/** Reads an env var, treating empty strings (``PORT=``) as unset. */
function envValue(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
}

export interface ServeOptions extends ServerOptions {
  port?: number;
  host?: string;
}

export function serve(info: StoreInfo, opts: ServeOptions = {}): http.Server {
  const requested = opts.port ?? Number(envValue('PORT') ?? 4566);
  const port = Number.isFinite(requested) && requested > 0 ? requested : 4566;
  const host = opts.host ?? envValue('HOST') ?? '127.0.0.1';

  const server = createServer(info, opts);
  server.listen(port, host, () => {
    console.log(`gmail-bucket  →  http://${host}:${port}`);
    console.log(`storage mode  →  ${info.mode}  (${info.reason})`);
    console.log(`base          →  ${info.base}`);
    console.log(`layout        →  base/ (bucket ${BASE_BUCKET}), base/<bucket>/<folders>/<key>`);
  });
  return server;
}
