/**
 * env.js — reads configuration into process.env without a dependency.
 *
 * Sources, highest precedence first:
 *
 *   1. Real environment variables (a hosting panel, systemd, docker, pm2)
 *   2. $KOYDAM_ENV_FILE, if set — an explicit path to a config file
 *   3. <project>/.env
 *   4. <project>/../koydam.env — a sibling of the project directory
 *
 * Source 4 exists because a deployment rewrites the project directory. Anything
 * kept inside it — including .env — can be replaced or deleted by a git checkout
 * or an SFTP re-upload, which silently logs the owner out of their own admin
 * panel. A file one level above the project survives every deploy.
 *
 * A key already present in process.env is never overwritten, so a hosting panel
 * always wins over a file on disk.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

/** Parses KEY=value lines, ignoring comments and stripping wrapping quotes. */
function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Where each key came from. Knowing this matters: a stale value in a hosting
 * panel silently overrides a correct one in a file, and without this map the
 * resulting error looks identical to a typo in the file.
 */
const origins = new Map();

/**
 * Loads configuration and returns a description of where it came from,
 * so the server can report it at boot.
 */
function load() {
  // Anything already present came from the real environment — a hosting
  // panel, pm2, systemd, docker — and outranks every file.
  for (const key of Object.keys(process.env)) origins.set(key, 'the hosting panel / real environment');

  const candidates = [
    process.env.KOYDAM_ENV_FILE,
    path.join(PROJECT_ROOT, '.env'),
    path.join(PROJECT_ROOT, '..', 'koydam.env'),
  ].filter(Boolean);

  const sources = [];

  for (const file of candidates) {
    let text;
    try {
      if (!fs.existsSync(file)) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      console.warn(`[env] could not read ${file}: ${err.message}`);
      continue;
    }

    const values = parse(text);
    const applied = [];
    const overridden = [];

    for (const [key, value] of Object.entries(values)) {
      if (key in process.env) {
        overridden.push(key); // a higher-precedence source already set it
        continue;
      }
      process.env[key] = value;
      origins.set(key, file);
      applied.push(key);
    }

    sources.push({ file, found: Object.keys(values).length, applied: applied.length, overridden });
  }

  return sources;
}

/** Returns a human-readable description of where a key's value came from. */
function sourceOf(key) {
  return origins.get(key) || 'an unknown source';
}

/** Human-readable summary of where configuration came from. */
function describe(sources) {
  if (!sources || !sources.length) {
    return 'Configuration: environment variables only (no config file found).';
  }

  const lines = [];
  for (const s of sources) {
    lines.push(`  ${s.file} — ${s.found} value${s.found === 1 ? '' : 's'}, ${s.applied} applied`);
    if (s.overridden && s.overridden.length) {
      // The most confusing failure mode there is: the file is correct, but a
      // stale value in the panel is winning. Name the keys explicitly.
      lines.push(`    ignored (already set in the environment): ${s.overridden.join(', ')}`);
    }
  }
  return `Configuration loaded from:\n${lines.join('\n')}`;
}

module.exports = { load, describe, parse, sourceOf, PROJECT_ROOT };
