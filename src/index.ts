export { GmailBucket } from './bucket.js';
export type { ObjectInfo, PutOptions, GmailBucketOptions } from './bucket.js';

export { DriveStore } from './drive.js';
export type { DriveStoreOptions, BaseFolder } from './drive.js';

export { MemoryStore, createStore, BASE_BUCKET } from './store.js';
export type { ObjectStore, StoreInfo, StoreMode } from './store.js';

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
} from './auth.js';

export { serve, createServer } from './server.js';
export type { ServerOptions, ServeOptions } from './server.js';
