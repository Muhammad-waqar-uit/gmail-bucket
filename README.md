# gmail-bucket

[![CI](https://github.com/Muhammad-waqar-uit/gmail-bucket/actions/workflows/ci.yml/badge.svg)](https://github.com/Muhammad-waqar-uit/gmail-bucket/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gmail-bucket.svg)](https://www.npmjs.com/package/gmail-bucket)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Use storage you already pay for as a tiny S3-style object store.** One base folder, buckets as folders,
nested keys — backed by **Google Drive**, **Gmail**, or plain **memory**, behind a single `ObjectStore`
interface, with a CLI and a small REST server.

> For demos and MVPs only. Gmail and Drive are not designed to be object stores — do not ship this to
> real users, and never point it at your main account.

## The layout

```
base (Drive folder "bucket-base" / Gmail root label / memory)
├── _root/                  ← the base itself: objects stored outside any bucket
│   └── welcome.txt
├── photos/                 ← a bucket = a folder inside the base
│   └── 2026/trips/cat.png  ← slashes in a key become nested folders (Drive)
└── docs/
    └── contract.pdf
```

- **base** — one root for everything. In Drive it is a normal folder you can open in the browser.
- **bucket** — a folder created inside the base. Names: `^[a-z0-9][a-z0-9._-]{0,62}$`.
- **`_root`** — reserved bucket id for the base. Never listed as a bucket; cannot be created or deleted.
- **folders** — a key like `a/b/c.png` creates `a/b/` under the bucket on Drive, and is a prefix in
  Gmail/memory.

## Install

```bash
npm install gmail-bucket        # library
npm install -g gmail-bucket     # CLI (`gmail-bucket` command)
```

Node 18+.

## Backends

| `STORAGE` | Base | Bucket | Object |
| --- | --- | --- | --- |
| `drive` | Drive folder (`bucket-base`) | folder inside the base | a file; nested folders created on demand |
| `gmail` | root Gmail label | label `<root>/<bucket>` | one or more messages carrying an attachment |
| `memory` | in process | in process | in process (demos, tests) |
| `auto` (default) | Drive if usable → Gmail if usable → memory |

`auto` reports which backend it picked and why. `STORAGE=drive` or `STORAGE=gmail` is strict and fails with
a readable message instead of falling back.

## Setup

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library** → enable **Google Drive API** (and **Gmail API** if you want both).
3. **OAuth consent screen** → External → add your Google address under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app** → download the JSON.
5. Save it as `~/.gmail-bucket/credentials.json` (Windows: `%USERPROFILE%\.gmail-bucket\credentials.json`).
6. Log in once — `drive` and `gmail.modify` scopes in one token:

```bash
gmail-bucket auth
```

The Drive base folder is created in **My Drive** on first use. Point `DRIVE_ROOT_FOLDER_ID` at a folder you
already have, or set `DRIVE_CREATE_ROOT=0` to forbid creation.

> While the consent screen is in **Testing**, Google expires refresh tokens after 7 days. Re-run `auth`
> or publish the app (unverified is fine for personal use).

## CLI

```bash
gmail-bucket status                              # active backend + base
gmail-bucket mb photos                           # create bucket
gmail-bucket put photos 2026/trips/cat.png cat.png
gmail-bucket put _root readme.txt readme.txt      # straight into the base
gmail-bucket ls photos 2026/                      # list with prefix
gmail-bucket get photos 2026/trips/cat.png out.png
gmail-bucket rm photos 2026/trips/cat.png
gmail-bucket serve 4566                           # REST server
```

Content types are inferred from the file extension on `put`.

## Library

```ts
import { createStore, DriveStore, GmailBucket, MemoryStore, BASE_BUCKET } from 'gmail-bucket';
import { getAuthedClient } from 'gmail-bucket';

// Backend chosen from STORAGE (drive | gmail | memory | auto)
const { store, mode, base } = await createStore();

await store.createBucket('photos');
await store.putObject('photos', '2026/trips/cat.png', png, { contentType: 'image/png' });
const { body, info } = await store.getObject('photos', '2026/trips/cat.png');
const objects = await store.listObjects('photos', { prefix: '2026/' });
await store.putObject(BASE_BUCKET, 'welcome.txt', 'in the base');   // no bucket
await store.deleteObject('photos', '2026/trips/cat.png');

// Or pick a backend explicitly
const drive = new DriveStore(getAuthedClient(), { rootFolderName: 'bucket-base' });
const gmail = new GmailBucket(getAuthedClient(), { rootLabel: 'gmail-bucket' });
const mem = new MemoryStore();
```

### `ObjectStore`

```ts
interface ObjectStore {
  createBucket(bucket: string): Promise<void>;
  listBuckets(): Promise<string[]>;
  deleteBucket(bucket: string, opts?: { force?: boolean }): Promise<void>;
  putObject(bucket: string, key: string, body: Buffer, opts?: { contentType?: string; metadata?: Record<string, string> }): Promise<{ etag: string; size: number }>;
  getObject(bucket: string, key: string): Promise<{ body: Buffer; info: ObjectInfo }>;
  headObject(bucket: string, key: string): Promise<ObjectInfo>;
  deleteObject(bucket: string, key: string): Promise<void>;
  listObjects(bucket: string, opts?: { prefix?: string; limit?: number }): Promise<ObjectInfo[]>;
}

interface ObjectInfo {
  key: string; size: number; contentType: string;
  etag: string; lastModified: Date; metadata: Record<string, string>;
}
```

Implement these nine methods to add a backend (S3, R2, local disk…) and pass it to `serve()`.

## REST server

```ts
import { createStore, serve } from 'gmail-bucket';

const info = await createStore();
serve(info, { port: 4566, staticDir: './public' });   // staticDir is optional
```

```
GET    /api/status                         backend, base, limits
GET    /api/buckets                        list buckets
PUT    /api/buckets/:bucket                create bucket
DELETE /api/buckets/:bucket?force=1        delete bucket
GET    /api/buckets/:bucket?prefix=x       list objects
PUT    /api/buckets/:bucket/objects/:key   upload (x-meta-<name> headers -> metadata)
GET    /api/buckets/:bucket/objects/:key   download (?download=1 forces attachment)
HEAD   /api/buckets/:bucket/objects/:key   object info
DELETE /api/buckets/:bucket/objects/:key   delete
```

Plain JSON REST — not the S3 wire protocol, so the AWS SDK cannot talk to it.
Set `GMAIL_BUCKET_TOKEN` (or `serve(..., { token })`) to require `Authorization: Bearer <token>`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE` | `auto` | `auto` / `drive` / `gmail` / `memory` |
| `PORT` | `4566` | `serve` port |
| `HOST` | `127.0.0.1` | bind address |
| `DRIVE_ROOT_FOLDER_ID` | — | existing Drive folder to use as the base |
| `DRIVE_ROOT_FOLDER_NAME` | `bucket-base` | base folder name under My Drive |
| `DRIVE_CREATE_ROOT` | `1` | `0` = fail instead of creating the base |
| `GMAIL_BUCKET_ROOT_LABEL` | `gmail-bucket` | Gmail root label |
| `GMAIL_BUCKET_DIR` | `~/.gmail-bucket` | location of `credentials.json` / `token.json` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | alternative to the credentials file |
| `GOOGLE_REFRESH_TOKEN` | — | headless mode, skips `token.json` |
| `GOOGLE_ACCESS_TOKEN` | — | optional access-token seed |
| `GMAIL_BUCKET_TOKEN` | — | require a bearer token on the REST API |

Credentials may also come from `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, and a token from
`GOOGLE_REFRESH_TOKEN` — handy on hosts without a home directory.

## How it stores things

**Drive** — base folder → bucket folders → nested folders → files. Overwrites update the file in place;
`etag` is the MD5 we computed and stored in `appProperties` (metadata JSON is kept when ≤ 120 bytes, since
Drive caps property values). Deletes go to Trash and prune folders that end up empty.

**Gmail** — a bucket is a label; an object is a message inserted straight into that label (nothing is sent,
nothing reaches the inbox) with the identity in headers: `X-GB-Key`, `X-GB-Part`, `X-GB-Total`, `X-GB-Upload`,
`X-GB-Size`, `X-GB-Etag`, `X-GB-Content-Type`, `X-GB-Meta`. Objects over 12 MB are chunked (base64 must stay
under Gmail's 25 MB attachment cap) and reassembled on read; reads verify the MD5 etag.

**Memory** — `Map<bucket, Map<key, …>>`, seeded with `_root`.

## Limits

- Whole objects are buffered in memory; uploads are capped at 100 MB per object; Gmail chunks are 12 MB.
- Listing walks folder trees (Drive) or reads message headers (Gmail) — keep buckets to hundreds of objects.
- Google quota applies (~250 units/sec/user for Gmail); the client retries 429/5xx with backoff.
- Storage counts against your Google quota (15 GB free, shared with Drive and Photos).
- Deletes are recoverable: Drive files and Gmail messages go to Trash.
- Write concurrency is last-write-wins; reads verify the MD5 so corruption fails loudly.

## Migrating from 1.x

- **2.0.0 adds** the Drive backend, the base folder / `_root` model, `ObjectStore`, `MemoryStore`,
  `createStore()`, and `serve(info, opts)`.
- OAuth now requests `drive` as well as `gmail.modify` — **run `gmail-bucket auth` again**; an old token
  will fail with an insufficient-scope error.
- `serve(store, port)` is now `serve(info, { port, staticDir, host, token })`. Passing a `GmailBucket`
  still works if you wrap it: `serve({ store, mode: 'gmail', base, reason, rootLabel })`.
- Bucket names are validated through one shared rule (`assertBucketName`), and `_root` is reserved.

## Tests

```bash
npm run test:drive      # DriveStore against an in-memory fake Drive client (25 checks)
npm run typecheck
```

## Related

- **[gmail-bucket-poc](https://github.com/Muhammad-waqar-uit/gmail-bucket-poc)** — React UI + REST demo
  built on this library, with Playwright tests.

## License

[MIT](LICENSE) © Muhammad Waqar
