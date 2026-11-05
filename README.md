# gmail-bucket

Use a Gmail account as a tiny S3-style object store. For demos and MVPs only.

## How it works

- A bucket is a Gmail label: `gmail-bucket/<bucket>`
- An object is one or more messages in that label with the file as an attachment
- Files over 12 MB are split into chunks (Gmail's attachment limit is 25 MB) and reassembled on read
- Messages are inserted straight into the label, so nothing lands in your inbox and nothing is sent
- Overwriting a key writes the new copy first, then trashes the old one
- Reads are verified with an MD5 etag

## Setup (about 5 minutes)

1. Go to https://console.cloud.google.com and create a project.
2. Enable the **Gmail API** for it.
3. OAuth consent screen: choose External, add your Gmail address under Test users.
4. Credentials > Create credentials > OAuth client ID > **Desktop app**. Download the JSON.
5. Save it as `~/.gmail-bucket/credentials.json`.
6. Run:

```bash
npm install
npm run build
node dist/cli.js auth     # opens the Google consent flow, saves a token
node dist/cli.js mb demo
node dist/cli.js put demo images/logo.png ./logo.png
node dist/cli.js ls demo
node dist/cli.js get demo images/logo.png ./copy.png
```

Note: while the consent screen is in "Testing" mode, Google expires the refresh token after 7 days. Just run `auth` again, or publish the app as "In production" (it can stay unverified for personal use).

## Use as a library

```ts
import { GmailBucket, getAuthedClient } from 'gmail-bucket';

const store = new GmailBucket(getAuthedClient());
await store.createBucket('demo');
await store.putObject('demo', 'notes/hello.txt', 'hi there', { contentType: 'text/plain' });
const { body, info } = await store.getObject('demo', 'notes/hello.txt');
const list = await store.listObjects('demo', { prefix: 'notes/' });
await store.deleteObject('demo', 'notes/hello.txt');
```

## Use over HTTP (from Next.js, curl, anything)

```bash
GMAIL_BUCKET_TOKEN=secret node dist/cli.js serve 4566

curl -X PUT  localhost:4566/demo -H "Authorization: Bearer secret"
curl -X PUT  localhost:4566/demo/pic.png -H "Authorization: Bearer secret" \
     -H "Content-Type: image/png" --data-binary @pic.png
curl         localhost:4566/demo?prefix=pic -H "Authorization: Bearer secret"
curl         localhost:4566/demo/pic.png -H "Authorization: Bearer secret" -o out.png
```

This is a simple REST API, not the S3 wire protocol, so the AWS SDK will not talk to it directly. Put a thin `upload()` / `download()` wrapper in your app and swap it for the real S3 client later.

## Limits and warnings

- Use a dedicated Gmail account, never your main one.
- Gmail API quota is roughly 250 units per second per user. Listing a big bucket fetches headers for every message, so keep demo buckets small (hundreds of objects, not millions).
- Whole objects are held in memory (no streaming), and the server caps uploads at 100 MB.
- Storage is the 15 GB free Google quota shared with Drive and Photos.
- Deletes go to Trash, which Gmail empties after 30 days.
- Using Gmail as a file store is outside its intended use, so do not ship this to real users.
- No public URLs and no presigned URLs.
