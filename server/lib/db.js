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

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'content.json');
const SEED_FILE = path.join(DATA_DIR, 'content.seed.json');

let cache = null;      // in-memory copy, avoids a disk read per request
let writeQueue = Promise.resolve();

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE, 'utf8') : '{}';
    fs.writeFileSync(DATA_FILE, seed);
  }
}

/** Returns the full content document (cached). */
function read() {
  if (cache) return cache;
  ensureFile();
  cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return cache;
}

/**
 * Persists the document. Writes are serialised through a promise queue and go
 * to a temp file first, so a crash mid-write can never truncate content.json.
 */
function write(doc) {
  cache = doc;
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    ensureFile();
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

module.exports = { read, write, update, slugify, uniqueSlug, newId, DATA_FILE };
