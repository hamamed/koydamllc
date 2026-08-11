/* ==========================================================================
   apps.js — portfolio grid with platform filtering and search.
   The full published list is fetched once; filtering happens client-side so
   the interaction stays instant. The URL carries ?platform= so filtered
   views are linkable.
   ========================================================================== */

(async () => {
  'use strict';
  const { $, $$, api, esc, icons, appCard, initReveal } = KD;

  const grid   = $('#kdGrid');
  const empty  = $('#kdEmpty');
  const count  = $('#kdCount');
  const search = $('#kdSearch');

  let apps = [];
  let platform = new URLSearchParams(location.search).get('platform') || 'all';
  let query = '';

  /* ---- Data ---- */
  try {
    apps = (await api('/api/apps')).apps;
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><div class="kd-card p-5 text-center">
      <p class="kd-muted mb-0">Could not load the portfolio. Please refresh the page.</p></div></div>`;
    console.warn('[apps]', err.message);
    return;
  }

  /* ---- Render ---- */
  function render() {
    const needle = query.trim().toLowerCase();
    const visible = apps.filter((app) => {
      const byPlatform = platform === 'all' || (app.platforms || []).includes(platform);
      const byQuery = !needle ||
        [app.title, app.tagline, app.category].join(' ').toLowerCase().includes(needle);
      return byPlatform && byQuery;
    });

    grid.innerHTML = visible.map(appCard).join('');
    empty.classList.toggle('d-none', visible.length > 0);
    count.textContent = visible.length
      ? `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`
      : '';

    icons();
    initReveal(grid);
  }

  /* ---- Filters ---- */
  $$('.kd-filter').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === platform);
    button.addEventListener('click', () => {
      platform = button.dataset.filter;
      $$('.kd-filter').forEach((b) => b.classList.toggle('is-active', b === button));

      // Keep the URL shareable without adding a history entry per click.
      const url = new URL(location.href);
      if (platform === 'all') url.searchParams.delete('platform');
      else url.searchParams.set('platform', platform);
      history.replaceState(null, '', url);

      render();
    });
  });

  /* ---- Search (debounced) ---- */
  let timer;
  search.addEventListener('input', (event) => {
    clearTimeout(timer);
    const value = event.target.value;
    timer = setTimeout(() => { query = value; render(); }, 140);
  });

  $('#kdReset').addEventListener('click', () => {
    platform = 'all';
    query = '';
    search.value = '';
    $$('.kd-filter').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'all'));
    history.replaceState(null, '', location.pathname);
    render();
  });

  render();
})();
