import { google } from 'googleapis';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;

/** Which backend a login should be able to use. */
export type AuthBackend = 'drive' | 'gmail';

export const DRIVE_SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
/** Full Drive access: only needed for a base folder this app did not create. */
export const DRIVE_SCOPE_FULL = 'https://www.googleapis.com/auth/drive';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

/**
 * `DRIVE_SCOPE=file` (default) limits Drive to files this app created.
 * `DRIVE_SCOPE=full` opts into the broad `drive` scope, which is required to use a pre-existing
 * `DRIVE_ROOT_FOLDER_ID` (or any file the app did not create itself).
 */
export function driveScope(): string {
  const mode = String(process.env.DRIVE_SCOPE ?? '').trim().toLowerCase();
  return mode === 'full' ? DRIVE_SCOPE_FULL : DRIVE_SCOPE_FILE;
}

/** The scopes one login would request for these backends. */
export function scopesFor(backends: readonly AuthBackend[] = ['drive']): string[] {
  const scopes: string[] = [];
  if (backends.includes('drive')) scopes.push(driveScope());
  if (backends.includes('gmail')) scopes.push(GMAIL_SCOPE);
  return scopes;
}

/** What a Drive + Gmail login asks for, resolved with the current `DRIVE_SCOPE`. */
export const SCOPES: string[] = scopesFor(['drive', 'gmail']);

export function dataDir(): string {
  return process.env.GMAIL_BUCKET_DIR || path.join(os.homedir(), '.gmail-bucket');
}
export function credFile(): string {
  return path.join(dataDir(), 'credentials.json');
}
export function tokenFile(): string {
  return path.join(dataDir(), 'token.json');
}

function envCredentials(): { client_id: string; client_secret: string } | undefined {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { client_id: id, client_secret: secret } : undefined;
}

function makeClient() {
  const env = envCredentials();
  if (env) return new google.auth.OAuth2(env.client_id, env.client_secret, REDIRECT);

  const file = credFile();
  if (!fs.existsSync(file)) {
    throw new Error(
      `No Google credentials. Save your OAuth "Desktop app" JSON to ${file}, ` +
        `or set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error('credentials.json has no "installed" or "web" section');
  return new google.auth.OAuth2(c.client_id, c.client_secret, REDIRECT);
}

/** Credentials file present (or set through env)? Does not prove a token exists. */
export function hasCredentials(): boolean {
  return Boolean(envCredentials()) || fs.existsSync(credFile());
}

export function hasToken(): boolean {
  return Boolean(process.env.GOOGLE_REFRESH_TOKEN) || fs.existsSync(tokenFile());
}

/**
 * Scopes recorded in the saved token, when they can be read. `undefined` when there is no token file,
 * or when the token comes from `GOOGLE_REFRESH_TOKEN` (a bare refresh token carries no scope list).
 */
export function tokenScopes(): string[] | undefined {
  if (process.env.GOOGLE_REFRESH_TOKEN || !fs.existsSync(tokenFile())) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as { scope?: string | string[] };
    const text = Array.isArray(raw.scope) ? raw.scope.join(' ') : String(raw.scope ?? '');
    const scopes = text.split(/\s+/).filter(Boolean);
    return scopes.length ? scopes : undefined;
  } catch {
    return undefined;
  }
}

export function getAuthedClient() {
  const client = makeClient();

  // Headless / hosted mode: a refresh token supplied through the environment.
  const refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (refresh) {
    client.setCredentials({ refresh_token: refresh, access_token: process.env.GOOGLE_ACCESS_TOKEN });
    return client;
  }

  const file = tokenFile();
  if (!fs.existsSync(file)) throw new Error('Not logged in yet. Run: npm run auth');
  client.setCredentials(JSON.parse(fs.readFileSync(file, 'utf8')));
  client.on('tokens', (t) => {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...prev, ...t }, null, 2), { mode: 0o600 });
  });
  return client;
}

/**
 * Log in for one or more backends. Defaults to Drive only, so a Drive user never grants mailbox access.
 * Drive asks for `drive.file` unless `DRIVE_SCOPE=full`.
 */
export async function login(backends: readonly AuthBackend[] = ['drive']): Promise<void> {
  const scopes = scopesFor(backends);
  if (!scopes.length) throw new Error('login() needs at least one backend: drive, gmail, or both');
  const client = makeClient();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
  console.log(`\nScopes requested for ${backends.join(' + ')}:`);
  for (const scope of scopes) console.log(`  ${scope}`);
  console.log('\nOpen this URL in your browser and approve access:\n\n' + url + '\n');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.setHeader('content-type', 'text/plain');
      if (c) {
        res.end('Done. You can close this tab and go back to the terminal.');
        server.close();
        resolve(c);
      } else {
        res.end('Waiting for authorization...');
        if (err) {
          server.close();
          reject(new Error(err));
        }
      }
    });
    server.listen(PORT);
  });

  const { tokens } = await client.getToken(code);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(tokenFile(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Saved token to ${tokenFile()}`);
  if (backends.includes('drive') && !backends.includes('gmail')) {
    console.log('Drive only — this token cannot read your mailbox. Use "auth --gmail" (or --all) for Gmail.');
  }
  if (backends.includes('drive') && driveScope() === DRIVE_SCOPE_FULL) {
    console.log('DRIVE_SCOPE=full — this token can reach every file in the account.');
  }
  if (!tokens.refresh_token) {
    console.log(
      'Note: Google did not return a refresh token. If it expires in 7 days, run "npm run auth" again ' +
        'or set GOOGLE_REFRESH_TOKEN in .env.'
    );
  }
}
