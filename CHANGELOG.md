# Changelog

## 2.2.0

### Added

- `ObjectStore.moveObject(from, to)` — move or rename an object, including between buckets and to/from the
  base (`_root`). Implemented for all three backends: Drive reparents the file and prunes empty folders,
  Gmail relabels (same key) or rewrites the object (new key), memory moves the entry.
- `PATCH /api/buckets/:bucket/objects/:key` with `{ bucket?, key? }` to move/rename over HTTP;
  returns the moved object's `ObjectInfo`.
- `ObjectRef` type exported for the `from`/`to` arguments.

## 2.1.0

### Added

- `ObjectInfo.url` — provider link for an object; the Drive backend fills it from the file's
  `webViewLink`, other backends leave it undefined.
- `StoreInfo.baseUrl` — link to the base in the provider's UI (Drive folder), also exposed by
  `GET /api/status` as `baseUrl` and by object listings as `objects[].url`.

## 2.0.0

### Added

- **Google Drive backend** (`DriveStore`): the base is a real Drive folder, buckets are folders inside it,
  and any `/` in a key creates nested folders. Overwrites update files in place; deletes go to Trash and
  prune folders that become empty.
- **Base folder model**: everything lives under one base. The base is addressable as the reserved bucket
  `_root`, so objects can be stored outside any bucket.
- **`ObjectStore` interface** shared by all backends, plus `MemoryStore` for demos and tests.
- **`createStore()`** — backend selection from `STORAGE=auto|drive|gmail|memory`, with a reported reason
  when it falls back.
- **`ServerOptions.staticDir`** — the REST server can host a built frontend, with SPA fallback.
- CLI: `status` command, extension-based content types on `put`, `_root` support, backend info on startup.
- Drive API support in OAuth (`drive` scope) and `DriveStore` mock test suite (25 checks).

### Changed

- **Breaking:** `serve()` signature is now `serve(info, { port, host, staticDir, token })`
  (was `serve(store, port)`).
- **Breaking:** OAuth now requests `drive` in addition to `gmail.modify`; re-run `auth`.
- Bucket-name validation moved to a shared `assertBucketName()`; `_root` is reserved.
- Default `serve` port is `4566` unless `PORT` is set.

### Fixed

- Empty `PORT` (e.g. `PORT=`) no longer binds a random port.
- Backend misconfiguration now exits with a single readable message instead of a stack trace.

## 1.0.0

- Initial release: Gmail labels as buckets, message attachments as objects, CLI and REST server.
