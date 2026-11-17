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
6. Log in once. The default asks for **`drive.file` only** — the app can then touch only files it created,
   never the rest of your Drive, and never your mailbox:

```bash
gmail-bucket auth            # Drive only, drive.file scope (default)
gmail-bucket auth --gmail    # mailbox only, gmail.modify  (Gmail backend)
gmail-bucket auth --all      # both scopes in one token
```

The Drive base folder is created in **My Drive** on first use. Point `DRIVE_ROOT_FOLDER_ID` at a folder you
already have, or set `DRIVE_CREATE_ROOT=0` to forbid creation.

> **A pre-existing folder needs the wider scope.** `drive.file` only sees files the app created, so pointing
> `DRIVE_ROOT_FOLDER_ID` at a folder you made by hand requires `DRIVE_SCOPE=full` (the old `drive` scope) and
> a fresh `auth`. An app-created base folder needs no extra scope. Gmail has no per-label scope, so the Gmail
> backend always asks for the whole mailbox — another reason Drive is the recommended backend.

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
  moveObject(from: ObjectRef, to: ObjectRef): Promise<ObjectInfo>;
  listObjects(bucket: string, opts?: { prefix?: string; limit?: number }): Promise<ObjectInfo[]>;
}

interface ObjectInfo {
  key: string; size: number; contentType: string;
  etag: string; lastModified: Date; metadata: Record<string, string>;
  url?: string;   // provider link, e.g. Drive webViewLink
}

interface StoreInfo {
  store: ObjectStore; mode: 'drive' | 'gmail' | 'memory';
  base: string; baseUrl?: string;   // link to the base folder, when there is one
  reason: string; rootLabel: string;
}
```

Implement these ten methods to add a backend (S3, R2, local disk…) and pass it to `serve()`.

**Move and rename** — `moveObject({ bucket, key }, { bucket, key })` works for every backend and crosses
buckets, including the base: Drive reparents the file (`addParents`/`removeParents`) and prunes empty source
folders, Gmail relabels when only the bucket changes and rewrites the message when the key changes, memory
just moves the entry. The destination is overwritten when something is already there.

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
PATCH  /api/buckets/:bucket/objects/:key   move/rename: { bucket?, key? }
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
| `DRIVE_SCOPE` | `file` | `file` = `drive.file` (app-created files only); `full` = `drive` (needed for a pre-existing base folder) |
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

Drive objects also carry `info.url` (the file's `webViewLink`) and the selected backend exposes
`info.baseUrl` — a link to the base folder — so apps can offer "open in Drive" without guessing URL shapes.
Both are also returned by the REST API (`objects[].url` and `status.baseUrl`); other backends omit them.

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

## Releasing

Publishing is tag-driven: `.github/workflows/release.yml` runs on a `v*` tag and publishes with
provenance. The order below matters — the library has to be on npm before anything may depend on it.

1. **Log in.** `npm login` on the machine that will publish, and add an npm **Automation** token
   (not one that requires an OTP — CI cannot answer a prompt) as the repository secret `NPM_TOKEN`.

2. **Publish the new version** (currently `2.3.0`). The tag must match `package.json` exactly, or the workflow stops before
   uploading:

   ```bash
   git tag v2.3.0 && git push origin v2.3.0
   ```

   The job installs with `npm ci`, runs `npm run typecheck` and `npm run test:drive`, checks
   `v$version == package.json`, then runs `npm publish --provenance --access public`. From a clean
   checkout of the tag, that same command does it by hand.

   A tag can only publish a commit that contains this workflow. If the tag already exists, re-point
   it at such a commit (`git tag -f v2.3.0 <sha> && git push -f origin v2.3.0`) or bump the version
   instead.

3. **Verify the tarball, not just the tag.** A git install builds through `prepare`; the published
   tarball builds through `prepack`, so only this proves the artifact matches what you tested:

   ```bash
   npm view gmail-bucket dist-tags          # latest must be 2.3.0
   cd "$(mktemp -d)" && npm init -y >/dev/null
   npm install gmail-bucket@2.3.0
   ls node_modules/gmail-bucket/dist/index.js
   node -e "import('gmail-bucket').then(m => console.log(Object.keys(m).sort().join(' ')))"
   ```

   The export list must include `createStore`, `DriveStore`, `GmailBucket`, `MemoryStore` and
   `serve` — 1.0.0 has none of them, which is the trap this order exists to avoid.

4. **Then move the POC to the published package.** In
   [gmail-bucket-poc](https://github.com/Muhammad-waqar-uit/gmail-bucket-poc), change the dependency
   from `github:Muhammad-waqar-uit/gmail-bucket#v2.2.0` to `^2.3.0`, run `npm install` to replace the
   git entry in the lockfile, then re-run `npm run typecheck`, `npm run test:drive` and
   `npm run test:e2e`. Doing this before step 2 fails with `ETARGET`: no 2.x is on the registry yet.

5. **Fix the docs that still install from the git tag.** The same change updates the four places that
   still point readers at the tag: `README.md` (the pin paragraph), `examples/nextjs/README.md` (the
   install line), `docs/ARCHITECTURE.md` (the `v2.2.0` note) and the header comment in
   `scripts/drive-mock-test.mjs`. The vendored suite still has to be re-copied whenever the pinned
   tag changes.

## Related

- **[gmail-bucket-poc](https://github.com/Muhammad-waqar-uit/gmail-bucket-poc)** — React UI + REST demo
  built on this library, with Playwright tests.

## License

[MIT](LICENSE) © Muhammad Waqar
