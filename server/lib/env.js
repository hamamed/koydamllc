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
 * Loads configuration and returns a description of where it came from,
 * so the server can report it at boot.
 */
function load() {
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
    for (const [key, value] of Object.entries(values)) {
      if (key in process.env) continue; // never override a real env var
      process.env[key] = value;
      applied.push(key);
    }
    sources.push({ file, found: Object.keys(values).length, applied: applied.length });
  }

  return sources;
}

/** Human-readable summary of where configuration came from. */
function describe(sources) {
  if (!sources || !sources.length) {
    return 'Configuration: environment variables only (no config file found).';
  }
  const lines = sources.map(
    (s) => `  ${s.file} — ${s.found} value${s.found === 1 ? '' : 's'}, ${s.applied} applied`,
  );
  return `Configuration loaded from:\n${lines.join('\n')}`;
}

module.exports = { load, describe, parse, PROJECT_ROOT };
