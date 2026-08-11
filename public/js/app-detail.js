/* ==========================================================================
   app-detail.js — renders /app/:slug.
   The slug comes from the path (the server rewrites /app/* to app.html).
   ========================================================================== */

(async () => {
  'use strict';
  const { $, api, esc, safeUrl, icons, appIcon, platformTags, appCard, initReveal, PLATFORM_META } = KD;

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
  $('#kdAppPlatforms').innerHTML = platformTags(app);

  /* ---- Store / web links -------------------------------------------- */
  const links = [
    { url: app.appStoreUrl,  icon: 'apple',        small: 'Download on the', strong: 'App Store' },
    { url: app.playStoreUrl, icon: 'play',         small: 'Get it on',       strong: 'Google Play' },
    { url: app.webUrl,       icon: 'external-link', small: 'Open the',       strong: 'Web app' },
  ].filter((link) => safeUrl(link.url));

  $('#kdAppLinks').innerHTML = links.length
    ? links.map((link) => `
        <a class="kd-store" href="${esc(safeUrl(link.url))}" target="_blank" rel="noopener">
          <i data-lucide="${link.icon}"></i>
          <span><small>${link.small}</small><strong>${link.strong}</strong></span>
        </a>`).join('')
    : `<span class="kd-tag kd-tag-warn"><i data-lucide="clock"></i> Links coming soon</span>`;

  /* ---- Metadata list ------------------------------------------------ */
  const meta = [
    ['Category', app.category],
    ['Version', app.version],
    ['Released', app.releaseDate ? new Date(`${app.releaseDate}T00:00:00`).toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric' }) : ''],
    ['Platforms', (app.platforms || []).map((p) => PLATFORM_META[p]?.label).filter(Boolean).join(', ')],
    ['Studio', 'Koydam LLC'],
  ].filter(([, value]) => value);

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
