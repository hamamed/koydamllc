/* ==========================================================================
   admin.js — Koydam admin panel runtime.

   Single-page dashboard over /api/admin/*. Routing is hash-based so the panel
   can be served as a static file:

     #/overview  #/apps  #/apps/new  #/apps/:id  #/pages  #/home
     #/inquiries #/settings

   No framework: the whole document is held in `state.doc`, views render from
   it, and every save round-trips through the API and refreshes that copy.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------- helpers */

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const icons = () => window.lucide && window.lucide.createIcons();

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
    });
    // The session cookie expired mid-visit — bounce to the login screen.
    if (res.status === 401) { window.location.href = '/admin/login.html'; throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.className = `ad-toast${isError ? ' is-error' : ''}`;
    el.innerHTML = `<i data-lucide="${isError ? 'alert-triangle' : 'check'}"></i><span>${esc(message)}</span>`;
    $('#adToasts').appendChild(el);
    icons();
    setTimeout(() => el.remove(), 3600);
  }

  /** Promise-based confirmation dialog backed by #adConfirmModal. */
  function confirmAction({ title, body, confirmLabel = 'Delete' }) {
    return new Promise((resolve) => {
      $('#adConfirmTitle').textContent = title;
      $('#adConfirmBody').textContent = body;
      const ok = $('#adConfirmOk');
      ok.textContent = confirmLabel;
      const modal = bootstrap.Modal.getOrCreateInstance($('#adConfirmModal'));

      const onOk = () => { cleanup(); modal.hide(); resolve(true); };
      const onHide = () => { cleanup(); resolve(false); };
      function cleanup() {
        ok.removeEventListener('click', onOk);
        $('#adConfirmModal').removeEventListener('hidden.bs.modal', onHide);
      }
      ok.addEventListener('click', onOk);
      $('#adConfirmModal').addEventListener('hidden.bs.modal', onHide);
      modal.show();
    });
  }

  const dateShort = (iso) => {
    if (!iso) return '—';
    // A bare "2026-08-01" parses as UTC midnight, which displays as the previous
    // day in the Americas. Pin date-only values to local midnight instead.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const PLATFORM_LABEL = { ios: 'iOS', android: 'Android', web: 'Web', saas: 'SaaS' };
  const LAUNCH_LABEL = {
    'coming-soon': 'Coming soon',
    'in-development': 'In development',
    beta: 'Beta',
  };

  /* --------------------------------------------------------------- state */

  const state = {
    doc: null,
    editingId: null,          // null = creating a new app
    editingInvoiceId: null,   // null = creating a new invoice
    pageTab: 'privacy',
    inboxFilter: 'inbox',
    appsStatusFilter: 'all',
    invoiceFilter: 'active',
    invoiceQuery: '',
  };

  const ROUTES = {
    overview:      { view: 'view-overview',        title: 'Dashboard' },
    apps:          { view: 'view-apps',            title: 'Apps manager' },
    appEditor:     { view: 'view-app-editor',      title: 'App editor' },
    pages:         { view: 'view-pages',           title: 'Pages & legal' },
    home:          { view: 'view-home',            title: 'Landing page' },
    inquiries:     { view: 'view-inquiries',       title: 'Inquiries' },
    invoices:      { view: 'view-invoices',        title: 'Invoices' },
    invoiceEditor: { view: 'view-invoice-editor',  title: 'Invoice' },
    settings:      { view: 'view-settings',        title: 'Company settings' },
  };

  /* -------------------------------------------------------------- router */

  function route() {
    const hash = (location.hash || '#/overview').slice(2);
    const [section, param] = hash.split('/');

    let key = ROUTES[section] ? section : 'overview';
    if (section === 'apps' && param) key = 'appEditor';
    if (section === 'invoices' && param) key = 'invoiceEditor';

    const config = ROUTES[key];
    const navFor = { appEditor: 'apps', invoiceEditor: 'invoices' };
    $$('.ad-view').forEach((v) => v.classList.toggle('is-active', v.id === config.view));
    $$('.ad-nav-link[data-route]').forEach((a) => {
      a.classList.toggle('is-active', a.dataset.route === (navFor[key] || key));
    });
    $('#adTitle').textContent = config.title;
    $('#adSidebar').classList.remove('is-open');
    $('.ad-backdrop')?.remove();
    window.scrollTo(0, 0);

    if (key === 'appEditor') renderAppEditor(param === 'new' ? null : param);
    if (key === 'apps') renderAppsTable();
    if (key === 'pages') renderPage(state.pageTab);
    if (key === 'home') renderHomeEditor();
    if (key === 'inquiries') renderInbox();
    if (key === 'invoices') renderInvoices();
    if (key === 'invoiceEditor') renderInvoiceEditor(param === 'new' ? null : param);
    if (key === 'settings') { renderSettings(); renderInvoiceSettings(); }
    if (key === 'overview') renderOverview();

    icons();
  }

  /* ------------------------------------------------------- repeatable UI */

  /** Adds one text input row to a repeatable list container. */
  function addRepeatRow(containerId, value = '', placeholder = '') {
    const row = document.createElement('div');
    row.className = 'ad-repeat-row';
    row.innerHTML = `
      <input class="form-control form-control-sm" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <button class="btn btn-kd-ghost btn-sm" type="button" aria-label="Remove"><i data-lucide="x"></i></button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    $(`#${containerId}`).appendChild(row);
    icons();
  }

  const readRepeat = (containerId) =>
    $$(`#${containerId} input`).map((i) => i.value.trim()).filter(Boolean);

  $$('[data-repeat-add]').forEach((btn) => {
    btn.addEventListener('click', () => addRepeatRow(btn.dataset.repeatAdd));
  });

  /* --------------------------------------------------- editor toolbar/preview */

  /** Wraps the current textarea selection in a tag, or inserts a template. */
  function wrapSelection(textarea, tag) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end) || 'text';
    let inserted;
    switch (tag) {
      case 'ul':  inserted = `<ul>\n  <li>${selected}</li>\n</ul>`; break;
      case 'a':   inserted = `<a href="https://">${selected}</a>`; break;
      default:    inserted = `<${tag}>${selected}</${tag}>`;
    }
    textarea.value = value.slice(0, start) + inserted + value.slice(end);
    textarea.focus();
    textarea.setSelectionRange(start, start + inserted.length);
  }

  $$('[data-editor-toolbar]').forEach((bar) => {
    const textarea = $(`#${bar.dataset.editorToolbar}`);
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.wrap) return wrapSelection(textarea, button.dataset.wrap);
      if (button.dataset.preview) {
        const preview = $(`#${button.dataset.preview}Preview`);
        preview.classList.toggle('d-none');
        // Owner-authored markup; rendered as-is so the preview matches the site.
        preview.innerHTML = textarea.value;
        button.textContent = preview.classList.contains('d-none') ? 'Preview' : 'Hide preview';
      }
    });
  });

  /* -------------------------------------------------------------- uploads */

  async function uploadFiles(fileList) {
    const form = new FormData();
    Array.from(fileList).forEach((file) => form.append('files', file));
    const { urls } = await api('/upload', { method: 'POST', body: form });
    return urls;
  }

  /* ================================================================ VIEWS */

  /* ---- Dashboard ---------------------------------------------------- */
  function renderOverview() {
    const apps = state.doc.apps || [];
    const inquiries = state.doc.inquiries || [];

    $('#kpiPublished').textContent = apps.filter((a) => a.status === 'published').length;
    $('#kpiDrafts').textContent = apps.filter((a) => a.status === 'draft').length;
    $('#kpiUnread').textContent = inquiries.filter((i) => !i.read && !i.archived).length;
    $('#kpiInquiries').textContent = inquiries.length;

    $('#adRecentInquiries').innerHTML = inquiries.slice(0, 5).map((inq) => `
      <tr class="${inq.read ? '' : 'is-unread'}" style="cursor:pointer" data-inquiry="${esc(inq.id)}">
        <td><strong class="kd-ink">${esc(inq.name)}</strong><br><span class="kd-faint small">${esc(inq.email)}</span></td>
        <td>${esc(inq.subject)}</td>
        <td class="kd-faint">${dateShort(inq.createdAt)}</td>
      </tr>`).join('') || `<tr><td colspan="3" class="kd-faint text-center py-4">No inquiries yet.</td></tr>`;

    $('#adRecentApps').innerHTML = [...apps]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 5)
      .map((app) => `
        <a class="d-flex align-items-center gap-2 px-3 py-2 kd-rule-b" href="#/apps/${esc(app.id)}">
          <span class="flex-grow-1 text-truncate kd-ink small">${esc(app.title)}</span>
          <span class="ad-status ad-status-${esc(app.status)}">${esc(app.status)}</span>
        </a>`).join('') || `<p class="kd-faint small text-center py-4 mb-0">No apps yet.</p>`;

    $('#adRecentInquiries').querySelectorAll('[data-inquiry]').forEach((row) => {
      row.addEventListener('click', () => openInquiry(row.dataset.inquiry));
    });

    updateBadges();
  }

  function updateBadges() {
    $('#adAppsBadge').textContent = (state.doc.apps || []).length;

    const unread = (state.doc.inquiries || []).filter((i) => !i.read && !i.archived).length;
    const inbox = $('#adInboxBadge');
    inbox.textContent = unread;
    inbox.style.display = unread ? '' : 'none';

    // Invoice badge counts what needs attention: unpaid and past due.
    const overdue = (state.doc.invoices || []).filter((i) => !i.archived && isOverdue(i)).length;
    const invoices = $('#adInvoiceBadge');
    invoices.textContent = overdue;
    invoices.style.display = overdue ? '' : 'none';
  }

  /* ---- Apps table ---------------------------------------------------- */
  function renderAppsTable() {
    const apps = [...(state.doc.apps || [])]
      .filter((a) => state.appsStatusFilter === 'all' || a.status === state.appsStatusFilter)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    $('#adAppsEmpty').classList.toggle('d-none', apps.length > 0);

    $('#adAppsTable').innerHTML = apps.map((app) => `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            ${app.icon
              ? `<img src="${esc(app.icon)}" alt="" width="32" height="32" style="border-radius:8px;object-fit:cover;border:1px solid var(--kd-line)">`
              : `<span class="kd-app-icon kd-app-icon-fallback" style="width:32px;height:32px;border-radius:8px;font-size:.8rem">${esc((app.title || '?')[0])}</span>`}
            <div class="min-w-0">
              <div class="kd-ink fw-semibold text-truncate">
                ${esc(app.title)}
                ${app.launchStatus && app.launchStatus !== 'live'
                  ? `<span class="kd-tag kd-tag-accent ms-1">${esc(LAUNCH_LABEL[app.launchStatus] || app.launchStatus)}</span>` : ''}
              </div>
              <div class="kd-faint small text-truncate">/app/${esc(app.slug)}</div>
            </div>
          </div>
        </td>
        <td>${(app.platforms || []).map((p) => `<span class="kd-tag me-1">${esc(PLATFORM_LABEL[p] || p)}</span>`).join('') || '<span class="kd-faint">—</span>'}</td>
        <td>${esc(app.category || '—')}</td>
        <td><span class="ad-status ad-status-${esc(app.status)}">${esc(app.status)}</span></td>
        <td class="text-end">
          <div class="d-inline-flex gap-1">
            <a class="btn btn-kd-ghost btn-sm" href="#/apps/${esc(app.id)}" aria-label="Edit"><i data-lucide="pencil"></i></a>
            ${app.status === 'published'
              ? `<a class="btn btn-kd-ghost btn-sm" href="/app/${esc(app.slug)}" target="_blank" rel="noopener" aria-label="View"><i data-lucide="external-link"></i></a>` : ''}
            <button class="btn btn-kd-ghost btn-sm text-danger" data-delete="${esc(app.id)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>`).join('');

    $$('#adAppsTable [data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteApp(btn.dataset.delete));
    });

    icons();
  }

  $('#adAppsStatusFilter').addEventListener('change', (e) => {
    state.appsStatusFilter = e.target.value;
    renderAppsTable();
  });

  /* ---- App editor ----------------------------------------------------- */
  function renderAppEditor(id) {
    const app = id ? (state.doc.apps || []).find((a) => a.id === id) : null;
    if (id && !app) { toast('That app no longer exists.', true); location.hash = '#/apps'; return; }

    state.editingId = app ? app.id : null;
    $('#adTitle').textContent = app ? `Edit — ${app.title}` : 'New app';

    const values = app || { status: 'draft', platforms: [], features: [], screenshots: [] };

    $('#fTitle').value = values.title || '';
    $('#fSlug').value = values.slug || '';
    $('#fTagline').value = values.tagline || '';
    $('#fDescription').value = values.description || '';
    $('#fIcon').value = values.icon || '';
    $('#fStatus').value = values.status || 'draft';
    $('#fLaunchStatus').value = values.launchStatus || 'live';
    $('#fExpectedLaunch').value = values.expectedLaunch || '';
    toggleExpectedLaunch();
    $('#fFeatured').checked = Boolean(values.featured);
    $('#fOrder').value = values.order || ((state.doc.apps || []).length + 1);
    $('#fCategory').value = values.category || '';
    $('#fVersion').value = values.version || '';
    $('#fReleaseDate').value = values.releaseDate || '';
    $('#fAppStore').value = values.appStoreUrl || '';
    $('#fPlayStore').value = values.playStoreUrl || '';
    $('#fWebUrl').value = values.webUrl || '';

    ['ios', 'android', 'web', 'saas'].forEach((platform) => {
      $(`#p${platform[0].toUpperCase()}${platform.slice(1)}`).checked =
        (values.platforms || []).includes(platform);
    });

    $('#adFeatures').innerHTML = '';
    (values.features || []).forEach((f) => addRepeatRow('adFeatures', f, 'e.g. Offline sync'));
    if (!(values.features || []).length) addRepeatRow('adFeatures', '', 'e.g. Offline sync');

    renderIconPreview();
    renderShots(values.screenshots || []);

    const live = $('#adViewLive');
    live.classList.toggle('d-none', !app || app.status !== 'published');
    if (app) live.href = `/app/${app.slug}`;
    $('#adDeleteApp').classList.toggle('d-none', !app);

    $('#fDescriptionPreview').classList.add('d-none');
    icons();
  }

  /** "Expected launch" only makes sense for an app that has not launched. */
  function toggleExpectedLaunch() {
    const live = $('#fLaunchStatus').value === 'live';
    $('#fExpectedLaunchWrap').classList.toggle('d-none', live);
  }
  $('#fLaunchStatus').addEventListener('change', toggleExpectedLaunch);

  function renderIconPreview() {
    const url = $('#fIcon').value.trim();
    $('#adIconPreview').innerHTML = url
      ? `<div class="ad-thumb"><img src="${esc(url)}" alt=""></div>`
      : `<div class="ad-thumb d-grid" style="place-items:center;color:var(--kd-faint)"><i data-lucide="image"></i></div>`;
    icons();
  }
  $('#fIcon').addEventListener('input', renderIconPreview);

  /** Screenshot list lives in the DOM; read back with readShots(). */
  function renderShots(urls) {
    $('#adShots').innerHTML = urls.map((url) => `
      <div class="ad-thumb" data-shot="${esc(url)}">
        <img src="${esc(url)}" alt="">
        <button type="button" aria-label="Remove screenshot"><i data-lucide="x" style="width:12px;height:12px"></i></button>
      </div>`).join('');
    $$('#adShots .ad-thumb button').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.ad-thumb').remove();
      });
    });
    icons();
  }

  const readShots = () => $$('#adShots .ad-thumb').map((el) => el.dataset.shot);

  /* Icon upload */
  $('#fIconUpload').addEventListener('change', async (event) => {
    if (!event.target.files.length) return;
    try {
      const [url] = await uploadFiles(event.target.files);
      $('#fIcon').value = url;
      renderIconPreview();
      toast('Icon uploaded');
    } catch (err) { toast(err.message, true); }
    event.target.value = '';
  });

  /* Screenshot upload — click or drag & drop */
  async function addShots(files) {
    if (!files.length) return;
    try {
      const urls = await uploadFiles(files);
      renderShots([...readShots(), ...urls]);
      toast(`${urls.length} screenshot${urls.length > 1 ? 's' : ''} uploaded`);
    } catch (err) { toast(err.message, true); }
  }

  $('#fShotsUpload').addEventListener('change', async (event) => {
    await addShots(event.target.files);
    event.target.value = '';
  });

  const drop = $('#adShotsDrop');
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault(); drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault(); drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', (e) => addShots(e.dataTransfer.files));

  /* Save */
  $('#adAppForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = $('#fTitle').value.trim();
    $('#fTitle').classList.toggle('is-invalid', !title);
    if (!title) return toast('A title is required.', true);

    const payload = {
      title,
      slug: $('#fSlug').value.trim(),
      tagline: $('#fTagline').value.trim(),
      description: $('#fDescription').value,
      features: readRepeat('adFeatures'),
      icon: $('#fIcon').value.trim(),
      screenshots: readShots(),
      platforms: ['ios', 'android', 'web', 'saas']
        .filter((p) => $(`#p${p[0].toUpperCase()}${p.slice(1)}`).checked),
      category: $('#fCategory').value.trim(),
      version: $('#fVersion').value.trim(),
      releaseDate: $('#fReleaseDate').value,
      appStoreUrl: $('#fAppStore').value.trim(),
      playStoreUrl: $('#fPlayStore').value.trim(),
      webUrl: $('#fWebUrl').value.trim(),
      status: $('#fStatus').value,
      launchStatus: $('#fLaunchStatus').value,
      expectedLaunch: $('#fExpectedLaunch').value.trim(),
      featured: $('#fFeatured').checked,
      order: Number($('#fOrder').value) || undefined,
    };

    const button = event.submitter;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Saving…';

    try {
      const result = state.editingId
        ? await api(`/apps/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/apps', { method: 'POST', body: JSON.stringify(payload) });

      await refresh();
      toast(state.editingId ? 'App updated' : 'App created');
      location.hash = `#/apps/${result.app.id}`;
      renderAppEditor(result.app.id);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      icons();
    }
  });

  async function deleteApp(id) {
    const app = (state.doc.apps || []).find((a) => a.id === id);
    const ok = await confirmAction({
      title: 'Delete this app?',
      body: `"${app ? app.title : 'This app'}" will be removed from the site permanently.`,
    });
    if (!ok) return;
    try {
      await api(`/apps/${id}`, { method: 'DELETE' });
      await refresh();
      toast('App deleted');
      location.hash = '#/apps';
      renderAppsTable();
    } catch (err) { toast(err.message, true); }
  }

  $('#adDeleteApp').addEventListener('click', () => state.editingId && deleteApp(state.editingId));

  /* ---- Pages & legal --------------------------------------------------- */
  function renderPage(key) {
    state.pageTab = key;
    const page = (state.doc.pages || {})[key] || { title: '', updatedAt: '', body: '' };
    $('#pgTitle').value = page.title || '';
    $('#pgUpdated').value = page.updatedAt || '';
    $('#pgBody').value = page.body || '';
    $('#pgBodyPreview').classList.add('d-none');
    $$('[data-page-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.pageTab === key));
    $$('[data-page-tab]').forEach((b) => {
      const active = b.dataset.pageTab === key;
      b.classList.toggle('btn-kd', active);
      b.classList.toggle('btn-kd-ghost', !active);
    });
  }

  $$('[data-page-tab]').forEach((btn) => {
    btn.addEventListener('click', () => renderPage(btn.dataset.pageTab));
  });

  $('#adSavePage').addEventListener('click', async () => {
    try {
      await api(`/pages/${state.pageTab}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: $('#pgTitle').value.trim(),
          updatedAt: $('#pgUpdated').value,
          body: $('#pgBody').value,
        }),
      });
      await refresh();
      toast('Page saved');
    } catch (err) { toast(err.message, true); }
  });

  /* ---- Landing page ---------------------------------------------------- */
  function statRow(stat = { value: '', label: '' }) {
    const row = document.createElement('div');
    row.className = 'ad-repeat-row';
    row.innerHTML = `
      <input class="form-control form-control-sm" data-stat="value" style="max-width:110px" placeholder="12+" value="${esc(stat.value)}">
      <input class="form-control form-control-sm" data-stat="label" placeholder="Products shipped" value="${esc(stat.label)}">
      <button class="btn btn-kd-ghost btn-sm" type="button" aria-label="Remove"><i data-lucide="x"></i></button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    return row;
  }

  function serviceRow(service = { icon: 'square', title: '', summary: '', bullets: [] }) {
    const row = document.createElement('div');
    row.className = 'ad-card mb-2 p-3';
    row.innerHTML = `
      <div class="d-flex gap-2 mb-2">
        <input class="form-control form-control-sm" data-svc="icon" style="max-width:130px"
               placeholder="lucide icon" value="${esc(service.icon)}">
        <input class="form-control form-control-sm" data-svc="title" placeholder="Service title" value="${esc(service.title)}">
        <button class="btn btn-kd-ghost btn-sm" type="button" aria-label="Remove"><i data-lucide="x"></i></button>
      </div>
      <input class="form-control form-control-sm mb-2" data-svc="summary" placeholder="One-line summary" value="${esc(service.summary)}">
      <input class="form-control form-control-sm" data-svc="bullets" placeholder="Bullets, comma separated"
             value="${esc((service.bullets || []).join(', '))}">`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    return row;
  }

  function renderHomeEditor() {
    const home = state.doc.home || {};
    $('#hEyebrow').value = home.eyebrow || '';
    $('#hTitle').value = home.heroTitle || '';
    $('#hSubtitle').value = home.heroSubtitle || '';
    $('#hAboutTitle').value = home.aboutTitle || '';
    $('#hAboutBody').value = home.aboutBody || '';

    $('#adAboutPoints').innerHTML = '';
    (home.aboutPoints || []).forEach((p) => addRepeatRow('adAboutPoints', p));

    $('#adStats').innerHTML = '';
    (home.stats || []).forEach((s) => $('#adStats').appendChild(statRow(s)));

    $('#adServices').innerHTML = '';
    (state.doc.services || []).forEach((s) => $('#adServices').appendChild(serviceRow(s)));

    icons();
  }

  $('#adAddStat').addEventListener('click', () => { $('#adStats').appendChild(statRow()); icons(); });
  $('#adAddService').addEventListener('click', () => { $('#adServices').appendChild(serviceRow()); icons(); });

  $('#adHomeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/home', {
        method: 'PUT',
        body: JSON.stringify({
          eyebrow: $('#hEyebrow').value.trim(),
          heroTitle: $('#hTitle').value.trim(),
          heroSubtitle: $('#hSubtitle').value.trim(),
          aboutTitle: $('#hAboutTitle').value.trim(),
          aboutBody: $('#hAboutBody').value.trim(),
          aboutPoints: readRepeat('adAboutPoints'),
          stats: $$('#adStats .ad-repeat-row').map((row) => ({
            value: $('[data-stat="value"]', row).value.trim(),
            label: $('[data-stat="label"]', row).value.trim(),
          })).filter((s) => s.value || s.label),
        }),
      });

      await api('/services', {
        method: 'PUT',
        body: JSON.stringify({
          services: $$('#adServices > .ad-card').map((row) => ({
            icon: $('[data-svc="icon"]', row).value.trim(),
            title: $('[data-svc="title"]', row).value.trim(),
            summary: $('[data-svc="summary"]', row).value.trim(),
            bullets: $('[data-svc="bullets"]', row).value.split(',').map((b) => b.trim()).filter(Boolean),
          })),
        }),
      });

      await refresh();
      toast('Landing page saved');
    } catch (err) { toast(err.message, true); }
  });

  /* ---- Inquiries -------------------------------------------------------- */
  function filteredInquiries() {
    const all = state.doc.inquiries || [];
    switch (state.inboxFilter) {
      case 'unread':   return all.filter((i) => !i.read && !i.archived);
      case 'archived': return all.filter((i) => i.archived);
      case 'all':      return all;
      default:         return all.filter((i) => !i.archived);
    }
  }

  function renderInbox() {
    const list = filteredInquiries();
    $('#adInboxEmpty').classList.toggle('d-none', list.length > 0);

    $('#adInboxTable').innerHTML = list.map((inq) => `
      <tr class="${inq.read ? '' : 'is-unread'}">
        <td>
          <strong class="kd-ink">${esc(inq.name)}</strong><br>
          <a class="kd-faint small" href="mailto:${esc(inq.email)}">${esc(inq.email)}</a>
          ${inq.company ? `<div class="kd-faint small">${esc(inq.company)}</div>` : ''}
        </td>
        <td>${esc(inq.subject)}</td>
        <td class="text-truncate" style="max-width:280px;cursor:pointer" data-open="${esc(inq.id)}">${esc(inq.message)}</td>
        <td class="kd-faint">${dateShort(inq.createdAt)}</td>
        <td class="text-end">
          <div class="d-inline-flex gap-1">
            <button class="btn btn-kd-ghost btn-sm" data-open="${esc(inq.id)}" aria-label="Open"><i data-lucide="eye"></i></button>
            <button class="btn btn-kd-ghost btn-sm" data-archive="${esc(inq.id)}" aria-label="${inq.archived ? 'Restore' : 'Archive'}">
              <i data-lucide="${inq.archived ? 'archive-restore' : 'archive'}"></i>
            </button>
            <button class="btn btn-kd-ghost btn-sm text-danger" data-remove="${esc(inq.id)}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>`).join('');

    $$('#adInboxTable [data-open]').forEach((el) =>
      el.addEventListener('click', () => openInquiry(el.dataset.open)));

    $$('#adInboxTable [data-archive]').forEach((el) =>
      el.addEventListener('click', async () => {
        const inq = (state.doc.inquiries || []).find((i) => i.id === el.dataset.archive);
        await api(`/inquiries/${el.dataset.archive}`, {
          method: 'PATCH', body: JSON.stringify({ archived: !inq.archived }),
        });
        await refresh();
        renderInbox();
        toast(inq.archived ? 'Restored to inbox' : 'Archived');
      }));

    $$('#adInboxTable [data-remove]').forEach((el) =>
      el.addEventListener('click', async () => {
        const ok = await confirmAction({ title: 'Delete this inquiry?', body: 'The message will be removed permanently.' });
        if (!ok) return;
        await api(`/inquiries/${el.dataset.remove}`, { method: 'DELETE' });
        await refresh();
        renderInbox();
        toast('Inquiry deleted');
      }));

    icons();
  }

  $('#adInboxFilter').addEventListener('change', (e) => {
    state.inboxFilter = e.target.value;
    renderInbox();
  });

  async function openInquiry(id) {
    const inq = (state.doc.inquiries || []).find((i) => i.id === id);
    if (!inq) return;

    $('#adInquirySubject').textContent = inq.subject;
    $('#adInquiryFrom').textContent =
      `${inq.name} · ${inq.email}${inq.company ? ` · ${inq.company}` : ''} · ${dateShort(inq.createdAt)}`;
    $('#adInquiryMessage').textContent = inq.message;
    $('#adInquiryReply').href =
      `mailto:${inq.email}?subject=${encodeURIComponent(`Re: ${inq.subject}`)}`;

    bootstrap.Modal.getOrCreateInstance($('#adInquiryModal')).show();
    icons();

    if (!inq.read) {
      await api(`/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) });
      await refresh();
      updateBadges();
      if ($('#view-inquiries').classList.contains('is-active')) renderInbox();
      else renderOverview();
    }
  }

  /* ======================================================================== *
   * Invoices
   * ======================================================================== */

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100 || 0;

  /** Currency formatter, falling back to a plain number for unknown codes. */
  function fmtMoney(amount, currency) {
    const code = (currency || state.doc.invoiceSettings?.currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount) || 0);
    } catch {
      return `${code} ${(Number(amount) || 0).toFixed(2)}`;
    }
  }

  const INVOICE_STATUS_CLASS = {
    draft: 'ad-status-draft', sent: 'ad-status-sent', paid: 'ad-status-published',
    overdue: 'ad-status-archived', cancelled: 'ad-status-draft',
  };

  /** An invoice is overdue when it is unpaid and past its due date. */
  const isOverdue = (inv) =>
    inv.dueDate && !['paid', 'cancelled'].includes(inv.status) &&
    new Date(`${inv.dueDate}T23:59:59`) < new Date();

  /* ---- Archive list ---- */
  function filteredInvoices() {
    const all = state.doc.invoices || [];
    const needle = state.invoiceQuery.trim().toLowerCase();

    let list;
    switch (state.invoiceFilter) {
      case 'archived': list = all.filter((i) => i.archived); break;
      case 'overdue':  list = all.filter((i) => !i.archived && isOverdue(i)); break;
      case 'all':      list = all; break;
      case 'active':   list = all.filter((i) => !i.archived); break;
      default:         list = all.filter((i) => !i.archived && i.status === state.invoiceFilter);
    }

    if (!needle) return list;
    return list.filter((i) =>
      [i.number, i.client?.name, i.client?.company, i.client?.email]
        .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }

  function renderInvoices() {
    const all = state.doc.invoices || [];
    const list = filteredInvoices();
    const year = String(new Date().getFullYear());

    const outstanding = all
      .filter((i) => !i.archived && ['sent', 'overdue'].includes(i.status))
      .reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    const paidThisYear = all
      .filter((i) => i.status === 'paid' && String(i.issueDate).startsWith(year))
      .reduce((sum, i) => sum + (Number(i.total) || 0), 0);

    $('#kpiOutstanding').textContent = fmtMoney(outstanding);
    $('#kpiPaidYear').textContent = fmtMoney(paidThisYear);
    $('#kpiOverdue').textContent = all.filter((i) => !i.archived && isOverdue(i)).length;
    $('#kpiInvoiceCount').textContent = all.length;

    $('#adInvoiceEmpty').classList.toggle('d-none', list.length > 0);

    $('#adInvoiceTable').innerHTML = list.map((inv) => {
      const overdue = isOverdue(inv);
      const status = overdue && inv.status === 'sent' ? 'overdue' : inv.status;
      return `
        <tr class="${inv.archived ? 'kd-faint' : ''}">
          <td><a class="kd-mono kd-ink fw-semibold" href="#/invoices/${esc(inv.id)}">${esc(inv.number)}</a></td>
          <td>
            <div class="kd-ink text-truncate">${esc(inv.client?.company || inv.client?.name || '—')}</div>
            ${inv.client?.company && inv.client?.name ? `<div class="kd-faint small text-truncate">${esc(inv.client.name)}</div>` : ''}
          </td>
          <td class="kd-faint">${dateShort(inv.issueDate)}</td>
          <td class="${overdue ? 'text-danger' : 'kd-faint'}">${inv.dueDate ? dateShort(inv.dueDate) : '—'}</td>
          <td class="text-end kd-ink fw-semibold">${esc(fmtMoney(inv.total, inv.currency))}</td>
          <td><span class="ad-status ${INVOICE_STATUS_CLASS[status] || 'ad-status-draft'}">${esc(status)}</span></td>
          <td class="text-end">
            <div class="d-inline-flex gap-1">
              <a class="btn btn-kd-ghost btn-sm" href="/admin/invoice.html?id=${esc(inv.id)}" target="_blank"
                 rel="noopener" aria-label="View or print"><i data-lucide="printer"></i></a>
              <a class="btn btn-kd-ghost btn-sm" href="#/invoices/${esc(inv.id)}" aria-label="Edit"><i data-lucide="pencil"></i></a>
              <button class="btn btn-kd-ghost btn-sm" data-invoice-archive="${esc(inv.id)}"
                      aria-label="${inv.archived ? 'Restore' : 'Archive'}">
                <i data-lucide="${inv.archived ? 'archive-restore' : 'archive'}"></i>
              </button>
              <button class="btn btn-kd-ghost btn-sm text-danger" data-invoice-delete="${esc(inv.id)}"
                      aria-label="Delete"><i data-lucide="trash-2"></i></button>
            </div>
          </td>
        </tr>`;
    }).join('');

    $$('#adInvoiceTable [data-invoice-archive]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const inv = (state.doc.invoices || []).find((i) => i.id === btn.dataset.invoiceArchive);
        await api(`/invoices/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ archived: !inv.archived }) });
        await refresh();
        renderInvoices();
        toast(inv.archived ? 'Restored from archive' : 'Moved to archive');
      }));

    $$('#adInvoiceTable [data-invoice-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const inv = (state.doc.invoices || []).find((i) => i.id === btn.dataset.invoiceDelete);
        const ok = await confirmAction({
          title: 'Delete this invoice?',
          body: `${inv.number} will be removed permanently. Archive it instead if you need the record.`,
        });
        if (!ok) return;
        await api(`/invoices/${inv.id}`, { method: 'DELETE' });
        await refresh();
        renderInvoices();
        toast('Invoice deleted');
      }));

    updateBadges();
    icons();
  }

  $('#adInvoiceFilter').addEventListener('change', (e) => {
    state.invoiceFilter = e.target.value;
    renderInvoices();
  });

  let invoiceSearchTimer;
  $('#adInvoiceSearch').addEventListener('input', (e) => {
    clearTimeout(invoiceSearchTimer);
    const value = e.target.value;
    invoiceSearchTimer = setTimeout(() => { state.invoiceQuery = value; renderInvoices(); }, 140);
  });

  /* ---- Line items ---- */
  function itemRow(item = { description: '', quantity: 1, unitPrice: 0 }) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input class="form-control form-control-sm" data-item="description" value="${esc(item.description)}"
                 placeholder="Design & development — sprint 3"></td>
      <td><input class="form-control form-control-sm text-end" data-item="quantity" type="number" step="0.01" min="0"
                 value="${esc(item.quantity)}"></td>
      <td><input class="form-control form-control-sm text-end" data-item="unitPrice" type="number" step="0.01" min="0"
                 value="${esc(item.unitPrice)}"></td>
      <td class="text-end kd-ink fw-semibold" data-item-amount>—</td>
      <td class="text-end">
        <button class="btn btn-kd-ghost btn-sm text-danger" type="button" aria-label="Remove line">
          <i data-lucide="x"></i>
        </button>
      </td>`;
    row.querySelector('button').addEventListener('click', () => { row.remove(); recalcInvoice(); });
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', recalcInvoice));
    return row;
  }

  const readItems = () => $$('#adInvoiceItems tr').map((row) => ({
    description: $('[data-item="description"]', row).value.trim(),
    quantity: Number($('[data-item="quantity"]', row).value) || 0,
    unitPrice: Number($('[data-item="unitPrice"]', row).value) || 0,
  }));

  /**
   * Mirrors the server's arithmetic so the editor previews live totals.
   * The server recomputes on save — this is display only.
   */
  function recalcInvoice() {
    const currency = $('#ivCurrency').value.trim() || undefined;
    let subtotal = 0;

    $$('#adInvoiceItems tr').forEach((row) => {
      const qty = Number($('[data-item="quantity"]', row).value) || 0;
      const price = Number($('[data-item="unitPrice"]', row).value) || 0;
      const amount = round2(qty * price);
      subtotal += amount;
      $('[data-item-amount]', row).textContent = fmtMoney(amount, currency);
    });

    subtotal = round2(subtotal);
    const discount = round2($('#ivDiscount').value);
    const taxRate = round2($('#ivTaxRate').value);
    const taxable = round2(subtotal - discount);
    const taxAmount = round2((taxable * taxRate) / 100);

    $('#ivSubtotal').textContent = fmtMoney(subtotal, currency);
    $('#ivDiscountOut').textContent = discount ? `− ${fmtMoney(discount, currency)}` : fmtMoney(0, currency);
    $('#ivTaxOutLabel').textContent = `${$('#ivTaxLabel').value.trim() || 'Tax'} (${taxRate}%)`;
    $('#ivTaxOut').textContent = fmtMoney(taxAmount, currency);
    $('#ivTotal').textContent = fmtMoney(round2(taxable + taxAmount), currency);
  }

  ['#ivDiscount', '#ivTaxRate', '#ivTaxLabel', '#ivCurrency'].forEach((sel) =>
    $(sel).addEventListener('input', recalcInvoice));

  $('#adAddItem').addEventListener('click', () => {
    $('#adInvoiceItems').appendChild(itemRow());
    icons();
    recalcInvoice();
  });

  /* ---- Editor ---- */
  function renderInvoiceEditor(id) {
    const invoice = id ? (state.doc.invoices || []).find((i) => i.id === id) : null;
    if (id && !invoice) { toast('That invoice no longer exists.', true); location.hash = '#/invoices'; return; }

    const settings = state.doc.invoiceSettings || {};
    state.editingInvoiceId = invoice ? invoice.id : null;
    $('#adTitle').textContent = invoice ? `Invoice ${invoice.number}` : 'New invoice';

    const today = new Date().toISOString().slice(0, 10);
    const inTwoWeeks = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const client = invoice?.client || {};
    const address = client.address || {};

    $('#ivName').value = client.name || '';
    $('#ivCompany').value = client.company || '';
    $('#ivEmail').value = client.email || '';
    $('#ivPhone').value = client.phone || '';
    $('#ivLine1').value = address.line1 || '';
    $('#ivCity').value = address.city || '';
    $('#ivState').value = address.state || '';
    $('#ivZip').value = address.zip || '';
    $('#ivCountry').value = address.country || '';
    $('#ivTaxId').value = client.taxId || '';

    $('#ivNumber').value = invoice ? invoice.number : '';
    $('#ivNumber').readOnly = Boolean(invoice); // numbers are immutable once issued
    $('#ivNumberHint').textContent = invoice
      ? 'Invoice numbers cannot be changed after creation.'
      : 'Leave blank to use the next sequential number.';
    $('#ivStatus').value = invoice?.status || 'draft';
    $('#ivIssueDate').value = invoice?.issueDate || today;
    $('#ivDueDate').value = invoice?.dueDate || inTwoWeeks;
    $('#ivPo').value = invoice?.poNumber || '';

    $('#ivCurrency').value = invoice?.currency || settings.currency || 'USD';
    $('#ivDiscount').value = invoice?.discount ?? 0;
    $('#ivTaxLabel').value = invoice?.taxLabel || settings.taxLabel || 'Tax';
    $('#ivTaxRate').value = invoice?.taxRate ?? settings.taxRate ?? 0;

    $('#ivNotes').value = invoice?.notes || '';
    $('#ivTerms').value = invoice?.paymentTerms || settings.paymentTerms || '';
    $('#ivBank').value = invoice?.bankDetails || settings.bankDetails || '';

    const items = invoice?.items?.length ? invoice.items : [{ description: '', quantity: 1, unitPrice: 0 }];
    $('#adInvoiceItems').innerHTML = '';
    items.forEach((item) => $('#adInvoiceItems').appendChild(itemRow(item)));

    const print = $('#adInvoicePrint');
    print.classList.toggle('d-none', !invoice);
    if (invoice) print.href = `/admin/invoice.html?id=${invoice.id}`;
    $('#adDeleteInvoice').classList.toggle('d-none', !invoice);

    icons();
    recalcInvoice();
  }

  /** Prefills the client block from the most recent invoice for that client. */
  $('#adCopyClient').addEventListener('click', async () => {
    const clients = [];
    const seen = new Set();
    (state.doc.invoices || []).forEach((inv) => {
      const key = (inv.client?.company || inv.client?.name || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      clients.push(inv.client);
    });
    if (!clients.length) return toast('No previous clients yet.', true);

    const picked = await pickFromList('Reuse a client', clients.map((c) => ({
      label: c.company || c.name,
      sub: [c.name, c.email].filter(Boolean).join(' · '),
      value: c,
    })));
    if (!picked) return;

    $('#ivName').value = picked.name || '';
    $('#ivCompany').value = picked.company || '';
    $('#ivEmail').value = picked.email || '';
    $('#ivPhone').value = picked.phone || '';
    $('#ivLine1').value = picked.address?.line1 || '';
    $('#ivCity').value = picked.address?.city || '';
    $('#ivState').value = picked.address?.state || '';
    $('#ivZip').value = picked.address?.zip || '';
    $('#ivCountry').value = picked.address?.country || '';
    $('#ivTaxId').value = picked.taxId || '';
  });

  /** Minimal single-choice picker built on the existing confirm modal shell. */
  function pickFromList(title, options) {
    return new Promise((resolve) => {
      $('#adConfirmTitle').textContent = title;
      $('#adConfirmBody').innerHTML = options.map((o, i) => `
        <button type="button" class="btn btn-kd-outline w-100 text-start mb-2" data-pick="${i}">
          <span class="d-block kd-ink">${esc(o.label)}</span>
          ${o.sub ? `<span class="d-block kd-faint small">${esc(o.sub)}</span>` : ''}
        </button>`).join('');
      $('#adConfirmOk').classList.add('d-none');

      const modalEl = $('#adConfirmModal');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

      const onClick = (event) => {
        const btn = event.target.closest('[data-pick]');
        if (!btn) return;
        cleanup();
        modal.hide();
        resolve(options[Number(btn.dataset.pick)].value);
      };
      const onHide = () => { cleanup(); resolve(null); };
      function cleanup() {
        $('#adConfirmBody').removeEventListener('click', onClick);
        modalEl.removeEventListener('hidden.bs.modal', onHide);
        $('#adConfirmOk').classList.remove('d-none');
        $('#adConfirmBody').innerHTML = '';
      }

      $('#adConfirmBody').addEventListener('click', onClick);
      modalEl.addEventListener('hidden.bs.modal', onHide);
      modal.show();
    });
  }

  $('#adInvoiceForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = $('#ivName').value.trim();
    const company = $('#ivCompany').value.trim();
    $('#ivName').classList.toggle('is-invalid', !name && !company);
    if (!name && !company) return toast('Enter a client name or company.', true);

    const payload = {
      number: state.editingInvoiceId ? undefined : $('#ivNumber').value.trim(),
      status: $('#ivStatus').value,
      issueDate: $('#ivIssueDate').value,
      dueDate: $('#ivDueDate').value,
      poNumber: $('#ivPo').value.trim(),
      client: {
        name, company,
        email: $('#ivEmail').value.trim(),
        phone: $('#ivPhone').value.trim(),
        taxId: $('#ivTaxId').value.trim(),
        address: {
          line1: $('#ivLine1').value.trim(),
          city: $('#ivCity').value.trim(),
          state: $('#ivState').value.trim(),
          zip: $('#ivZip').value.trim(),
          country: $('#ivCountry').value.trim(),
        },
      },
      items: readItems().filter((i) => i.description || i.unitPrice),
      currency: $('#ivCurrency').value.trim().toUpperCase(),
      discount: Number($('#ivDiscount').value) || 0,
      taxRate: Number($('#ivTaxRate').value) || 0,
      taxLabel: $('#ivTaxLabel').value.trim(),
      notes: $('#ivNotes').value,
      paymentTerms: $('#ivTerms').value,
      bankDetails: $('#ivBank').value,
      archived: state.editingInvoiceId
        ? Boolean((state.doc.invoices || []).find((i) => i.id === state.editingInvoiceId)?.archived)
        : false,
    };

    const button = event.submitter;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Saving…';

    try {
      const result = state.editingInvoiceId
        ? await api(`/invoices/${state.editingInvoiceId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/invoices', { method: 'POST', body: JSON.stringify(payload) });

      await refresh();
      toast(state.editingInvoiceId ? 'Invoice updated' : `Invoice ${result.invoice.number} created`);
      location.hash = `#/invoices/${result.invoice.id}`;
      renderInvoiceEditor(result.invoice.id);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      icons();
    }
  });

  $('#adDeleteInvoice').addEventListener('click', async () => {
    const inv = (state.doc.invoices || []).find((i) => i.id === state.editingInvoiceId);
    if (!inv) return;
    const ok = await confirmAction({
      title: 'Delete this invoice?',
      body: `${inv.number} will be removed permanently. Archive it instead if you need the record.`,
    });
    if (!ok) return;
    await api(`/invoices/${inv.id}`, { method: 'DELETE' });
    await refresh();
    toast('Invoice deleted');
    location.hash = '#/invoices';
    renderInvoices();
  });

  /* ---- Invoicing defaults (inside Company settings) ---- */
  function renderInvoiceSettings() {
    const s = state.doc.invoiceSettings || {};
    $('#isPrefix').value = s.prefix || '';
    $('#isFormat').value = s.format || '';
    $('#isNextNumber').value = s.nextNumber || 1;
    $('#isPadding').value = s.padding || 4;
    $('#isCurrency').value = s.currency || 'USD';
    $('#isTaxLabel').value = s.taxLabel || '';
    $('#isTaxRate').value = s.taxRate ?? 0;
    $('#isLogo').value = s.logo || '';
    $('#isTerms').value = s.paymentTerms || '';
    $('#isBank').value = s.bankDetails || '';
    $('#isFooter').value = s.footerNote || '';
  }

  $('#adSaveInvoiceSettings').addEventListener('click', async () => {
    try {
      await api('/invoice-settings', {
        method: 'PUT',
        body: JSON.stringify({
          prefix: $('#isPrefix').value.trim(),
          format: $('#isFormat').value.trim(),
          nextNumber: Number($('#isNextNumber').value),
          padding: Number($('#isPadding').value),
          currency: $('#isCurrency').value.trim().toUpperCase(),
          taxLabel: $('#isTaxLabel').value.trim(),
          taxRate: Number($('#isTaxRate').value) || 0,
          logo: $('#isLogo').value.trim(),
          paymentTerms: $('#isTerms').value,
          bankDetails: $('#isBank').value,
          footerNote: $('#isFooter').value.trim(),
        }),
      });
      await refresh();
      toast('Invoicing defaults saved');
    } catch (err) { toast(err.message, true); }
  });

  /* ---- Settings ---------------------------------------------------------- */
  function renderSettings() {
    const s = state.doc.settings || {};
    const address = s.address || {};
    const socials = s.socials || {};

    $('#sCompanyName').value = s.companyName || '';
    $('#sLegalName').value = s.legalName || '';
    $('#sEntityType').value = s.entityType || '';
    $('#sSoleMember').value = s.soleMember || '';
    $('#sRegisteredState').value = s.registeredState || '';
    $('#sRegisteredDate').value = s.registeredDate || '';
    $('#sEin').value = s.ein || '';
    $('#sDuns').value = s.duns || '';
    $('#sTagline').value = s.tagline || '';
    $('#sCopyright').value = s.copyright || '';
    $('#sEmail').value = s.email || '';
    $('#sSupportEmail').value = s.supportEmail || '';
    $('#sPhone').value = s.phone || '';
    $('#sLine1').value = address.line1 || '';
    $('#sCity').value = address.city || '';
    $('#sState').value = address.state || '';
    $('#sZip').value = address.zip || '';
    $('#sCountry').value = address.country || '';
    $('#sX').value = socials.x || '';
    $('#sLinkedin').value = socials.linkedin || '';
    $('#sGithub').value = socials.github || '';
    $('#sInstagram').value = socials.instagram || '';
  }

  $('#adSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: $('#sCompanyName').value.trim(),
          legalName: $('#sLegalName').value.trim(),
          entityType: $('#sEntityType').value.trim(),
          soleMember: $('#sSoleMember').value.trim(),
          registeredState: $('#sRegisteredState').value.trim(),
          registeredDate: $('#sRegisteredDate').value,
          ein: $('#sEin').value.trim(),
          duns: $('#sDuns').value.trim(),
          tagline: $('#sTagline').value.trim(),
          copyright: $('#sCopyright').value.trim(),
          email: $('#sEmail').value.trim(),
          supportEmail: $('#sSupportEmail').value.trim(),
          phone: $('#sPhone').value.trim(),
          address: {
            line1: $('#sLine1').value.trim(),
            city: $('#sCity').value.trim(),
            state: $('#sState').value.trim(),
            zip: $('#sZip').value.trim(),
            country: $('#sCountry').value.trim(),
          },
          socials: {
            x: $('#sX').value.trim(),
            linkedin: $('#sLinkedin').value.trim(),
            github: $('#sGithub').value.trim(),
            instagram: $('#sInstagram').value.trim(),
          },
        }),
      });
      await refresh();
      toast('Settings saved');
    } catch (err) { toast(err.message, true); }
  });

  /* ---- Backup & restore -------------------------------------------------- */

  let restoreDocument = null;

  $('#adRestoreFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    const label = $('#adRestoreLabel');
    const button = $('#adRestoreBtn');

    restoreDocument = null;
    button.disabled = true;
    if (!file) { label.textContent = 'Choose a backup file (.json)'; return; }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const apps = (parsed.apps || []).length;
        const invoices = (parsed.invoices || []).length;
        // Show what is inside before anything is overwritten.
        label.textContent = `${file.name} — ${apps} app${apps === 1 ? '' : 's'}, ${invoices} invoice${invoices === 1 ? '' : 's'}`;
        restoreDocument = parsed;
        button.disabled = false;
      } catch {
        label.textContent = `${file.name} — not valid JSON`;
        toast('That file is not a valid backup.', true);
      }
    };
    reader.onerror = () => toast('Could not read that file.', true);
    reader.readAsText(file);
  });

  $('#adRestoreBtn').addEventListener('click', async () => {
    if (!restoreDocument) return;

    const apps = (restoreDocument.apps || []).length;
    const invoices = (restoreDocument.invoices || []).length;
    const ok = await confirmAction({
      title: 'Restore this backup?',
      body: `All current content will be replaced with ${apps} app(s) and ${invoices} invoice(s) `
        + 'from this file. The current version is snapshotted first.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;

    try {
      const result = await api('/restore', {
        method: 'POST',
        body: JSON.stringify({ document: restoreDocument }),
      });
      await refresh();
      toast(`Restored — ${result.summary.apps} apps, ${result.summary.invoices} invoices`);
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------------------------------------------------------------- chrome */

  $('#adMenuToggle').addEventListener('click', () => {
    $('#adSidebar').classList.add('is-open');
    const backdrop = document.createElement('div');
    backdrop.className = 'ad-backdrop';
    backdrop.addEventListener('click', () => {
      $('#adSidebar').classList.remove('is-open');
      backdrop.remove();
    });
    document.body.appendChild(backdrop);
  });

  $('#adLogout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/admin/login.html';
  });

  /* ------------------------------------------------------------------ boot */

  const refresh = async () => { state.doc = await api('/content'); };

  async function boot() {
    try {
      const me = await api('/me');
      $('#adUser').textContent = me.email;
      await refresh();
    } catch {
      return; // api() already redirected on 401
    }

    updateBadges();
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/overview';
    route();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
