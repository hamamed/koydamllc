/**
 * db.js — tiny JSON-file datastore.
 *
 * The whole site is content-managed from a single JSON document. This keeps the
 * stack dependency-free and trivially portable (copy the file = copy the site).
 * Swapping this module for SQLite/Postgres later only requires keeping the same
 * exported surface: read(), write(), update().
 */

const fs = require('fs');
const path = require('path');

/**
 * Where live content is stored.
 *
 * Defaults to server/data inside the project, which is fine locally — but a
 * deployment rewrites the project directory, and a clean checkout takes
 * content.json with it: every app, page, invoice and enquiry, gone, silently
 * reseeded from the demo data on next boot.
 *
 * Set KOYDAM_DATA_DIR to a directory OUTSIDE the deploy path and no deployment
 * can touch your content.
 */
const DATA_DIR = process.env.KOYDAM_DATA_DIR
  ? path.resolve(process.env.KOYDAM_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DATA_FILE = path.join(DATA_DIR, 'content.json');

// The seed ships with the code and always lives in the project.
const SEED_FILE = path.join(__dirname, '..', 'data', 'content.seed.json');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 20;

let cache = null;      // in-memory copy, avoids a disk read per request
let writeQueue = Promise.resolve();

/** The pre-KOYDAM_DATA_DIR location, kept for one-time migration. */
const LEGACY_FILE = path.join(__dirname, '..', 'data', 'content.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) return;

  // Moving to an external data directory must not silently reset the site.
  // If content already exists in the old in-project location, adopt it rather
  // than starting from the demo seed.
  if (DATA_FILE !== LEGACY_FILE && fs.existsSync(LEGACY_FILE)) {
    try {
      fs.copyFileSync(LEGACY_FILE, DATA_FILE);
      console.log(`[db] migrated existing content from ${LEGACY_FILE}`);
      console.log(`[db]   to ${DATA_FILE} — the original was left in place.`);
      return;
    } catch (err) {
      console.warn(`[db] could not migrate existing content: ${err.message}`);
    }
  }

  const seed = fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE, 'utf8') : '{}';
  fs.writeFileSync(DATA_FILE, seed);
  console.log('[db] no existing content found — started from the seed.');
}

/** Returns the full content document (cached). */
function read() {
  if (cache) return cache;
  ensureFile();
  cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return cache;
}

/**
 * Keeps a rolling set of snapshots. content.json is the entire site, so a bad
 * edit or a corrupt write should never be unrecoverable.
 */
function snapshot() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `content-${stamp}.json`));

    const old = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('content-') && f.endsWith('.json'))
      .sort()
      .slice(0, -KEEP_BACKUPS);
    for (const file of old) fs.unlinkSync(path.join(BACKUP_DIR, file));
  } catch (err) {
    // A failed backup must never block the write itself.
    console.warn(`[db] could not write backup: ${err.message}`);
  }
}

/**
 * Persists the document. Writes are serialised through a promise queue and go
 * to a temp file first, so a crash mid-write can never truncate content.json.
 * The previous version is snapshotted before every overwrite.
 */
function write(doc) {
  cache = doc;
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    ensureFile();
    snapshot();
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFile(tmp, JSON.stringify(doc, null, 2), (err) => {
      if (err) return reject(err);
      fs.rename(tmp, DATA_FILE, (err2) => (err2 ? reject(err2) : resolve()));
    });
  }));
  return writeQueue;
}

/** Mutate the document with a callback and persist the result. */
function update(mutator) {
  const doc = read();
  const next = mutator(doc) || doc;
  return write(next).then(() => next);
}

/** URL-safe slug: "My New App!" -> "my-new-app" */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Ensures a slug is unique within a collection, appending -2, -3, ... */
function uniqueSlug(base, collection, ignoreId) {
  const root = slugify(base) || 'item';
  let slug = root;
  let n = 2;
  while (collection.some((item) => item.slug === slug && item.id !== ignoreId)) {
    slug = `${root}-${n++}`;
  }
  return slug;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Describes where content lives, and warns when it sits inside the deploy path. */
function describeStorage() {
  const external = Boolean(process.env.KOYDAM_DATA_DIR);
  const exists = fs.existsSync(DATA_FILE);
  const willMigrate = !exists && DATA_FILE !== LEGACY_FILE && fs.existsSync(LEGACY_FILE);

  const note = exists ? ''
    : willMigrate ? ' (empty — existing content will be copied here on first use)'
    : ' (empty — will start from the seed)';

  const lines = [`Content store: ${DATA_FILE}${note}`];

  if (!external) {
    lines.push('  WARNING: this is inside the project directory. A deployment that');
    lines.push('  replaces the project will delete it, resetting the site to demo');
    lines.push('  content. Set KOYDAM_DATA_DIR to a directory outside the deploy path.');
  }
  return lines.join('\n');
}

module.exports = {
  read, write, update, slugify, uniqueSlug, newId,
  DATA_FILE, DATA_DIR, BACKUP_DIR, describeStorage,
};
