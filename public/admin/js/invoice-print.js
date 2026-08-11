/* ==========================================================================
   invoice-print.js — renders one archived invoice as a printable document.

   Reads ?id= from the URL and pulls the record from the admin API (the page
   itself is behind the admin gate). Everything shown comes from the stored
   invoice, never from a recomputation — an issued invoice must always print
   exactly the figures it was issued with.
   ========================================================================== */

(async () => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const id = new URLSearchParams(location.search).get('id');
  const show = (sel) => $(sel).classList.remove('d-none');
  const hide = (sel) => $(sel).classList.add('d-none');

  const fail = (message) => {
    hide('#ivLoading');
    $('#ivError').textContent = message;
    show('#ivError');
    if (window.lucide) window.lucide.createIcons();
  };

  if (!id) return fail('No invoice was specified.');

  let data;
  try {
    const res = await fetch(`/api/admin/invoices/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = '/admin/login.html'; return; }
    if (!res.ok) throw new Error('not found');
    data = await res.json();
  } catch {
    return fail('That invoice could not be found.');
  }

  const { invoice, company = {}, settings = {} } = data;

  /* ---------------------------------------------------------- helpers */

  const fmt = (amount) => {
    const code = (invoice.currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount) || 0);
    } catch {
      return `${code} ${(Number(amount) || 0).toFixed(2)}`;
    }
  };

  const fmtDate = (value) => {
    if (!value) return '—';
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? value
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  /** Joins address parts into printable lines, skipping anything empty. */
  const addressLines = (a = {}) => [
    a.line1,
    [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    a.country,
  ].filter(Boolean);

  /* ------------------------------------------------------------ header */

  if (settings.logo) $('#ivLogo').src = settings.logo;
  $('#ivLogo').alt = company.companyName || 'Koydam LLC';

  $('#ivIssuer').innerHTML = [
    `<strong>${esc(company.legalName || company.companyName || 'Koydam LLC')}</strong>`,
    ...addressLines(company.address).map(esc),
    company.email ? esc(company.email) : '',
    company.phone ? esc(company.phone) : '',
  ].filter(Boolean).join('<br>');

  const overdue = invoice.dueDate
    && !['paid', 'cancelled'].includes(invoice.status)
    && new Date(`${invoice.dueDate}T23:59:59`) < new Date();

  const metaRows = [
    ['Invoice no.', invoice.number],
    ['Issue date', fmtDate(invoice.issueDate)],
    ['Due date', invoice.dueDate ? fmtDate(invoice.dueDate) : '—'],
    invoice.poNumber ? ['PO / ref.', invoice.poNumber] : null,
    ['Status', overdue && invoice.status === 'sent' ? 'Overdue' : invoice.status],
  ].filter(Boolean);

  $('#ivMeta').innerHTML = metaRows
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(String(value).replace(/^./, (c) => c.toUpperCase()))}</dd></div>`)
    .join('');

  /* ----------------------------------------------------------- parties */

  const client = invoice.client || {};
  $('#ivClient').innerHTML = [
    `<strong>${esc(client.company || client.name || '—')}</strong>`,
    client.company && client.name ? esc(client.name) : '',
    ...addressLines(client.address).map(esc),
    client.email ? esc(client.email) : '',
    client.phone ? esc(client.phone) : '',
    client.taxId ? `Tax ID: ${esc(client.taxId)}` : '',
  ].filter(Boolean).join('<br>');

  $('#ivAmountDue').textContent = invoice.status === 'paid' ? fmt(0) : fmt(invoice.total);

  const dueNote = $('#ivDueNote');
  if (invoice.status === 'paid') {
    dueNote.textContent = `Paid in full — ${fmt(invoice.total)}`;
  } else if (invoice.status === 'cancelled') {
    dueNote.textContent = 'This invoice has been cancelled.';
  } else if (overdue) {
    dueNote.textContent = `Overdue since ${fmtDate(invoice.dueDate)}`;
    dueNote.classList.add('is-overdue');
  } else if (invoice.dueDate) {
    dueNote.textContent = `Due ${fmtDate(invoice.dueDate)}`;
  }

  /* ------------------------------------------------------------- items */

  const items = invoice.items || [];
  $('#ivItems').innerHTML = items.length
    ? items.map((item) => `
        <tr>
          <td>${esc(item.description)}</td>
          <td class="num">${esc(item.quantity)}</td>
          <td class="num">${esc(fmt(item.unitPrice))}</td>
          <td class="num">${esc(fmt(item.amount))}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="color:var(--kd-faint)">No line items.</td></tr>`;

  /* ------------------------------------------------------------ totals */

  const totalRows = [
    ['Subtotal', fmt(invoice.subtotal)],
    invoice.discount ? ['Discount', `− ${fmt(invoice.discount)}`] : null,
    invoice.taxRate ? [`${invoice.taxLabel || 'Tax'} (${invoice.taxRate}%)`, fmt(invoice.taxAmount)] : null,
  ].filter(Boolean);

  $('#ivTotals').innerHTML = `
    ${totalRows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
    <div class="is-grand"><dt>Total ${esc((invoice.currency || 'USD').toUpperCase())}</dt><dd>${esc(fmt(invoice.total))}</dd></div>`;

  /* ------------------------------------------------------- notes/footer */

  const fillBlock = (blockSel, textSel, value) => {
    if (!value) return;
    $(textSel).textContent = value;
    show(blockSel);
  };
  fillBlock('#ivNotesBlock', '#ivNotes', invoice.notes);
  fillBlock('#ivTermsBlock', '#ivTerms', invoice.paymentTerms);
  fillBlock('#ivBankBlock', '#ivBank', invoice.bankDetails);

  $('#ivFooterNote').textContent = settings.footerNote || '';
  $('#ivFooterLegal').textContent = [
    company.legalName || company.companyName,
    addressLines(company.address).join(', '),
    company.email,
  ].filter(Boolean).join(' · ');

  /* ----------------------------------------------------------- chrome */

  // Drafts and cancelled invoices are stamped so a printout can't be mistaken
  // for a final document.
  if (['draft', 'cancelled'].includes(invoice.status)) {
    $('#ivWatermark').textContent = invoice.status;
    show('#ivWatermark');
  }

  document.title = `Invoice ${invoice.number} — ${client.company || client.name || 'Koydam LLC'}`;
  $('#ivToolbarLabel').textContent = `${invoice.number} · ${client.company || client.name || ''}`;
  $('#ivEditLink').href = `/admin/#/invoices/${invoice.id}`;

  hide('#ivLoading');
  show('#ivSheet');
  if (window.lucide) window.lucide.createIcons();
})();
