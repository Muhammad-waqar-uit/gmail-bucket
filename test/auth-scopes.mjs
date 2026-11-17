/**
 * Scope selection: Drive is drive.file by default, Gmail is opt-in, DRIVE_SCOPE=full widens Drive.
 * Run: npm run test:scopes
 */
import assert from 'node:assert/strict';

delete process.env.DRIVE_SCOPE;

const { driveScope, scopesFor, SCOPES, DRIVE_SCOPE_FILE, DRIVE_SCOPE_FULL, GMAIL_SCOPE } = await import(
  '../dist/auth.js'
);

let passed = 0;
function check(name, fn) {
  fn();
  console.log(`  ok  ${++passed}. ${name}`);
}

check('Drive login asks for drive.file only', () =>
  assert.deepEqual(scopesFor(['drive']), [DRIVE_SCOPE_FILE])
);
check('scopesFor() defaults to Drive', () => assert.deepEqual(scopesFor(), [DRIVE_SCOPE_FILE]));
check('Gmail login never asks for Drive', () => assert.deepEqual(scopesFor(['gmail']), [GMAIL_SCOPE]));
check('Both backends get one scope each', () =>
  assert.deepEqual(scopesFor(['drive', 'gmail']), [DRIVE_SCOPE_FILE, GMAIL_SCOPE])
);
check('No backends means no scopes', () => assert.deepEqual(scopesFor([]), []));
check('SCOPES was resolved at import time with drive.file', () =>
  assert.deepEqual(SCOPES, [DRIVE_SCOPE_FILE, GMAIL_SCOPE])
);

process.env.DRIVE_SCOPE = 'full';
check('DRIVE_SCOPE=full widens Drive', () => assert.deepEqual(scopesFor(['drive']), [DRIVE_SCOPE_FULL]));
check('DRIVE_SCOPE=full keeps Gmail opt-in', () =>
  assert.deepEqual(scopesFor(['drive', 'gmail']), [DRIVE_SCOPE_FULL, GMAIL_SCOPE])
);
check('driveScope() is case-insensitive and trims', () => {
  process.env.DRIVE_SCOPE = 'FULL';
  assert.equal(driveScope(), DRIVE_SCOPE_FULL);
  process.env.DRIVE_SCOPE = ' file ';
  assert.equal(driveScope(), DRIVE_SCOPE_FILE);
  delete process.env.DRIVE_SCOPE;
  assert.equal(driveScope(), DRIVE_SCOPE_FILE);
});

console.log(`\n${passed} checks passed (scopes)`);
