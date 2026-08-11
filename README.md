# Koydam LLC — website + admin panel

Public marketing site, portfolio, and a full content-management panel for
**Koydam LLC** (US-registered software studio: mobile, web, custom software).

---

## 1. Architecture

```
Browser ──► Express (Node 20)
              ├── static  public/            Bootstrap 5 + Lucide, no build step
              ├── GET     /api/*             public read API (published content only)
              ├── POST    /api/contact       inquiry capture + optional SMTP notify
              └── /api/admin/*               auth-gated CRUD  ──► server/data/content.json
```

**Why this stack.** The site is content-heavy but low-traffic-write: one owner
editing a handful of records. A JSON document behind a small Express API gives
full CRUD, atomic writes, and zero infrastructure — no database server, no build
pipeline, no framework upgrade treadmill. The front-end is plain HTML so pages
render instantly and are trivially portable to any host.

| Layer | Choice | Notes |
| --- | --- | --- |
| Server | Node 20 + Express 4 | Single process, ~600 LOC |
| Data | JSON document (`server/data/content.json`) | Atomic temp-file writes, in-memory cache |
| Auth | Signed httpOnly cookie (HMAC-SHA256) + scrypt password | Stateless; no session store |
| Uploads | Multer → `public/uploads/` | MIME allowlist, 8 MB cap, server-generated filenames |
| CSS | Bootstrap 5.3 + `public/css/koydam.css` | Tokens + overrides, ~600 lines |
| Icons | Lucide 0.544 (UMD via CDN) | `<i data-lucide="name">` → inline SVG |
| Email | Nodemailer (optional) | Inquiries persist regardless of SMTP |

**When to graduate.** Swap `server/lib/db.js` for SQLite/Postgres (same
`read/write/update` surface) once there is more than one editor or content
approaching thousands of records. Move uploads to S3/R2 at the same time.
If SEO on app detail pages becomes critical, the same API drops straight into a
Next.js front-end — the data contract does not change.

---

## 2. Project layout

```
koydam-agency/
├── server/
│   ├── server.js                 routes, rate limiting, uploads, static
│   ├── lib/db.js                 JSON store (atomic writes, slug helpers)
│   ├── lib/auth.js               cookie sessions, scrypt, requireAuth
│   ├── lib/env.js                dependency-free .env loader
│   ├── scripts/hash-password.js  generates ADMIN_PASSWORD_HASH
│   └── data/content.seed.json    seed copied to content.json on first run
│
├── public/                       ── public site ──
│   ├── index.html                landing page (reference layout)
│   ├── apps.html                 portfolio grid + platform filter + search
│   ├── app.html                  detail template, served for /app/:slug
│   ├── contact.html
│   ├── privacy.html · terms.html legal pages, body from the admin panel
│   ├── 404.html
│   ├── logo/                     brand assets (see "Logo usage" below)
│   ├── css/koydam.css            design system
│   └── js/
│       ├── koydam.js             runtime: hydration, app cards, forms, reveal
│       ├── home.js · apps.js · app-detail.js · legal.js
│
│   Header, footer and the login modal are duplicated verbatim in every page
│   rather than injected by script — see "Why the chrome is duplicated" below.
│
└── public/admin/                 ── admin panel ──
    ├── login.html
    ├── index.html                dashboard shell + all views
    ├── css/admin.css
    └── js/admin.js               hash router + CRUD
```

---

## 3. Running it

```bash
npm install
cp .env.example .env                     # then edit
node server/scripts/hash-password.js "your password"   # → ADMIN_PASSWORD_HASH
npm start
```

* Site — <http://localhost:3000>
* Admin — <http://localhost:3000/admin/> (or the header "Client portal" button)

`server/data/content.json` is created from the seed on first boot and is
gitignored — it is your live content. Back it up; it *is* the site.

### Environment

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs admin cookies. Rotating it logs everyone out. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | Login. `ADMIN_PASSWORD` is a dev-only fallback. |
| `SESSION_HOURS` | Session lifetime (default 12). |
| `SMTP_*`, `MAIL_TO`, `MAIL_FROM` | Contact-form notifications. Leave `SMTP_HOST` empty to skip email. |

---

## 4. Content model

```jsonc
{
  "settings": { "companyName", "email", "supportEmail", "phone",
                "address": { "line1","city","state","zip","country" },
                "socials":  { "x","linkedin","github","instagram" },
                "copyright": "© {year} Koydam LLC…" },

  "home":     { "heroTitle","heroSubtitle","stats":[…],"aboutTitle","aboutBody","aboutPoints":[…] },
  "services": [ { "id","icon","title","summary","bullets":[…] } ],
  "process":  [ { "step","title","body" } ],

  "apps": [ {
    "id","slug","title","tagline",
    "description",                       // HTML, admin-authored
    "features": [],
    "icon", "screenshots": [],
    "platforms": ["ios","android","web","saas"],
    "category","version","releaseDate",
    "appStoreUrl","playStoreUrl","webUrl",
    "status": "published|draft|archived",
    "featured": true, "order": 1
  } ],

  "pages":     { "privacy": { "title","updatedAt","body" }, "terms": { … } },
  "inquiries": [ { "id","name","email","company","subject","message","createdAt","read","archived" } ],

  "invoiceSettings": { "prefix","format","nextNumber","padding","currency",
                       "taxRate","taxLabel","paymentTerms","bankDetails","footerNote","logo" },

  "invoices": [ {
    "id","number",                        // number is immutable once issued
    "status": "draft|sent|paid|overdue|cancelled",
    "issueDate","dueDate","poNumber",
    "client": { "name","company","email","phone","taxId",
                "address": { "line1","city","state","zip","country" } },
    "items": [ { "description","quantity","unitPrice","amount" } ],
    "currency","taxLabel","taxRate","discount",
    "subtotal","taxAmount","total",       // stored, not recomputed on read
    "notes","paymentTerms","bankDetails",
    "paidAt","archived","createdAt","updatedAt"
  } ]
}
```

Only `status: "published"` apps ever leave the server on a public route —
filtering happens in `publicView()`, not in the browser.

---

## 5. API

### Public
| Method | Route | Returns |
| --- | --- | --- |
| GET | `/api/content` | settings, home, services, process, pages, published apps |
| GET | `/api/apps?platform=&q=` | filtered published apps |
| GET | `/api/apps/:slug` | one published app |
| POST | `/api/contact` | `{ok:true}`; 400 with `errors{}`, 429 when rate-limited |

### Admin (session cookie required)
| Method | Route |
| --- | --- |
| POST | `/api/admin/login`, `/api/admin/logout` |
| GET | `/api/admin/me`, `/api/admin/content` |
| POST / PUT / DELETE | `/api/admin/apps`, `/api/admin/apps/:id` |
| PUT | `/api/admin/apps-order`, `/api/admin/pages/:key`, `/api/admin/home`, `/api/admin/services`, `/api/admin/settings` |
| GET / PATCH / DELETE | `/api/admin/inquiries[/:id]` |
| GET | `/api/admin/invoices` (list + settings), `/api/admin/invoices/:id` (invoice + issuer details) |
| POST / PUT / PATCH / DELETE | `/api/admin/invoices[/:id]` — PATCH is for status/archive only |
| PUT | `/api/admin/invoice-settings` |
| POST | `/api/admin/upload` (multipart `files`) |

---

## 6. Design system

Tokens live at the top of `public/css/koydam.css`; nothing else hardcodes a
colour. The palette is deliberately narrow — slate surfaces, near-black ink,
one indigo accent.

| Token | Value | Used for |
| --- | --- | --- |
| `--kd-bg` / `--kd-surface` | `#ffffff` / `#f8fafc` | page, alternating bands |
| `--kd-ink` / `--kd-ink-2` | `#0b1220` / `#334155` | headings / body |
| `--kd-muted` / `--kd-faint` | `#64748b` / `#94a3b8` | secondary / tertiary |
| `--kd-line` / `--kd-line-strong` | `#e6eaf0` / `#cfd6e0` | hairlines, inputs |
| `--kd-accent` | `#4f46e5` | eyebrows, focus rings, one CTA per view |

Conventions worth keeping when extending:

* **One motion curve.** `--kd-ease` + `--kd-fast`/`--kd-slow`, nothing else.
* **Borders over shadows.** Shadow only on hover/lift; structure is drawn with 1px lines.
* **Primary CTA is ink, not accent.** Accent is reserved so it stays meaningful.
* **Fluid headings.** `.kd-display` / `.kd-h2` / `.kd-h3` use `clamp()` — no heading media queries.
* **Reduced motion is honoured** globally at the bottom of the stylesheet.

Icons: `<i data-lucide="name"></i>`, then `lucide.createIcons()` (already called
after every dynamic render via `KD.icons()`).

## Legal documents

The Privacy Policy and Terms of Service are written to satisfy **App Store and
Google Play submission requirements**, and cover AdMob advertising, in-app
purchases and subscriptions, and API/developer terms, alongside GDPR/UK, CCPA-CPRA,
and COPPA obligations.

```
server/data/legal/privacy.html   source document (reviewable, diffable)
server/data/legal/terms.html
server/scripts/load-legal.js     loads them into content.json + the seed
docs/app-store-privacy-checklist.md   the store forms these must match
```

Edit the HTML source, then `node server/scripts/load-legal.js` (`--dry` to preview,
`--seed` for seed only). After loading, Admin → Pages & legal can edit them
further — but the admin copy then diverges from the file, so treat the files as the
source of truth and re-load rather than editing in both places.

> **These are drafts, not legal advice.** They describe the SDK stack we normally
> ship. Confirm every claim against the app you are actually submitting — an
> inaccurate policy is worse than a thin one — and have counsel review before
> launch. Section 0 of the checklist lists the decisions to verify.

The published policy and the store's structured privacy form (Apple's App Privacy
label, Google's Data safety section) must agree. `docs/app-store-privacy-checklist.md`
maps the policy onto both forms, and covers ATT, the UMP consent SDK, Play's Ads ID
permission and account-deletion requirement, and Apple's paywall rules.

## Invoicing

Admin → **Invoices**. Create an invoice, print it, and keep it in the archive.

**Numbering.** Format and counter live in Admin → Company settings → Invoicing
defaults (`{prefix}-{year}-{seq}` → `KOY-2026-0001`). The counter advances only
when it is actually used, so typing a manual number does not burn a sequence
number. Duplicate numbers are rejected with a 409, and **a number cannot be
changed once the invoice exists** — the field is read-only on edit.

**Money.** Totals are computed *and stored* on the invoice at save time, never
recomputed on read: a historical invoice keeps the figures it was issued with,
even after you change the tax rate or currency. The editor previews the same
arithmetic live, but the server's numbers are authoritative. Everything rounds to
cents at each step (line amount → subtotal → tax → total), matching what prints.

Defaults from settings (currency, tax rate and label, terms, bank details) are
*proposed* by the editor for a new invoice, not applied by the API. An invoice
created through the API with no `taxRate` gets zero tax — it never silently
acquires tax nobody saw.

**Statuses** are draft / sent / paid / overdue / cancelled. Marking one paid
stamps `paidAt`; reopening clears it. "Overdue" is derived, not stored — any
unpaid invoice past its due date counts, and the sidebar badge shows that number.
Draft and cancelled invoices print with a diagonal watermark so a printout can
never be mistaken for a final document.

**Archive.** Archiving hides an invoice from the active list but keeps the record
and its number; it stays viewable and printable forever. Deleting is permanent —
the confirmation says so and points at archiving instead.

**PDF.** `/admin/invoice.html?id=…` renders the invoice as an A4 document (logo,
both addresses, line items, totals, terms, payment details) with a print
stylesheet; "Print / Save as PDF" is the browser's own print-to-PDF, so the
preview *is* the output and there is no PDF library to maintain. If you later
need PDFs generated server-side — emailing them automatically, say — add
`pdfkit` and a `GET /api/admin/invoices/:id/pdf` route; the stored invoice
already holds every value that page prints.

The whole invoice archive lives behind the admin session — `publicView()` never
exposes `invoices`, and the print page is gated like every other admin page.

### Why the chrome is duplicated

The header, footer and login modal are copy-pasted into all seven pages. That is
deliberate. They were briefly injected by a shared `partials.js`, which meant one
cached script could keep every page rendering an old header — the logo was
missing until a hard refresh. Markup in the HTML cannot go stale relative to the
page that contains it, and it paints before any script runs (no flash of missing
header).

**When you edit the header or footer, edit all seven pages.** `index.html` is the
reference copy; the others should match it byte for byte. A three-line script or
a find-and-replace across `public/*.html` handles it. If the chrome starts
changing often, that is the signal to add a real template step (Eleventy, or any
static generator) rather than to reintroduce runtime injection.

Caching backs this up: pages and, in development, all assets are served
`no-cache` (revalidate every load, cheap 304s via ETag); in production, CSS/JS
get `max-age=300, must-revalidate` and uploaded images `30d, immutable`.

### Logo usage

All four source files are transparent PNGs with near-black artwork, so they sit
directly on the light surfaces — no tile or container behind them.

| File | Size | Where it's used |
| --- | --- | --- |
| `logo/logo.png` | 216×243, tight crop | `.kd-brand-mark` — site header, footer, admin sidebar (26px tall) |
| `logo/logoText.png` | 486×349, tight crop | `.kd-lockup` — admin login, 404 (64px tall) |
| `logo/koydam.png` | 512×512, padded | browser favicon (`rel="icon"`), PWA manifest |
| `logo/koydamText.png` | 512×512, padded | source for the social image |
| `logo/app-icon.png` | 512×512, **opaque** | `apple-touch-icon`, maskable PWA icon |
| `logo/og-image.png` | 1200×630, opaque | `og:image` / `twitter:image` |

The last two are generated, not hand-made: iOS flattens a transparent touch icon
onto **black**, which would erase near-black artwork, and social platforms expect
an opaque 1.91:1 card. Both were composited over white from the source files. If
the logo ever changes, regenerate them — any image tool will do, the only
requirements are *opaque background* and *those dimensions*.

Sized by height (`width: auto`) so the tight crops keep their own aspect ratio —
don't set both dimensions in CSS.

---

## 7. Security notes

* Admin HTML fields (app description, legal bodies) are rendered **unsanitised**
  by design — they are authored by the site owner. If you ever add a second,
  less-trusted editor, sanitise on write in `normaliseApp()` / `PUT /pages/:key`.
* Contact input is escaped everywhere it is displayed (`textContent` in the
  admin panel, escaped HTML in the notification email).
* Upload filenames are generated server-side; extensions come from the MIME
  allowlist, never from the client.
* Rate limits: 5 contact posts / 15 min and 8 login attempts / 10 min per IP.
  These are in-process — put a shared limiter in front if you run more than one instance.
* Set `NODE_ENV=production` in deployment so the session cookie gets `Secure`
  and HSTS is sent. Terminate TLS at the proxy.

---

## 8. Deployment sketch

1. Reverse proxy (Caddy/nginx) terminates TLS → `localhost:3000`.
2. `NODE_ENV=production`, real `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` set.
3. Run under a process supervisor (`systemd`, PM2, or a container).
4. Back up `server/data/content.json` and `public/uploads/` — that is the whole site state.
