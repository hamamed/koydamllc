# Deploying to Hostinger

> **This is a Node.js application, not a static site.** The admin panel, contact
> form, and invoicing all run through an Express server. It will **not** work on a
> plain static/PHP shared plan — you need a Hostinger plan with Node.js support
> (VPS, or a Business/Cloud plan with the Node.js app selector in hPanel).
>
> If you only have static hosting, the public pages would render but every page
> would show fallback content, and `/admin` would not exist at all.

---

## 1. What has to survive a redeploy

Two things are **deliberately not in git**, because they are your live data:

| Path | What it is | If you lose it |
| --- | --- | --- |
| `server/data/content.json` | Every app, page, setting, inquiry, and invoice | The site reverts to the seed; all invoices gone |
| `public/uploads/` | Uploaded icons and screenshots | Broken images across the site |
| `.env` | Session secret + admin password hash | Nobody can log in |

On first boot, `content.json` is created automatically from
`server/data/content.seed.json`. On every deploy after that, **do not delete it** —
a `git pull` won't touch it, but a "wipe and re-upload" will.

**Back these up before each deploy.**

---

## 2. First deployment

### 2a. VPS (recommended — full control)

```bash
ssh root@your-server
cd /var/www
git clone https://github.com/hamamed/koydamllc.git koydam
cd koydam
npm ci --omit=dev

cp .env.example .env
nano .env                       # see section 3
node server/scripts/hash-password.js "your admin password"   # paste into .env

npm install -g pm2
pm2 start server/server.js --name koydam
pm2 save && pm2 startup
```

Then put nginx or Caddy in front of it to terminate TLS and proxy to
`localhost:3000`. Minimal nginx server block:

```nginx
server {
    server_name koydam.com www.koydam.com;
    client_max_body_size 10M;          # uploads are capped at 8 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-*` matters: the server runs with `trust proxy` enabled, and the rate
limiters key on client IP. Without those headers every visitor looks like one IP
and the contact-form limit would lock everyone out together.

Add HTTPS with `certbot --nginx` (or let Caddy do it automatically).

### 2b. hPanel Node.js app (shared Business/Cloud plan)

1. hPanel → **Advanced → Node.js** → Create application.
2. **Application root:** the folder you deploy into. **Startup file:** `server/server.js`.
   **Node version:** 20 or newer.
3. Deploy the code — either hPanel's Git integration pointed at the repo, or upload
   over SFTP (excluding `node_modules`).
4. Run **npm install** from the Node.js panel.
5. Add the environment variables from section 3 in the panel's variables section.
6. Start the app. Hostinger assigns the port and proxies to it — the server already
   reads `process.env.PORT`, so nothing needs changing.

---

## 3. Environment variables

```ini
NODE_ENV=production
SESSION_SECRET=<64 random hex chars>
ADMIN_EMAIL=hello@koydam.com
ADMIN_PASSWORD_HASH=<output of server/scripts/hash-password.js>
SESSION_HOURS=12

# Optional — contact form + invoice notifications
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=hello@koydam.com
SMTP_PASS=<mailbox password>
MAIL_TO=hello@koydam.com
MAIL_FROM="Koydam Website <hello@koydam.com>"
```

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**`NODE_ENV=production` is not optional.** It is what makes the admin session
cookie `Secure` and enables HSTS. Leave it unset and the login cookie can travel
over plain HTTP.

**Do not commit `.env`.** It is gitignored; keep it only on the server.

---

## 4. Updating after the first deploy

```bash
cd /var/www/koydam
git pull
npm ci --omit=dev        # only if package.json changed
pm2 restart koydam
```

`content.json` and `public/uploads/` are untouched by `git pull`, so your content
and invoices survive. The server caches content in memory, so a restart is needed
for any change made directly to `content.json` on disk (changes made through the
admin panel apply immediately, no restart needed).

---

## 5. Post-deploy checks

```bash
curl -I  https://koydam.com/                    # 200
curl -s  https://koydam.com/api/content | head  # JSON, not an error
curl -I  https://koydam.com/admin/              # 302 → /admin/login.html
curl -I  https://koydam.com/privacy.html        # 200
```

Then in a browser: log in at `/admin/`, confirm the apps list loads, send a test
message through the contact form and check it appears under Inquiries, and open an
invoice's print view.

Also confirm the login cookie is marked `Secure` in DevTools → Application →
Cookies. If it isn't, `NODE_ENV` didn't reach the process.

---

## 6. Known gaps to close before real traffic

- **Backups.** `content.json` is a single file with no history — see the backup
  suggestion in the README. At minimum, add a cron job:
  `0 3 * * * cp /var/www/koydam/server/data/content.json /var/backups/koydam-$(date +\%F).json`
- **`sitemap.xml`** is referenced by `robots.txt` but does not exist yet; it 404s.
- **Rate limiting is per-process.** Fine on one instance; if you ever run several,
  move it to a shared store.
- **Uploads are served from disk.** If you later move to multiple instances or
  ephemeral containers, move them to object storage first.
