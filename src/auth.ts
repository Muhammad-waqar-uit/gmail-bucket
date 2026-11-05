import { google } from 'googleapis';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

export const DIR = process.env.GMAIL_BUCKET_DIR ?? path.join(os.homedir(), '.gmail-bucket');
const CRED_FILE = path.join(DIR, 'credentials.json');
const TOKEN_FILE = path.join(DIR, 'token.json');
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
export const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

function makeClient() {
  if (!fs.existsSync(CRED_FILE)) {
    throw new Error(`Missing ${CRED_FILE}. Download your OAuth "Desktop app" credentials from Google Cloud and save them there.`);
  }
  const raw = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error('credentials.json has no "installed" or "web" section');
  return new google.auth.OAuth2(c.client_id, c.client_secret, REDIRECT);
}

export function getAuthedClient() {
  const client = makeClient();
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('Not logged in yet. Run: gmail-bucket auth');
  client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
  client.on('tokens', (t) => {
    const prev = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...prev, ...t }, null, 2), { mode: 0o600 });
  });
  return client;
}

export async function login(): Promise<void> {
  const client = makeClient();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
  console.log('Open this URL in your browser and approve access:\n\n' + url + '\n');

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
        if (err) { server.close(); reject(new Error(err)); }
      }
    });
    server.listen(PORT);
  });

  const { tokens } = await client.getToken(code);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Saved token to ${TOKEN_FILE}`);
}
