#!/usr/bin/env node
/**
 * Loads the legal documents in server/data/legal/*.html into the CMS.
 *
 *   node server/scripts/load-legal.js            # write to content.json + seed
 *   node server/scripts/load-legal.js --seed     # seed only (fresh installs)
 *   node server/scripts/load-legal.js --dry      # print what would change
 *
 * The documents live as readable HTML files so they can be reviewed and diffed
 * in version control. This script is the one-way bridge into the datastore;
 * after loading, the admin panel is free to edit them further.
 */

const fs = require('fs');
const path = require('path');

const LEGAL_DIR = path.join(__dirname, '..', 'data', 'legal');
const DATA_FILE = path.join(__dirname, '..', 'data', 'content.json');
const SEED_FILE = path.join(__dirname, '..', 'data', 'content.seed.json');

const DOCS = {
  privacy: { file: 'privacy.html', title: 'Privacy Policy' },
  terms: { file: 'terms.html', title: 'Terms of Service' },
};

const args = process.argv.slice(2);
const seedOnly = args.includes('--seed');
const dryRun = args.includes('--dry');
const today = new Date().toISOString().slice(0, 10);

function loadDocs() {
  const out = {};
  for (const [key, meta] of Object.entries(DOCS)) {
    const file = path.join(LEGAL_DIR, meta.file);
    if (!fs.existsSync(file)) throw new Error(`Missing source document: ${file}`);
    out[key] = {
      title: meta.title,
      updatedAt: today,
      // Collapse to a single line: the CMS stores the body as one HTML string.
      body: fs.readFileSync(file, 'utf8').trim(),
    };
  }
  return out;
}

function applyTo(target, docs, label) {
  if (!fs.existsSync(target)) {
    console.log(`  ${label}: not present, skipped`);
    return;
  }
  const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
  doc.pages = doc.pages || {};

  for (const [key, page] of Object.entries(docs)) {
    const before = (doc.pages[key]?.body || '').length;
    doc.pages[key] = page;
    console.log(`  ${label}: ${key} ${before} → ${page.body.length} chars`);
  }

  if (dryRun) return;
  fs.writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
}

const docs = loadDocs();
console.log(dryRun ? 'Dry run — nothing will be written.\n' : `Loading legal documents (updatedAt ${today})\n`);

applyTo(SEED_FILE, docs, 'seed');
if (!seedOnly) applyTo(DATA_FILE, docs, 'live');

console.log(dryRun ? '\nNo changes written.' : '\nDone. Restart the server if it caches content in memory.');
