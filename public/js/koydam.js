/* ==========================================================================
   koydam.js — shared front-end runtime for the public site.

   Responsibilities:
     • fetch /api/content once and cache it for the page
     • hydrate every [data-kd] slot (company email, phone, address, copyright…)
     • render app cards (shared by the home page and the apps page)
     • nav shadow-on-scroll, scroll reveal, Lucide icon boot

   Deliberately dependency-free beyond Bootstrap's bundle and Lucide.
   ========================================================================== */

const KD = (() => {
  'use strict';

  /* ---------------------------------------------------------------- utils */

  /** Escapes text before it goes anywhere near innerHTML. */
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Allows only http(s) and mailto/tel URLs into href attributes. */
  const safeUrl = (url) => {
    const value = String(url || '').trim();
    return /^(https?:|mailto:|tel:|\/)/i.test(value) ? value : '';
  };

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
    return data;
  }

  /** Re-scans the DOM for [data-lucide] placeholders. Safe to call repeatedly. */
  const icons = () => { if (window.lucide) window.lucide.createIcons(); };

  /* -------------------------------------------------------------- content */

  let contentPromise = null;
  const content = () => (contentPromise ||= api('/api/content'));

  const PLATFORM_META = {
    ios:     { label: 'iOS',     icon: 'apple' },
    android: { label: 'Android', icon: 'bot' },
    web:     { label: 'Web',     icon: 'globe' },
    saas:    { label: 'SaaS',    icon: 'cloud' },
  };

  /** Fills elements marked with data-kd="settings.email" etc. from the content doc. */
  function hydrate(doc) {
    const settings = doc.settings || {};
    const address = settings.address || {};
    const addressLine = [address.line1, address.city, address.state && `${address.state} ${address.zip || ''}`.trim(), address.country]
      .filter(Boolean).join(', ');

    const values = {
      'company.name': settings.companyName,
      'company.tagline': settings.tagline,
      'company.email': settings.email,
      'company.supportEmail': settings.supportEmail,
      'company.phone': settings.phone,
      'company.address': addressLine,
      'company.copyright': String(settings.copyright || '').replace('{year}', new Date().getFullYear()),
      'company.year': String(new Date().getFullYear()),
    };

    $$('[data-kd]').forEach((el) => {
      const value = values[el.dataset.kd];
      if (value == null || value === '') {
        if (el.dataset.kdHideEmpty !== undefined) el.closest('[data-kd-wrap]')?.remove();
        return;
      }
      el.textContent = value;
      // Mirror the value into an href when the element asks for it.
      const scheme = el.dataset.kdHref;
      if (scheme) el.setAttribute('href', scheme === 'mailto' ? `mailto:${value}`
        : scheme === 'tel' ? `tel:${value.replace(/[^\d+]/g, '')}`
        : value);
    });

    // Social links: hide the ones with no URL configured.
    $$('[data-kd-social]').forEach((el) => {
      const url = safeUrl((settings.socials || {})[el.dataset.kdSocial]);
      if (!url) return el.remove();
      el.setAttribute('href', url);
    });
  }

  /* ---------------------------------------------------------- app cards */

  /** Icon tile, falling back to the app's initial when no image is set. */
  function appIcon(app, size = 56) {
    const src = safeUrl(app.icon);
    const box = `width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.23)}px`;
    return src
      ? `<img class="kd-app-icon" style="${box}" src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy">`
      : `<div class="kd-app-icon kd-app-icon-fallback" style="${box};font-size:${(size / 48).toFixed(2)}rem">${
          esc((app.title || '?').charAt(0).toUpperCase())}</div>`;
  }

  function platformTags(app) {
    return (app.platforms || []).map((p) => {
      const meta = PLATFORM_META[p];
      if (!meta) return '';
      return `<span class="kd-tag"><i data-lucide="${meta.icon}"></i>${esc(meta.label)}</span>`;
    }).join('');
  }

  /** Full card markup for the apps grid. */
  function appCard(app) {
    const href = `/app/${encodeURIComponent(app.slug)}`;
    return `
      <article class="col-12 col-md-6 col-lg-4 kd-reveal" data-platforms="${esc((app.platforms || []).join(' '))}">
        <div class="kd-card kd-card-hover h-100 p-4 d-flex flex-column">
          <div class="d-flex align-items-start gap-3 mb-3">
            ${appIcon(app)}
            <div class="min-w-0">
              <h3 class="kd-h3 mb-1 text-truncate">${esc(app.title)}</h3>
              <p class="kd-muted small mb-0">${esc(app.category || 'Software')}</p>
            </div>
          </div>

          <p class="mb-3 small" style="color:var(--kd-ink-2)">${esc(app.tagline)}</p>

          <div class="d-flex flex-wrap gap-2 mb-4">${platformTags(app)}</div>

          <div class="mt-auto d-flex align-items-center justify-content-between pt-3 kd-rule-t">
            <a class="kd-arrow-link" href="${href}">View details <i data-lucide="arrow-right"></i></a>
            <div class="d-flex gap-2">
              ${safeUrl(app.appStoreUrl) ? `<a class="kd-social" href="${esc(safeUrl(app.appStoreUrl))}" target="_blank" rel="noopener" aria-label="${esc(app.title)} on the App Store"><i data-lucide="apple"></i></a>` : ''}
              ${safeUrl(app.playStoreUrl) ? `<a class="kd-social" href="${esc(safeUrl(app.playStoreUrl))}" target="_blank" rel="noopener" aria-label="${esc(app.title)} on Google Play"><i data-lucide="play"></i></a>` : ''}
              ${safeUrl(app.webUrl) ? `<a class="kd-social" href="${esc(safeUrl(app.webUrl))}" target="_blank" rel="noopener" aria-label="Visit ${esc(app.title)}"><i data-lucide="external-link"></i></a>` : ''}
            </div>
          </div>
        </div>
      </article>`;
  }

  /* ------------------------------------------------------------ behaviour */

  function initNav() {
    const nav = $('.kd-navbar');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mark the current page in the nav.
    const here = location.pathname.replace(/\/$/, '') || '/';
    $$('.kd-navbar .nav-link').forEach((link) => {
      const target = link.getAttribute('href') || '';
      if (target.startsWith('#')) return;
      const path = target.replace(/\.html$/, '').replace(/\/$/, '') || '/';
      if (path !== '/' && here.startsWith(path)) link.classList.add('active');
      else if (path === '/' && here === '/') link.classList.add('active');
    });
  }

  /** Reveals .kd-reveal elements as they enter the viewport. */
  function initReveal(root = document) {
    const targets = $$('.kd-reveal:not(.is-visible)', root);
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) return targets.forEach((el) => el.classList.add('is-visible'));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        // Small stagger so a grid does not pop in all at once.
        entry.target.style.transitionDelay = `${Math.min(i * 55, 220)}ms`;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    targets.forEach((el) => io.observe(el));
  }

  /**
   * Wires a contact form to POST /api/contact with inline validation feedback.
   * Expects: [data-contact-form] with named fields and a [data-form-status] region.
   */
  function initContactForm(form) {
    if (!form) return;
    const status = $('[data-form-status]', form) || $('[data-form-status]');
    const submit = form.querySelector('[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
      if (status) status.innerHTML = '';

      const payload = Object.fromEntries(new FormData(form).entries());
      const original = submit ? submit.innerHTML : '';
      if (submit) { submit.disabled = true; submit.innerHTML = 'Sending…'; }

      try {
        await api('/api/contact', { method: 'POST', body: JSON.stringify(payload) });
        form.reset();
        if (status) {
          status.innerHTML = `<div class="kd-tag kd-tag-ok"><i data-lucide="check"></i>Thanks — we'll reply within one business day.</div>`;
          icons();
        }
      } catch (err) {
        const fieldErrors = err.data && err.data.errors;
        if (fieldErrors) {
          Object.entries(fieldErrors).forEach(([name, message]) => {
            const field = form.elements[name];
            if (!field) return;
            field.classList.add('is-invalid');
            const help = field.parentElement.querySelector('.invalid-feedback');
            if (help) help.textContent = message;
          });
        }
        if (status) {
          status.innerHTML = `<div class="kd-tag kd-tag-warn"><i data-lucide="alert-triangle"></i>${esc(err.message)}</div>`;
          icons();
        }
      } finally {
        if (submit) { submit.disabled = false; submit.innerHTML = original; }
      }
    });
  }

  /**
   * Wires the header "Client portal" modal to the admin login endpoint.
   * On success the browser is sent to the dashboard; the session lives in an
   * httpOnly cookie, so nothing is stored in JS.
   */
  function initLoginForm(form) {
    if (!form) return;
    const error = $('#kdLoginError');
    const submit = form.querySelector('[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error?.classList.add('d-none');
      const original = submit.innerHTML;
      submit.disabled = true;
      submit.innerHTML = 'Signing in…';

      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify(payload) });
        window.location.href = '/admin/';
      } catch (err) {
        if (error) {
          error.className = 'mb-3';
          error.innerHTML = `<div class="kd-tag kd-tag-warn"><i data-lucide="alert-triangle"></i>${esc(err.message)}</div>`;
          icons();
        }
        submit.disabled = false;
        submit.innerHTML = original;
      }
    });
  }

  /* ------------------------------------------------------------ bootstrap */

  async function boot() {
    initNav();
    icons();
    initReveal();
    initContactForm($('[data-contact-form]'));
    initLoginForm($('#kdLoginForm'));

    try {
      hydrate(await content());
    } catch (err) {
      // The static markup already carries sensible fallbacks, so a failed
      // content fetch degrades quietly instead of blanking the page.
      console.warn('[koydam] content unavailable:', err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { $, $$, api, esc, safeUrl, icons, content, appCard, appIcon, platformTags, initReveal, PLATFORM_META };
})();
