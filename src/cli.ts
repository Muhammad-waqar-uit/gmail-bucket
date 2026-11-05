#!/usr/bin/env node
import fs from 'node:fs';
import { getAuthedClient, login } from './auth.js';
import { GmailBucket } from './bucket.js';
import { serve } from './server.js';

const HELP = `gmail-bucket <command>

  auth                          log in with Google (one time)
  serve [port]                  start the REST server (default 4566)
  mb <bucket>                   make bucket
  ls [bucket] [prefix]          list buckets, or objects in a bucket
  put <bucket> <key> <file>     upload a file
  get <bucket> <key> <outfile>  download to a file
  rm <bucket> <key>             delete an object
`;

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'auth') return login();

  const store = new GmailBucket(getAuthedClient());
  switch (cmd) {
    case 'serve': serve(store, Number(a[0] ?? process.env.PORT ?? 4566)); return;
    case 'mb': await store.createBucket(a[0]); return console.log('created', a[0]);
    case 'ls':
      if (!a[0]) return console.log((await store.listBuckets()).join('\n'));
      for (const o of await store.listObjects(a[0], { prefix: a[1] })) {
        console.log(`${o.lastModified.toISOString()}  ${String(o.size).padStart(10)}  ${o.key}`);
      }
      return;
    case 'put': {
      const r = await store.putObject(a[0], a[1], fs.readFileSync(a[2]));
      return console.log(`uploaded ${r.size} bytes, etag ${r.etag}`);
    }
    case 'get': {
      const { body } = await store.getObject(a[0], a[1]);
      fs.writeFileSync(a[2], body);
      return console.log(`wrote ${body.length} bytes to ${a[2]}`);
    }
    case 'rm': await store.deleteObject(a[0], a[1]); return console.log('deleted');
    default: console.log(HELP);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
