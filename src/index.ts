export { GmailBucket } from './bucket.js';
export type { ObjectInfo, PutOptions, GmailBucketOptions } from './bucket.js';

export { DriveStore } from './drive.js';
export type { DriveStoreOptions, BaseFolder } from './drive.js';

export { MemoryStore, createStore, BASE_BUCKET } from './store.js';
export type { ObjectRef, ObjectStore, StoreInfo, StoreMode } from './store.js';

export { assertBucketName, BUCKET_RE } from './layout.js';

export {
  dataDir,
  credFile,
  tokenFile,
  hasCredentials,
  hasToken,
  getAuthedClient,
  login,
  SCOPES,
  driveScope,
  scopesFor,
  tokenScopes,
  DRIVE_SCOPE_FILE,
  DRIVE_SCOPE_FULL,
  GMAIL_SCOPE,
} from './auth.js';
export type { AuthBackend } from './auth.js';

export { serve, createServer } from './server.js';
export type { ServerOptions, ServeOptions } from './server.js';
