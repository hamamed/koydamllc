/**
 * Koydam LLC — application server.
 *
 *   /                    static public site (public/)
 *   /api/*               public read API + contact form
 *   /admin/*             admin panel (auth-gated static pages)
 *   /api/admin/*         admin write API (auth-gated JSON)
 *
 * Everything the site renders comes from server/data/content.json, which the
 * admin panel edits. No build step, no database server.
 */

const envLoader = require('./lib/env');
const ENV_SOURCES = envLoader.load();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./lib/db');
const auth = require('./lib/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* ------------------------------------------------------------------ *
 * Naive fixed-window rate limiter (per IP, per bucket).
 * Sufficient for a single-instance marketing site; swap for a shared
 * store if the app is ever scaled horizontally.
 * ------------------------------------------------------------------ */
const buckets = new Map();
function rateLimit({ key, max, windowMs }) {
  return (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const entry = buckets.get(id);
    if (!entry || now > entry.reset) {
      buckets.set(id, { count: 1, reset: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      const retry = Math.ceil((entry.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    entry.count += 1;
    next();
  };
}
// Drop expired buckets every 10 minutes so the map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of buckets) if (now > entry.reset) buckets.delete(id);
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ *
 * File uploads (app icons + screenshots)
 * ------------------------------------------------------------------ */
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']);
const EXT_FOR_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/gif': '.gif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Never trust the client filename — derive the extension from the MIME type.
    filename: (req, file, cb) => cb(null, `${db.newId('img')}${EXT_FOR_MIME[file.mimetype] || '.bin'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const PLATFORMS = ['ios', 'android', 'web', 'saas'];
const STATUSES = ['published', 'draft', 'archived'];

/**
 * Launch state is separate from publish state. `status` controls whether the
 * app appears on the site at all; `launchStatus` describes where the product
 * itself is — so an app can be fully visible and promoted while still being
 * weeks away from the stores.
 */
const LAUNCH_STATUSES = ['live', 'coming-soon', 'in-development', 'beta'];

/** Strips draft/archived apps and any owner-only fields before sending publicly. */
function publicView(doc) {
  const apps = arr(doc.apps)
    .filter((a) => a.status === 'published')
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    settings: doc.settings,
    home: doc.home,
    services: doc.services,
    process: doc.process,
    pages: doc.pages,
    apps,
  };
}

/* ================================================================== *
 * PUBLIC API
 * ================================================================== */

app.get('/api/content', (req, res) => {
  res.json(publicView(db.read()));
});

app.get('/api/apps', (req, res) => {
  const { platform, q } = req.query;
  let apps = publicView(db.read()).apps;
  if (platform && platform !== 'all') {
    apps = apps.filter((a) => arr(a.platforms).includes(String(platform).toLowerCase()));
  }
  if (q) {
    const needle = String(q).toLowerCase();
    apps = apps.filter((a) =>
      [a.title, a.tagline, a.category].join(' ').toLowerCase().includes(needle));
  }
  res.json({ apps });
});

app.get('/api/apps/:slug', (req, res) => {
  const app_ = publicView(db.read()).apps.find((a) => a.slug === req.params.slug);
  if (!app_) return res.status(404).json({ error: 'App not found' });
  res.json({ app: app_ });
});

app.post('/api/contact', rateLimit({ key: 'contact', max: 5, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  const { name, email, company, subject, message, website } = req.body || {};

  // `website` is a hidden honeypot field — real users never fill it in.
  if (website) return res.json({ ok: true });

  const errors = {};
  if (str(name).length < 2) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(email))) errors.email = 'Please enter a valid email address.';
  if (str(message, 5000).length < 10) errors.message = 'Please tell us a little more (10 characters minimum).';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  const inquiry = {
    id: db.newId('inq'),
    name: str(name, 120),
    email: str(email, 160),
    company: str(company, 160),
    subject: str(subject, 200) || 'New enquiry',
    message: str(message, 5000),
    createdAt: new Date().toISOString(),
    ip: req.ip,
    read: false,
    archived: false,
  };

  try {
    await db.update((doc) => {
      doc.inquiries = [inquiry, ...arr(doc.inquiries)].slice(0, 2000);
      return doc;
    });
  } catch (err) {
    console.error('[contact] failed to persist inquiry', err);
    return res.status(500).json({ error: 'Could not send your message. Please email us directly.' });
  }

  // Email is best-effort: the inquiry is already saved and visible in the admin panel.
  sendNotification(inquiry).catch((err) => console.error('[contact] email failed', err.message));
  res.json({ ok: true });
});

async function sendNotification(inquiry) {
  if (!process.env.SMTP_HOST) return;
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  await transport.sendMail({
    from: process.env.MAIL_FROM || 'Koydam Website <no-reply@koydam.com>',
    to: process.env.MAIL_TO || 'hello@koydam.com',
    replyTo: inquiry.email,
    subject: `[Koydam] ${inquiry.subject} — ${inquiry.name}`,
    text: `${inquiry.name} <${inquiry.email}>\n${inquiry.company}\n\n${inquiry.message}`,
    html: `<p><strong>${esc(inquiry.name)}</strong> &lt;${esc(inquiry.email)}&gt;<br>${esc(inquiry.company)}</p>
           <p>${esc(inquiry.message).replace(/\n/g, '<br>')}</p>`,
  });
}

/* ================================================================== *
 * ADMIN — auth
 * ================================================================== */

app.post('/api/admin/login', rateLimit({ key: 'login', max: 8, windowMs: 10 * 60 * 1000 }), (req, res) => {
  const { email, password } = req.body || {};
  const result = auth.authenticate(email, password);

  if (!result.ok) {
    // Log the precise cause; the response stays vague so it cannot be used to
    // enumerate valid emails.
    console.warn(`[auth] login failed from ${req.ip}: ${result.reason}`);

    // The two exceptions: with nothing configured, or a hash that cannot
    // possibly match, nobody can log in at all — so there is no security to
    // preserve, and the operator needs to be told what is wrong.
    if (result.reason === 'not-configured') {
      return res.status(503).json({
        error: 'Admin login is not configured on this server. Set ADMIN_PASSWORD_HASH in the environment and restart.',
      });
    }
    if (result.reason === 'hash-malformed') {
      const { length = 0, problem = 'unknown' } = result.detail || {};
      const why = {
        empty: 'the variable is set but empty',
        'no-separator': 'there is no ":" in the value',
        'bad-salt': 'the part before ":" is not 32 characters',
        'bad-digest': 'the part after ":" is not 64 characters',
        'not-hex': 'it contains characters that are not 0-9 or a-f',
      }[problem] || problem;

      return res.status(503).json({
        error: `ADMIN_PASSWORD_HASH is unusable — ${why}. The server received ${length} characters; `
          + 'a valid hash is 97 (32-char salt, colon, 64-char digest). '
          + `This value came from ${envLoader.sourceOf('ADMIN_PASSWORD_HASH')} — `
          + 'fix it there, not anywhere else, then restart.'
          + (length === 13 ? ' A 13-character value is usually the password itself rather than its hash.' : ''),
      });
    }
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  auth.setSessionCookie(res, auth.issueToken(String(email).toLowerCase()));
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', auth.requireAuth, (req, res) => {
  res.json({ email: req.session.email });
});

/* ================================================================== *
 * ADMIN — content API (all routes below require a session)
 * ================================================================== */
const admin = express.Router();
admin.use(auth.requireAuth);

/** Full document, including drafts and inquiries. */
admin.get('/content', (req, res) => res.json(db.read()));

/* ---- Apps CRUD ---- */

/** Normalises an app payload; `existing` supplies defaults on update. */
function normaliseApp(body, doc, existing) {
  const id = existing ? existing.id : db.newId('app');
  const title = str(body.title, 120);
  const platforms = arr(body.platforms).map((p) => String(p).toLowerCase()).filter((p) => PLATFORMS.includes(p));
  const status = STATUSES.includes(body.status) ? body.status : 'draft';

  // On update, an empty slug field keeps the existing slug — renaming an app
  // must not silently break the URL it was already published under.
  const slugSource = str(body.slug) || (existing ? existing.slug : title);

  return {
    id,
    slug: db.uniqueSlug(slugSource, arr(doc.apps), id),
    title,
    tagline: str(body.tagline, 200),
    description: str(body.description, 20000), // trusted HTML — authored by the admin
    features: arr(body.features).map((f) => str(f, 300)).filter(Boolean).slice(0, 30),
    icon: str(body.icon, 500),
    screenshots: arr(body.screenshots).map((s) => str(s, 500)).filter(Boolean).slice(0, 20),
    platforms,
    category: str(body.category, 80),
    version: str(body.version, 40),
    releaseDate: str(body.releaseDate, 20),
    playStoreUrl: str(body.playStoreUrl, 500),
    appStoreUrl: str(body.appStoreUrl, 500),
    webUrl: str(body.webUrl, 500),
    status,
    // Existing apps have no launchStatus; treat them as already live.
    launchStatus: LAUNCH_STATUSES.includes(body.launchStatus) ? body.launchStatus : 'live',
    expectedLaunch: str(body.expectedLaunch, 60),
    featured: Boolean(body.featured),
    order: Number.isFinite(Number(body.order)) ? Number(body.order) : arr(doc.apps).length + 1,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

admin.post('/apps', async (req, res) => {
  if (!str(req.body.title)) return res.status(400).json({ error: 'Title is required.' });
  let created;
  await db.update((doc) => {
    doc.apps = arr(doc.apps);
    created = normaliseApp(req.body, doc, null);
    doc.apps.push(created);
    return doc;
  });
  res.status(201).json({ app: created });
});

admin.put('/apps/:id', async (req, res) => {
  const doc = db.read();
  const existing = arr(doc.apps).find((a) => a.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'App not found.' });
  if (!str(req.body.title)) return res.status(400).json({ error: 'Title is required.' });

  let updated;
  await db.update((d) => {
    updated = normaliseApp(req.body, d, existing);
    d.apps = arr(d.apps).map((a) => (a.id === existing.id ? updated : a));
    return d;
  });
  res.json({ app: updated });
});

admin.delete('/apps/:id', async (req, res) => {
  const before = arr(db.read().apps).length;
  await db.update((doc) => {
    doc.apps = arr(doc.apps).filter((a) => a.id !== req.params.id);
    return doc;
  });
  if (arr(db.read().apps).length === before) return res.status(404).json({ error: 'App not found.' });
  res.json({ ok: true });
});

/** Bulk reorder: body = { ids: ["app_a", "app_b", ...] } in display order. */
admin.put('/apps-order', async (req, res) => {
  const ids = arr(req.body.ids);
  await db.update((doc) => {
    doc.apps = arr(doc.apps).map((a) => {
      const idx = ids.indexOf(a.id);
      return idx === -1 ? a : { ...a, order: idx + 1 };
    });
    return doc;
  });
  res.json({ ok: true });
});

/* ---- Pages (privacy, terms) + home copy ---- */

admin.put('/pages/:key', async (req, res) => {
  const key = req.params.key;
  if (!['privacy', 'terms'].includes(key)) return res.status(400).json({ error: 'Unknown page.' });
  let page;
  await db.update((doc) => {
    doc.pages = doc.pages || {};
    page = {
      title: str(req.body.title, 160) || (key === 'privacy' ? 'Privacy Policy' : 'Terms of Service'),
      updatedAt: str(req.body.updatedAt, 20) || new Date().toISOString().slice(0, 10),
      body: str(req.body.body, 200000),
    };
    doc.pages[key] = page;
    return doc;
  });
  res.json({ page });
});

admin.put('/home', async (req, res) => {
  let home;
  await db.update((doc) => {
    home = { ...doc.home, ...req.body };
    doc.home = home;
    return doc;
  });
  res.json({ home });
});

admin.put('/services', async (req, res) => {
  let services;
  await db.update((doc) => {
    services = arr(req.body.services).map((s) => ({
      id: str(s.id, 60) || db.newId('svc'),
      icon: str(s.icon, 60) || 'square',
      title: str(s.title, 120),
      summary: str(s.summary, 400),
      bullets: arr(s.bullets).map((b) => str(b, 160)).filter(Boolean).slice(0, 8),
    })).filter((s) => s.title);
    doc.services = services;
    return doc;
  });
  res.json({ services });
});

/* ---- Company settings ---- */

admin.put('/settings', async (req, res) => {
  let settings;
  await db.update((doc) => {
    const b = req.body || {};
    settings = {
      ...doc.settings,
      companyName: str(b.companyName, 120) || doc.settings.companyName,
      legalName: str(b.legalName, 160),
      tagline: str(b.tagline, 300),
      email: str(b.email, 160),
      supportEmail: str(b.supportEmail, 160),
      phone: str(b.phone, 60),
      address: {
        line1: str(b.address?.line1, 200),
        city: str(b.address?.city, 100),
        state: str(b.address?.state, 60),
        zip: str(b.address?.zip, 20),
        country: str(b.address?.country, 100),
      },
      socials: {
        x: str(b.socials?.x, 300),
        linkedin: str(b.socials?.linkedin, 300),
        github: str(b.socials?.github, 300),
        instagram: str(b.socials?.instagram, 300),
      },
      copyright: str(b.copyright, 300) || doc.settings.copyright,
    };
    doc.settings = settings;
    return doc;
  });
  res.json({ settings });
});

/* ================================================================== *
 * Invoices
 *
 * Totals are computed and STORED on each invoice, never recomputed on
 * read. A historical invoice must keep the numbers it was issued with,
 * even if the tax rate or currency later changes.
 * ================================================================== */

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

/** Rounds to 2 decimals without the usual float drift (0.1+0.2 style). */
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100 || 0;

/** Builds the next invoice number from the configured format and counter. */
function buildInvoiceNumber(settings) {
  const seq = String(settings.nextNumber || 1).padStart(Number(settings.padding) || 4, '0');
  return String(settings.format || '{prefix}-{year}-{seq}')
    .replace('{prefix}', settings.prefix || 'INV')
    .replace('{year}', String(new Date().getFullYear()))
    .replace('{seq}', seq);
}

/** Normalises a line item and computes its amount. */
function normaliseItem(item) {
  const quantity = money(item.quantity);
  const unitPrice = money(item.unitPrice);
  return {
    description: str(item.description, 500),
    quantity,
    unitPrice,
    amount: money(quantity * unitPrice),
  };
}

/**
 * Validates + totals an invoice payload.
 * `existing` supplies immutable fields (number, createdAt) on update.
 */
function normaliseInvoice(body, doc, existing) {
  const settings = doc.invoiceSettings || {};
  const items = arr(body.items).map(normaliseItem).filter((i) => i.description || i.amount);

  const subtotal = money(items.reduce((sum, i) => sum + i.amount, 0));
  const discount = money(body.discount);
  const taxRate = money(body.taxRate);
  const taxable = money(subtotal - discount);
  const taxAmount = money((taxable * taxRate) / 100);
  const total = money(taxable + taxAmount);

  const b = body.client || {};
  const address = b.address || {};

  return {
    id: existing ? existing.id : db.newId('inv'),
    number: existing ? existing.number : str(body.number, 60),
    status: INVOICE_STATUSES.includes(body.status) ? body.status : 'draft',

    issueDate: str(body.issueDate, 20) || new Date().toISOString().slice(0, 10),
    dueDate: str(body.dueDate, 20),

    client: {
      name: str(b.name, 160),
      company: str(b.company, 160),
      email: str(b.email, 160),
      phone: str(b.phone, 60),
      taxId: str(b.taxId, 60),
      address: {
        line1: str(address.line1, 200),
        city: str(address.city, 100),
        state: str(address.state, 60),
        zip: str(address.zip, 20),
        country: str(address.country, 100),
      },
    },

    items,
    // Normalised here, not in the UI — the API must not depend on the client
    // sending a canonical currency code.
    currency: (str(body.currency, 8) || settings.currency || 'USD').toUpperCase(),
    taxLabel: str(body.taxLabel, 60) || settings.taxLabel || 'Tax',
    taxRate,
    discount,
    subtotal,
    taxAmount,
    total,

    notes: str(body.notes, 4000),
    paymentTerms: str(body.paymentTerms, 2000),
    bankDetails: str(body.bankDetails, 2000),
    poNumber: str(body.poNumber, 80),

    paidAt: str(body.paidAt, 30),
    archived: Boolean(body.archived),

    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

admin.get('/invoices', (req, res) => {
  res.json({
    invoices: arr(db.read().invoices),
    settings: db.read().invoiceSettings || {},
  });
});

admin.get('/invoices/:id', (req, res) => {
  const doc = db.read();
  const invoice = arr(doc.invoices).find((i) => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  // The printable view needs the issuer's details alongside the invoice.
  res.json({ invoice, company: doc.settings, settings: doc.invoiceSettings || {} });
});

admin.post('/invoices', async (req, res) => {
  if (!str(req.body.client?.name) && !str(req.body.client?.company)) {
    return res.status(400).json({ error: 'A client name or company is required.' });
  }

  const existingNumbers = new Set(arr(db.read().invoices).map((i) => i.number));
  const manual = str(req.body.number, 60);
  if (manual && existingNumbers.has(manual)) {
    return res.status(409).json({ error: `Invoice number ${manual} is already used.` });
  }

  let created;
  await db.update((doc) => {
    doc.invoices = arr(doc.invoices);
    doc.invoiceSettings = doc.invoiceSettings || {};

    // Auto-numbering only advances the counter when it is actually used, so a
    // manually numbered invoice never burns a sequence number.
    const number = manual || buildInvoiceNumber(doc.invoiceSettings);
    if (!manual) doc.invoiceSettings.nextNumber = (Number(doc.invoiceSettings.nextNumber) || 1) + 1;

    created = normaliseInvoice({ ...req.body, number }, doc, null);
    created.number = number;
    doc.invoices.unshift(created);
    return doc;
  });

  res.status(201).json({ invoice: created });
});

admin.put('/invoices/:id', async (req, res) => {
  const existing = arr(db.read().invoices).find((i) => i.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found.' });

  let updated;
  await db.update((doc) => {
    updated = normaliseInvoice(req.body, doc, existing);
    doc.invoices = arr(doc.invoices).map((i) => (i.id === existing.id ? updated : i));
    return doc;
  });
  res.json({ invoice: updated });
});

/** Status / archive toggles, without resending the whole document. */
admin.patch('/invoices/:id', async (req, res) => {
  let found = false;
  await db.update((doc) => {
    doc.invoices = arr(doc.invoices).map((invoice) => {
      if (invoice.id !== req.params.id) return invoice;
      found = true;
      const status = INVOICE_STATUSES.includes(req.body.status) ? req.body.status : invoice.status;
      return {
        ...invoice,
        status,
        // Stamp the payment date the first time it is marked paid; clear it if reopened.
        paidAt: status === 'paid' ? (invoice.paidAt || new Date().toISOString()) : '',
        archived: 'archived' in req.body ? Boolean(req.body.archived) : invoice.archived,
        updatedAt: new Date().toISOString(),
      };
    });
    return doc;
  });
  if (!found) return res.status(404).json({ error: 'Invoice not found.' });
  res.json({ ok: true });
});

admin.delete('/invoices/:id', async (req, res) => {
  const before = arr(db.read().invoices).length;
  await db.update((doc) => {
    doc.invoices = arr(doc.invoices).filter((i) => i.id !== req.params.id);
    return doc;
  });
  if (arr(db.read().invoices).length === before) return res.status(404).json({ error: 'Invoice not found.' });
  res.json({ ok: true });
});

admin.put('/invoice-settings', async (req, res) => {
  let settings;
  await db.update((doc) => {
    const b = req.body || {};
    settings = {
      ...doc.invoiceSettings,
      prefix: str(b.prefix, 20) || 'INV',
      format: str(b.format, 60) || '{prefix}-{year}-{seq}',
      nextNumber: Math.max(1, Math.floor(Number(b.nextNumber)) || 1),
      padding: Math.min(8, Math.max(1, Math.floor(Number(b.padding)) || 4)),
      currency: (str(b.currency, 8) || 'USD').toUpperCase(),
      taxRate: money(b.taxRate),
      taxLabel: str(b.taxLabel, 60) || 'Tax',
      paymentTerms: str(b.paymentTerms, 2000),
      bankDetails: str(b.bankDetails, 2000),
      footerNote: str(b.footerNote, 500),
      logo: str(b.logo, 300),
    };
    doc.invoiceSettings = settings;
    return doc;
  });
  res.json({ settings });
});

/* ---- Inquiries ---- */

admin.get('/inquiries', (req, res) => {
  res.json({ inquiries: arr(db.read().inquiries) });
});

admin.patch('/inquiries/:id', async (req, res) => {
  let found = false;
  await db.update((doc) => {
    doc.inquiries = arr(doc.inquiries).map((i) => {
      if (i.id !== req.params.id) return i;
      found = true;
      return {
        ...i,
        read: 'read' in req.body ? Boolean(req.body.read) : i.read,
        archived: 'archived' in req.body ? Boolean(req.body.archived) : i.archived,
      };
    });
    return doc;
  });
  if (!found) return res.status(404).json({ error: 'Inquiry not found.' });
  res.json({ ok: true });
});

admin.delete('/inquiries/:id', async (req, res) => {
  await db.update((doc) => {
    doc.inquiries = arr(doc.inquiries).filter((i) => i.id !== req.params.id);
    return doc;
  });
  res.json({ ok: true });
});

/* ---- Uploads ---- */

admin.post('/upload', upload.array('files', 12), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ urls });
});

app.use('/api/admin', admin);

/* ================================================================== *
 * STATIC + PRETTY URLS
 * ================================================================== */

// Gate admin *pages*. The login screen and the panel's own static assets stay
// open — they contain no data, and the login page needs its stylesheet.
const ADMIN_OPEN = /^\/(login(\.html)?$|css\/|js\/)/;
app.use('/admin', (req, res, next) => {
  if (ADMIN_OPEN.test(req.path)) return next();
  return auth.requireAuth(req, res, next);
});

// Uploaded assets first: their filenames are content-unique, so they can be
// cached far longer than the pages that reference them.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res) {
    // Everything the app ships revalidates on every request.
    //
    // Filenames are not content-hashed, so any positive max-age lets two files
    // from the same deploy be served at different versions — a page can load a
    // fresh script alongside a cached one it depends on, and break with a
    // "not a function" error until someone hard-refreshes. Correctness beats
    // the saving: these files are small, and ETags make revalidation a ~200
    // byte 304 rather than a re-download.
    //
    // Uploaded assets are the exception and are handled above: their filenames
    // are server-generated and unique, so they are genuinely immutable.
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// /app/:slug is rendered client-side by app.html
app.get('/app/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Multer and other thrown errors land here.
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: err.message || 'Server error' });
  res.status(status).send('Server error');
});

app.listen(PORT, () => {
  console.log(`Koydam server → http://localhost:${PORT}`);
  console.log(`Admin panel    → http://localhost:${PORT}/admin/`);
  console.log(envLoader.describe(ENV_SOURCES));
  auth.warnIfMisconfigured();
});
