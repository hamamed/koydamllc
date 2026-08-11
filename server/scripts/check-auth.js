#!/usr/bin/env node
/**
 * Diagnoses admin login failures (HTTP 401 from /api/admin/login).
 *
 *   node server/scripts/check-auth.js                 # inspect configuration
 *   node server/scripts/check-auth.js "my password"   # also test that password
 *
 * Never prints the hash or the password — only whether they match, and which
 * part of the configuration is wrong.
 */

require('../lib/env').load();

const { checkPassword, hashPassword, inspectHash } = require('../lib/auth');

const candidate = process.argv[2];
const problems = [];
const warnings = [];

console.log('Admin authentication configuration');
console.log('----------------------------------');

/* ---- NODE_ENV ---- */
const env = process.env.NODE_ENV || '(not set)';
console.log(`  NODE_ENV             ${env}`);
if (env !== 'production') {
  warnings.push('NODE_ENV is not "production": the session cookie will not be marked Secure.');
}

/* ---- SESSION_SECRET ---- */
const secret = process.env.SESSION_SECRET || '';
console.log(`  SESSION_SECRET       ${secret ? `set (${secret.length} chars)` : 'NOT SET'}`);
if (!secret) {
  problems.push('SESSION_SECRET is not set. Login may appear to succeed but the session cookie will not survive a restart.');
} else if (secret.length < 32) {
  warnings.push('SESSION_SECRET is short. Use at least 32 characters.');
} else if (secret === 'change-me-to-a-long-random-string') {
  problems.push('SESSION_SECRET is still the example value from .env.example.');
}

/* ---- ADMIN_EMAIL ---- */
const email = process.env.ADMIN_EMAIL || '';
console.log(`  ADMIN_EMAIL          ${email || 'NOT SET (defaults to hello@koydam.com)'}`);
if (email !== email.trim()) {
  problems.push('ADMIN_EMAIL has leading or trailing whitespace — the panel may have added it.');
}
if (/^["']|["']$/.test(email)) {
  problems.push('ADMIN_EMAIL is wrapped in quotes. Environment-variable panels store quotes literally — remove them.');
}

/* ---- Credentials ---- */
const hash = process.env.ADMIN_PASSWORD_HASH || '';
const plain = process.env.ADMIN_PASSWORD || '';

console.log(`  ADMIN_PASSWORD_HASH  ${hash ? `set (${hash.length} chars)` : 'NOT SET'}`);
console.log(`  ADMIN_PASSWORD       ${plain ? 'set (plaintext fallback)' : 'not set'}`);

if (!hash && !plain) {
  problems.push('Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set — every login attempt returns 401.');
}

if (hash) {
  // Quotes, surrounding whitespace and internal line breaks are tolerated by
  // the server, so report them as notes rather than problems.
  if (/^["']|["']$/.test(hash)) {
    warnings.push('ADMIN_PASSWORD_HASH is wrapped in quotes. Tolerated, but cleaner to remove them.');
  }
  if (/\s/.test(hash.trim())) {
    warnings.push('ADMIN_PASSWORD_HASH contains a space or line break inside the value. '
      + 'Tolerated, but it suggests the field soft-wrapped when pasted.');
  }

  const info = inspectHash(hash);
  const explain = {
    empty: 'the variable is set but empty',
    'no-separator': 'there is no ":" in the value',
    'bad-salt': 'the part before ":" is not 32 characters',
    'bad-digest': 'the part after ":" is not 64 characters (or 128 for a legacy hash)',
    'not-hex': 'it contains characters outside 0-9 and a-f',
  };

  if (info.ok) {
    const digestLen = info.hash.split(':')[1].length;
    console.log(`  hash format          ok (${info.length} chars${digestLen === 128 ? ', legacy 64-byte digest' : ''})`);
  } else {
    console.log(`  hash format          UNUSABLE — ${explain[info.problem] || info.problem}`);
    problems.push(`ADMIN_PASSWORD_HASH is unusable: ${explain[info.problem] || info.problem}. `
      + `The value stored is ${info.length} characters; a valid hash is 97. `
      + 'Regenerate with: node server/scripts/hash-password.js "your password"');
  }
}

if (plain && process.env.NODE_ENV === 'production') {
  warnings.push('ADMIN_PASSWORD (plaintext) is set in production. Use ADMIN_PASSWORD_HASH only.');
}

/* ---- Live password test ---- */
if (candidate) {
  console.log('\nPassword test');
  console.log('-------------');
  if (hash) {
    let matched = false;
    try {
      matched = checkPassword(candidate, hash.trim().replace(/^["']|["']$/g, ''));
    } catch (err) {
      console.log(`  hash comparison failed: ${err.message}`);
    }
    console.log(`  against ADMIN_PASSWORD_HASH: ${matched ? 'MATCH — this password works' : 'no match'}`);
    if (!matched) {
      problems.push('The password you supplied does not match the configured hash. '
        + 'Regenerate with: node server/scripts/hash-password.js "your password"');
      console.log(`\n  A correct hash for the password you just supplied would be:\n  ${hashPassword(candidate)}`);
    }
  } else if (plain) {
    console.log(`  against ADMIN_PASSWORD: ${candidate === plain ? 'MATCH' : 'no match'}`);
  } else {
    console.log('  nothing configured to test against');
  }
} else {
  console.log('\nTip: pass your password as an argument to test it:');
  console.log('  node server/scripts/check-auth.js "your password"');
}

/* ---- Verdict ---- */
console.log('');
if (warnings.length) {
  console.log('Warnings');
  warnings.forEach((w) => console.log(`  ! ${w}`));
  console.log('');
}
if (problems.length) {
  console.log('Problems found');
  problems.forEach((p) => console.log(`  x ${p}`));
  console.log('\nAfter fixing, restart the app — environment variables are read only at startup.');
  process.exit(1);
}
console.log('No configuration problems detected.');
console.log('If login still returns 401, confirm the email you type matches ADMIN_EMAIL exactly,');
console.log('and that the running process was restarted after the variables were set.');
