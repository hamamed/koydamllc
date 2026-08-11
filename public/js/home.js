/* ==========================================================================
   home.js — renders the data-driven blocks on the landing page.
   Every block degrades to the static markup already in index.html if the
   content API is unavailable.
   ========================================================================== */

(async () => {
  'use strict';
  const { $, esc, safeUrl, icons, content, appCard, initReveal } = KD;

  let doc;
  try {
    doc = await content();
  } catch {
    return; // static fallbacks stay on screen
  }

  /* ---- Stats ------------------------------------------------------- */
  const stats = doc.home?.stats || [];
  const statsHost = $('#kdStats');
  if (statsHost && stats.length) {
    statsHost.innerHTML = stats.map((stat, i) => `
      <div class="col-6 col-md-3 py-4 ${i < stats.length - 1 ? 'border-end' : ''}">
        <div class="kd-stat-value">${esc(stat.value)}</div>
        <div class="kd-stat-label">${esc(stat.label)}</div>
      </div>`).join('');
  }

  /* ---- Hero copy (editable in the admin panel) --------------------- */
  const heroTitle = $('.kd-display');
  if (heroTitle && doc.home?.heroTitle) heroTitle.textContent = doc.home.heroTitle;
  const heroSub = $('.kd-lead');
  if (heroSub && doc.home?.heroSubtitle) heroSub.textContent = doc.home.heroSubtitle;

  /* ---- Services ---------------------------------------------------- */
  const servicesHost = $('#kdServices');
  if (servicesHost && doc.services?.length) {
    servicesHost.innerHTML = doc.services.map((service) => `
      <div class="col-12 col-md-6 col-lg-3 kd-reveal">
        <div class="kd-card kd-card-hover h-100 p-4">
          <div class="kd-service-icon mb-3"><i data-lucide="${esc(service.icon || 'square')}"></i></div>
          <h3 class="kd-h3 mb-2">${esc(service.title)}</h3>
          <p class="small kd-muted mb-3">${esc(service.summary)}</p>
          <ul class="kd-tick-list">
            ${(service.bullets || []).map((b) => `<li><i data-lucide="check"></i>${esc(b)}</li>`).join('')}
          </ul>
        </div>
      </div>`).join('');
  }

  /* ---- Featured work ----------------------------------------------- */
  const featuredHost = $('#kdFeatured');
  if (featuredHost) {
    const featured = (doc.apps || []).filter((a) => a.featured).slice(0, 3);
    const list = featured.length ? featured : (doc.apps || []).slice(0, 3);
    featuredHost.innerHTML = list.length
      ? list.map(appCard).join('')
      : `<div class="col-12"><div class="kd-card p-5 text-center kd-muted">
           <i data-lucide="package-open" style="width:28px;height:28px"></i>
           <p class="mb-0 mt-3">Portfolio coming soon.</p></div></div>`;
  }

  /* ---- Process ----------------------------------------------------- */
  const processHost = $('#kdProcess');
  if (processHost && doc.process?.length) {
    processHost.innerHTML = doc.process.map((step) => `
      <div class="col-12 col-md-6 col-lg-3 kd-reveal">
        <div class="pt-4 kd-rule-t h-100">
          <div class="kd-step-num mb-3">${esc(step.step)}</div>
          <h3 class="kd-h3 mb-2">${esc(step.title)}</h3>
          <p class="small kd-muted mb-0">${esc(step.body)}</p>
        </div>
      </div>`).join('');
  }

  /* ---- About ------------------------------------------------------- */
  if (doc.home?.aboutTitle) $('#kdAboutTitle').textContent = doc.home.aboutTitle;
  if (doc.home?.aboutBody) $('#kdAboutBody').textContent = doc.home.aboutBody;
  if (doc.home?.aboutPoints?.length) {
    $('#kdAboutPoints').innerHTML = doc.home.aboutPoints
      .map((point) => `<li><i data-lucide="check"></i>${esc(point)}</li>`).join('');
  }

  /* ---- CTA hrefs --------------------------------------------------- */
  const primary = doc.home?.ctaPrimary;
  if (primary?.href && safeUrl(primary.href)) {
    const btn = document.querySelector('.kd-grid-bg .btn-kd');
    if (btn) { btn.setAttribute('href', safeUrl(primary.href)); btn.childNodes[0].nodeValue = `${primary.label} `; }
  }

  icons();
  initReveal();
})();
