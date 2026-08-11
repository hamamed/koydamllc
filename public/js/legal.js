/* ==========================================================================
   legal.js — renders a legal page from the content API.
   The page declares which document it is via <body data-legal="privacy|terms">.
   ========================================================================== */

(async () => {
  'use strict';
  const { $, esc, content, icons } = KD;

  const key = document.body.dataset.legal;
  if (!key) return;

  try {
    const page = (await content()).pages?.[key];
    if (!page) return;

    document.title = `${page.title} — Koydam LLC`;
    $('#kdLegalTitle').textContent = page.title;

    if (page.updatedAt) {
      $('#kdLegalUpdated').textContent = `Last updated ${new Date(`${page.updatedAt}T00:00:00`)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
    }

    // Trusted HTML: authored by the site owner in the admin panel.
    $('#kdLegalBody').innerHTML = page.body || '';
  } catch (err) {
    $('#kdLegalBody').innerHTML =
      `<p class="kd-muted">This document is temporarily unavailable. Please email
       <a href="mailto:hello@koydam.com">hello@koydam.com</a> for a copy.</p>`;
    console.warn('[legal]', err.message);
  }

  icons();
})();
