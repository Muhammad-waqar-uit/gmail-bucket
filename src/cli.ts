#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { login, type AuthBackend } from './auth.js';
import { createStore } from './store.js';
import { serve } from './server.js';

const HELP = `gmail-bucket <command>

  auth [--drive|--gmail|--all]  log in (default: Drive only, drive.file scope)
  status                        show the active backend and base folder
  serve [port]                  start the REST server (default 4566 / PORT)
  mb <bucket>                   make bucket
  ls [bucket] [prefix]          list buckets, or objects in a bucket
  put <bucket> <key> <file>     upload a file
  get <bucket> <key> <outfile>  download to a file
  rm <bucket> <key>             delete an object

Bucket "_root" means the base folder itself (objects outside any bucket).
Backend is chosen by STORAGE=auto|drive|gmail|memory (default auto).
Drive uses the drive.file scope; DRIVE_SCOPE=full widens it (needed for a pre-existing base folder).
`;

const TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

const contentTypeFor = (file: string) =>
  TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

const mib = (n: number) => (n / (1024 * 1024)).toFixed(1) + ' MB';

/** Which scopes to ask for: no flag = Drive only, `--gmail` = mailbox only, `--all` = both. */
function authBackends(args: string[]): AuthBackend[] {
  if (args.includes('--all') || (args.includes('--drive') && args.includes('--gmail'))) {
    return ['drive', 'gmail'];
  }
  return args.includes('--gmail') ? ['gmail'] : ['drive'];
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'auth') return login(authBackends(a));

  const info = await createStore();
  const store = info.store;

  switch (cmd) {
    case 'status':
      console.log(JSON.stringify({ mode: info.mode, base: info.base, reason: info.reason }, null, 2));
      return;

    case 'serve':
      serve(info, { port: a[0] ? Number(a[0]) : undefined });
      return;

    case 'mb':
      await store.createBucket(a[0]);
      console.log('created', a[0]);
      return;

    case 'ls':
      if (!a[0]) {
        const buckets = await store.listBuckets();
        return console.log(buckets.length ? buckets.join('\n') : '(no buckets yet)');
      }
      for (const o of await store.listObjects(a[0], { prefix: a[1] })) {
        console.log(
          `${o.lastModified.toISOString()}  ${String(o.size).padStart(10)}  ${o.contentType.padEnd(24)}  ${o.key}`
        );
      }
      return;

    case 'put': {
      const [, key, file] = a;
      const stat = fs.statSync(file);
      const r = await store.putObject(a[0], key, fs.readFileSync(file), { contentType: contentTypeFor(file) });
      console.log(`uploaded ${key} (${mib(r.size)}, declared ${mib(stat.size)}), etag ${r.etag}`);
      return;
    }

    case 'get': {
      const { body, info: obj } = await store.getObject(a[0], a[1]);
      fs.writeFileSync(a[2], body);
      console.log(`wrote ${mib(body.length)} to ${a[2]} (${obj.contentType}, etag ${obj.etag})`);
      return;
    }

    case 'rm':
      await store.deleteObject(a[0], a[1]);
      console.log('deleted');
      return;

    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
