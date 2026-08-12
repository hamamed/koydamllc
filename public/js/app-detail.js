/* ==========================================================================
   app-detail.js — renders /app/:slug.
   The slug comes from the path (the server rewrites /app/* to app.html).
   ========================================================================== */

(async () => {
  'use strict';
  const { $, api, esc, safeUrl, icons, appIcon, platformTags, appCard, initReveal, PLATFORM_META } = KD;

  /* Launch-state helpers.
   *
   * These arrived in koydam.js later than this file's first use of them, and
   * the two scripts are cached independently by browsers and by any CDN in
   * front of the site. A visitor holding an older koydam.js would otherwise hit
   * "launchBadge is not a function" and get a blank page. Falling back to a
   * local copy keeps the page working; it converges on the shared version as
   * soon as the cache catches up. */
  const LAUNCH_META = KD.LAUNCH_META || {
    'coming-soon':    { label: 'Coming soon',    icon: 'clock',         cls: 'kd-tag-accent' },
    'in-development': { label: 'In development', icon: 'hammer',        cls: 'kd-tag-warn' },
    beta:             { label: 'Beta',           icon: 'flask-conical', cls: 'kd-tag-accent' },
  };

  const launchBadge = KD.launchBadge || ((app) => {
    const meta = LAUNCH_META[app.launchStatus];
    if (!meta) return '';
    const when = app.expectedLaunch ? ` · ${esc(app.expectedLaunch)}` : '';
    return `<span class="kd-tag ${meta.cls}"><i data-lucide="${meta.icon}"></i>${esc(meta.label)}${when}</span>`;
  });

  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

  const show = (id) => $(id).classList.remove('d-none');
  const hide = (id) => $(id).classList.add('d-none');

  let app;
  try {
    app = (await api(`/api/apps/${encodeURIComponent(slug)}`)).app;
  } catch {
    hide('#kdLoading');
    show('#kdNotFound');
    icons();
    return;
  }

  /* ---- Document metadata ------------------------------------------- */
  document.title = `${app.title} — Koydam LLC`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', app.tagline || '');

  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.title,
    description: app.tagline,
    applicationCategory: app.category,
    softwareVersion: app.version,
    datePublished: app.releaseDate,
    operatingSystem: (app.platforms || []).map((p) => PLATFORM_META[p]?.label).filter(Boolean).join(', '),
    publisher: { '@type': 'Organization', name: 'Koydam LLC' },
  });
  document.head.appendChild(ld);

  /* ---- Header ------------------------------------------------------- */
  $('#kdAppCrumb').textContent = app.title;
  $('#kdAppTitle').textContent = app.title;
  $('#kdAppTagline').textContent = app.tagline || '';
  $('#kdAppIcon').innerHTML = appIcon(app, 72);
  $('#kdAppPlatforms').innerHTML = launchBadge(app) + platformTags(app);

  /* ---- Store / web links --------------------------------------------
   * Live links first. For a store the app is headed to but has not reached
   * yet, show a disabled "Coming soon" tile rather than hiding it — the
   * point of listing an unreleased app is to say where it is going.
   * ------------------------------------------------------------------ */
  const STORES = [
    { key: 'appStoreUrl',  platform: 'ios',     icon: 'apple',         small: 'Download on the', strong: 'App Store' },
    { key: 'playStoreUrl', platform: 'android', icon: 'play',          small: 'Get it on',       strong: 'Google Play' },
    { key: 'webUrl',       platform: 'web',     icon: 'external-link', small: 'Open the',        strong: 'Web app' },
  ];

  const platforms = app.platforms || [];
  const isLive = !LAUNCH_META[app.launchStatus];

  const tiles = STORES.map((store) => {
    const url = safeUrl(app[store.key]);
    if (url) {
      return `<a class="kd-store" href="${esc(url)}" target="_blank" rel="noopener">
          <i data-lucide="${store.icon}"></i>
          <span><small>${store.small}</small><strong>${store.strong}</strong></span>
        </a>`;
    }
    // No link yet: only advertise stores this app is actually targeting.
    if (isLive || !platforms.includes(store.platform)) return '';
    return `<span class="kd-store is-pending" aria-disabled="true">
        <i data-lucide="${store.icon}"></i>
        <span><small>Coming soon to</small><strong>${store.strong}</strong></span>
      </span>`;
  }).filter(Boolean);

  $('#kdAppLinks').innerHTML = tiles.length
    ? tiles.join('')
    : `<span class="kd-tag kd-tag-warn"><i data-lucide="clock"></i> Links coming soon</span>`;

  // A prominent note when the product itself has not shipped.
  if (!isLive) {
    const meta = LAUNCH_META[app.launchStatus];
    const when = app.expectedLaunch
      ? `Expected ${esc(app.expectedLaunch)}.`
      : 'We will announce the release date shortly.';
    $('#kdAppLinks').insertAdjacentHTML('beforebegin', `
      <div class="kd-card p-3 mb-3 d-flex align-items-start gap-3" style="background:var(--kd-accent-soft);border-color:rgba(79,70,229,.16)">
        <i data-lucide="${meta.icon}" style="color:var(--kd-accent);margin-top:.15em"></i>
        <div>
          <strong class="kd-ink d-block">${esc(meta.label)}</strong>
          <span class="small kd-muted">${when}
            <a href="/contact.html">Get in touch</a> to hear when it launches.</span>
        </div>
      </div>`);
  }

  /* ---- Metadata list ------------------------------------------------ */
  const meta = [
    ['Category', app.category],
    !isLive ? ['Status', LAUNCH_META[app.launchStatus].label] : null,
    !isLive && app.expectedLaunch ? ['Expected', app.expectedLaunch] : null,
    ['Version', app.version],
    ['Released', app.releaseDate ? new Date(`${app.releaseDate}T00:00:00`).toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric' }) : ''],
    ['Platforms', (app.platforms || []).map((p) => PLATFORM_META[p]?.label).filter(Boolean).join(', ')],
    ['Studio', 'Koydam LLC'],
  ].filter(Boolean).filter(([, value]) => value);

  $('#kdAppMeta').innerHTML = meta.map(([label, value]) => `
    <div class="kd-meta-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');

  /* ---- Screenshots --------------------------------------------------- */
  const shots = (app.screenshots || []).map(safeUrl).filter(Boolean);
  if (shots.length) {
    $('#kdAppShots').innerHTML = shots.map((src, i) => `
      <figure class="kd-shot m-0" data-shot="${esc(src)}" tabindex="0" role="button"
              aria-label="Open screenshot ${i + 1}">
        <img src="${esc(src)}" alt="${esc(app.title)} screenshot ${i + 1}" loading="lazy">
      </figure>`).join('');
    show('#kdAppShotsSection');

    // Lightbox
    const modalEl = $('#kdShotModal');
    const modalImg = $('#kdShotModalImg');
    const openShot = (el) => {
      modalImg.src = el.dataset.shot;
      modalImg.alt = el.querySelector('img')?.alt || '';
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    };
    $('#kdAppShots').addEventListener('click', (e) => {
      const fig = e.target.closest('[data-shot]');
      if (fig) openShot(fig);
    });
    $('#kdAppShots').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const fig = e.target.closest('[data-shot]');
      if (fig) { e.preventDefault(); openShot(fig); }
    });
  }

  /* ---- Description + features ---------------------------------------- */
  // Trusted HTML: authored by the site owner in the admin panel.
  $('#kdAppDescription').innerHTML = app.description || `<p>${esc(app.tagline || '')}</p>`;

  if ((app.features || []).length) {
    $('#kdAppFeatures').innerHTML = app.features
      .map((feature) => `<li><i data-lucide="check"></i>${esc(feature)}</li>`).join('');
    show('#kdAppFeaturesCard');
  }

  /* ---- Related ------------------------------------------------------- */
  try {
    const others = (await api('/api/apps')).apps.filter((a) => a.slug !== app.slug).slice(0, 3);
    $('#kdAppRelated').innerHTML = others.length
      ? others.map(appCard).join('')
      : '<p class="kd-muted mb-0">More projects are on the way.</p>';
  } catch { /* related is non-critical */ }

  hide('#kdLoading');
  show('#kdApp');
  icons();
  initReveal();
})();
