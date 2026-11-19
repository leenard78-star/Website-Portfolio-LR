'use strict';

const state = {
  options: [],
  customers: [],
  schedules: [],
  page: 1,
  pageSize: 8,
  totalPages: 0,
  editingId: null
};

let searchTimer = null;

const elements = {
  dbStatus: document.getElementById('dbStatus'),
  setupHint: document.getElementById('setupHint'),
  brandLogo: document.querySelector('.brand-logo'),
  logoFallback: document.getElementById('logoFallback'),
  customerForm: document.getElementById('customerForm'),
  scheduleForm: document.getElementById('scheduleForm'),
  editForm: document.getElementById('editForm'),
  editDialog: document.getElementById('editDialog'),
  editIdLabel: document.getElementById('editIdLabel'),
  editEstimate: document.getElementById('editEstimate'),
  customerSelect: document.getElementById('customerSelect'),
  accommodationSelect: document.getElementById('accommodationSelect'),
  rateHint: document.getElementById('rateHint'),
  checkInDate: document.getElementById('checkInDate'),
  checkOutDate: document.getElementById('checkOutDate'),
  dateHint: document.getElementById('dateHint'),
  personCount: document.getElementById('personCount'),
  downpaymentAmount: document.getElementById('downpaymentAmount'),
  paymentStatus: document.getElementById('paymentStatus'),
  balanceHint: document.getElementById('balanceHint'),
  scheduleRows: document.getElementById('scheduleRows'),
  resultCount: document.getElementById('resultCount'),
  personSearch: document.getElementById('personSearch'),
  filterStatus: document.getElementById('filterStatus'),
  filterCustomer: document.getElementById('filterCustomer'),
  filterFrom: document.getElementById('filterFrom'),
  filterTo: document.getElementById('filterTo'),
  resetFilters: document.getElementById('resetFilters'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageLabel: document.getElementById('pageLabel'),
  cancelEdit: document.getElementById('cancelEdit'),
  toast: document.getElementById('toast'),
  statBookings: document.getElementById('statBookings'),
  statUnpaid: document.getElementById('statUnpaid'),
  statUpcoming: document.getElementById('statUpcoming'),
  statTotal: document.getElementById('statTotal'),
  statDownpayment: document.getElementById('statDownpayment'),
  statRemaining: document.getElementById('statRemaining')
};

const money = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dayValue(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(iso, amount) {
  const value = dayValue(iso) ?? dayValue('2026-11-02');
  const date = new Date(value + amount * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(iso) {
  const value = dayValue(iso);
  if (value === null) return iso || '';
  return `${WEEKDAYS[new Date(value).getUTCDay()]}, ${iso}`;
}

function isEventTier(tier) {
  return tier?.accommodationType === 'EVENT' || tier?.rateBasis === 'FLAT';
}

function rateLabel(tier) {
  if (!tier) return '';
  const amount = money.format(Number(tier.rateAmount || 0));
  return tier.rateBasis === 'FLAT' ? `${amount} flat` : `${amount}/night`;
}

function tierOptionLabel(tier) {
  return `${tier.name} · ${tier.tierName} (${rateLabel(tier)})`;
}

function selectedTier() {
  return state.options.find(
    (item) => String(item.rateTierId) === String(elements.accommodationSelect.value)
  );
}

function computeEstimate(tier, checkInDate, checkOutDate) {
  if (!tier) return 0;
  const rate = Number(tier.rateAmount || 0);
  if (isEventTier(tier)) return rate;
  const start = dayValue(checkInDate);
  const end = dayValue(checkOutDate);
  if (start === null || end === null || end <= start) return 0;
  return Math.round(((end - start) / 86400000) * rate * 100) / 100;
}

function formatRange(row) {
  if (row.bookingKind === 'EVENT_5HR') {
    return {
      main: formatDateLabel(row.checkInDate),
      sub: row.timeWindow || '5-Hour Event Window'
    };
  }
  return {
    main: `${formatDateLabel(row.checkInDate)} → ${formatDateLabel(row.checkOutDate)}`,
    sub: row.timeWindow || 'Check-in: 1:00 PM / Check-out: 11:00 AM'
  };
}

function statusClass(status) {
  if (status === 'PAID') return 'paid';
  if (status === 'DOWNPAYMENT') return 'downpayment';
  return 'unpaid';
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 3500);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Request failed (${response.status})`);
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

async function checkHealth() {
  try {
    await apiRequest('/api/health');
    elements.dbStatus.textContent = 'PostgreSQL connected';
    elements.dbStatus.classList.add('ok');
    elements.setupHint.hidden = true;
  } catch (error) {
    elements.dbStatus.textContent = 'Database unavailable';
    elements.dbStatus.classList.add('bad');
    elements.setupHint.hidden = false;
    showToast(error.message, true);
  }
}

function fillSelect(select, items, placeholder, labelKey, idKey) {
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + items
    .map((item) => `<option value="${escapeHtml(item[idKey])}">${escapeHtml(item[labelKey])}</option>`)
    .join('');
}

function syncDatesForTier() {
  const tier = selectedTier();
  if (!tier) return;
  const checkIn = elements.checkInDate.value || '2026-11-02';
  elements.checkInDate.value = checkIn;
  if (isEventTier(tier)) {
    elements.checkOutDate.value = checkIn;
  } else if (!elements.checkOutDate.value || elements.checkOutDate.value <= checkIn) {
    elements.checkOutDate.value = addDays(checkIn, 1);
  }
}

function syncPersonsForTier() {
  const tier = selectedTier();
  if (!tier) return;
  elements.personCount.max = String(tier.maxPersons);
  if (Number(elements.personCount.value) > tier.maxPersons) {
    elements.personCount.value = String(tier.maxPersons);
  }
}

function updateRateHint() {
  const tier = selectedTier();
  if (!tier) {
    elements.rateHint.textContent = 'Room rates: ₱1,499/night up to 2 persons or ₱3,499/night up to 7 persons. Exclusive event: ₱9,000 flat.';
    return;
  }
  if (isEventTier(tier)) {
    elements.rateHint.textContent = `${rateLabel(tier)} · ${tier.description}`;
    return;
  }
  elements.rateHint.textContent = `${tier.name} · ${tier.tierName}: ${rateLabel(tier)} up to ${tier.maxPersons} persons. Check-in: 1:00 PM / Check-out: 11:00 AM.`;
}

function updateDateHint() {
  const tier = selectedTier();
  const checkIn = elements.checkInDate.value;
  const checkOut = elements.checkOutDate.value;
  if (!checkIn) {
    elements.dateHint.textContent = 'Choose a date to see the exact weekday.';
    return;
  }
  if (tier && isEventTier(tier)) {
    elements.dateHint.textContent = `${formatDateLabel(checkIn)} · 5-Hour Event Window`;
    return;
  }
  const start = dayValue(checkIn);
  const end = dayValue(checkOut);
  const nights = start !== null && end !== null && end > start ? (end - start) / 86400000 : 0;
  elements.dateHint.textContent = `${formatDateLabel(checkIn)} → ${formatDateLabel(checkOut)} · ${nights} night${nights === 1 ? '' : 's'}`;
}

function updateBalanceHint() {
  const tier = selectedTier();
  const total = computeEstimate(tier, elements.checkInDate.value, elements.checkOutDate.value);
  const downpayment = Number(elements.downpaymentAmount.value || 0);
  const remaining = Math.max(total - downpayment, 0);
  elements.balanceHint.textContent = `Total estimate ${money.format(total)} · Downpayment ${money.format(downpayment)} · Remaining ${money.format(remaining)}`;
}

function syncDownpaymentForStatus() {
  const total = computeEstimate(selectedTier(), elements.checkInDate.value, elements.checkOutDate.value);
  const current = Number(elements.downpaymentAmount.value || 0);
  if (elements.paymentStatus.value === 'PAID') {
    elements.downpaymentAmount.value = String(total);
  } else if (elements.paymentStatus.value === 'UNPAID') {
    elements.downpaymentAmount.value = '0';
  } else if (current >= total && total > 0) {
    elements.downpaymentAmount.value = String(total > 1000 ? 1000 : Math.round(total / 2));
  }
}

function updateFormHints() {
  syncDatesForTier();
  syncPersonsForTier();
  updateRateHint();
  updateDateHint();
  syncDownpaymentForStatus();
  updateBalanceHint();
}

async function loadOptions() {
  const data = await apiRequest('/api/options');
  state.options = data.options;
  const tierOptions = state.options.map((tier) => ({
    rateTierId: tier.rateTierId,
    label: tierOptionLabel(tier)
  }));
  fillSelect(elements.accommodationSelect, tierOptions, 'Choose accommodation / rate tier', 'label', 'rateTierId');
  updateFormHints();
}

async function loadCustomers() {
  const data = await apiRequest('/api/customers?pageSize=100');
  state.customers = data.data;
  fillSelect(
    elements.customerSelect,
    state.customers.map((customer) => ({
      customerId: customer.customerId,
      label: `${customer.fullName} · ${customer.phone}`
    })),
    'Choose person',
    'label',
    'customerId'
  );
  fillSelect(
    elements.filterCustomer,
    state.customers.map((customer) => ({
      customerId: customer.customerId,
      label: customer.fullName
    })),
    'All persons',
    'label',
    'customerId'
  );
}

function scheduleQuery() {
  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize)
  });
  if (elements.filterStatus.value) params.set('paymentStatus', elements.filterStatus.value);
  if (elements.filterFrom.value) params.set('from', elements.filterFrom.value);
  if (elements.filterTo.value) params.set('to', elements.filterTo.value);
  if (elements.filterCustomer.value) params.set('customerId', elements.filterCustomer.value);
  const search = elements.personSearch.value.trim();
  if (search) params.set('search', search);
  return `/api/schedules?${params.toString()}`;
}

function renderRows(rows) {
  if (rows.length === 0) {
    elements.scheduleRows.innerHTML = '<tr><td colspan="9" class="empty">No persons match these filters. Try a shorter name, a phone fragment, or reset the booklet.</td></tr>';
    return;
  }
  elements.scheduleRows.innerHTML = rows.map((row) => {
    const range = formatRange(row);
    const notes = row.notes ? escapeHtml(row.notes) : '';
    const status = statusClass(row.paymentStatus);
    const stayMeta = row.bookingKind === 'EVENT_5HR'
      ? '5-hour event'
      : `${row.nights} night${row.nights === 1 ? '' : 's'}`;
    const settleButton = row.paymentStatus === 'PAID'
      ? ''
      : `<button class="button settle" type="button" data-action="settle" data-id="${row.scheduleId}">Settle Balance / Mark Paid</button>`;
    return `
      <tr>
        <td>
          <span class="person-name">${escapeHtml(row.fullName)}</span>
          <span class="person-meta">TEL ${escapeHtml(row.phone)} / #${row.scheduleId}</span>
        </td>
        <td title="${notes}">
          ${escapeHtml(row.accommodationName)}
          <span class="person-meta">${escapeHtml(row.tierName)} / ${escapeHtml(row.accommodationType)}</span>
        </td>
        <td class="date-range ${row.bookingKind === 'EVENT_5HR' ? 'event' : ''}">
          <span class="range-main">${escapeHtml(range.main)}</span>
          <span class="range-sub">${escapeHtml(range.sub)}</span>
        </td>
        <td>
          ${row.personCount} persons
          <span class="person-meta">${stayMeta}</span>
        </td>
        <td>${money.format(Number(row.totalAmount || 0))}</td>
        <td>${money.format(Number(row.downpaymentAmount || 0))}</td>
        <td>${money.format(Number(row.remainingBalance || 0))}</td>
        <td><span class="pill ${status}">${escapeHtml(row.paymentStatus)}</span></td>
        <td>
          <div class="row-actions">
            ${settleButton}
            <button class="button ghost" type="button" data-action="edit" data-id="${row.scheduleId}">Edit</button>
            <button class="button danger" type="button" data-action="delete" data-id="${row.scheduleId}">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function loadSchedules() {
  const data = await apiRequest(scheduleQuery());
  state.schedules = data.data;
  state.totalPages = data.pagination.totalPages;
  renderRows(state.schedules);
  const search = elements.personSearch.value.trim();
  elements.resultCount.textContent = search
    ? `${data.pagination.totalItems} booking(s) found for “${search}”`
    : `${data.pagination.totalItems} booking(s) found`;
  elements.pageLabel.textContent = `Page ${data.pagination.page} of ${Math.max(data.pagination.totalPages, 1)}`;
  elements.prevPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= state.totalPages;
}

async function loadSummary() {
  const data = await apiRequest('/api/schedules?pageSize=100');
  const rows = data.data;
  const today = isoDate(0);
  const awaiting = rows.filter((row) => row.paymentStatus !== 'PAID');
  const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  elements.statBookings.textContent = data.pagination.totalItems;
  elements.statUnpaid.textContent = awaiting.length;
  elements.statUpcoming.textContent = rows.filter((row) => row.checkInDate >= today).length;
  elements.statTotal.textContent = money.format(sum('totalAmount'));
  elements.statDownpayment.textContent = money.format(sum('downpaymentAmount'));
  elements.statRemaining.textContent = money.format(sum('remainingBalance'));
}

async function refresh() {
  await Promise.all([loadSchedules(), loadSummary()]);
}

function openEdit(row) {
  state.editingId = row.scheduleId;
  elements.editIdLabel.textContent = `#${row.scheduleId}`;
  elements.editEstimate.textContent = `Total estimate ${money.format(Number(row.totalAmount || 0))}`;
  const form = elements.editForm.elements;
  form.checkInDate.value = row.checkInDate;
  form.checkOutDate.value = row.checkOutDate;
  form.personCount.value = row.personCount;
  form.downpaymentAmount.value = row.downpaymentAmount;
  form.paymentStatus.value = row.paymentStatus;
  form.notes.value = row.notes || '';
  elements.editDialog.showModal();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function resetScheduleForm() {
  elements.scheduleForm.reset();
  elements.checkInDate.value = '2026-11-02';
  elements.checkOutDate.value = '2026-11-05';
  elements.personCount.value = '2';
  elements.downpaymentAmount.value = '0';
  elements.paymentStatus.value = 'UNPAID';
  updateFormHints();
}

async function handleCustomerSubmit(event) {
  event.preventDefault();
  const submitButton = elements.customerForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const created = await apiRequest('/api/customers', {
      method: 'POST',
      body: JSON.stringify(formValues(elements.customerForm))
    });
    elements.customerForm.reset();
    await refresh();
    await loadCustomers();
    elements.customerSelect.value = String(created.customerId);
    showToast(`Person ${created.fullName} saved.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleScheduleSubmit(event) {
  event.preventDefault();
  const submitButton = elements.scheduleForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await apiRequest('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(formValues(elements.scheduleForm))
    });
    resetScheduleForm();
    await refresh();
    showToast('Booking created.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleEditSubmit(event) {
  event.preventDefault();
  if (state.editingId === null) return;
  try {
    await apiRequest(`/api/schedules/${state.editingId}`, {
      method: 'PATCH',
      body: JSON.stringify(formValues(elements.editForm))
    });
    elements.editDialog.close();
    state.editingId = null;
    await refresh();
    showToast('Booking updated.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === 'settle') {
    try {
      const settled = await apiRequest(`/api/schedules/${id}/settle`, { method: 'POST' });
      await refresh();
      showToast(`Balance settled for ${settled.fullName} — marked PAID.`);
    } catch (error) {
      showToast(error.message, true);
    }
  } else if (button.dataset.action === 'edit') {
    const row = state.schedules.find((item) => String(item.scheduleId) === id);
    if (row) openEdit(row);
  } else if (button.dataset.action === 'delete') {
    if (!window.confirm(`Delete booking #${id}?`)) return;
    try {
      await apiRequest(`/api/schedules/${id}`, { method: 'DELETE' });
      await refresh();
      showToast(`Booking #${id} deleted.`);
    } catch (error) {
      showToast(error.message, true);
    }
  }
}

function handleTierChange() {
  syncDatesForTier();
  syncPersonsForTier();
  updateRateHint();
  updateDateHint();
  updateBalanceHint();
}

function handleDateChange() {
  const tier = selectedTier();
  if (tier && isEventTier(tier)) {
    elements.checkOutDate.value = elements.checkInDate.value;
  } else if (elements.checkOutDate.value <= elements.checkInDate.value) {
    elements.checkOutDate.value = addDays(elements.checkInDate.value, 1);
  }
  updateDateHint();
  updateBalanceHint();
}

function handleStatusChange() {
  syncDownpaymentForStatus();
  updateBalanceHint();
}

function handleSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadSchedules().catch((error) => showToast(error.message, true));
  }, 180);
}

function bindEvents() {
  elements.accommodationSelect.addEventListener('change', handleTierChange);
  elements.checkInDate.addEventListener('change', handleDateChange);
  elements.checkOutDate.addEventListener('change', handleDateChange);
  elements.downpaymentAmount.addEventListener('input', updateBalanceHint);
  elements.paymentStatus.addEventListener('change', handleStatusChange);
  elements.customerForm.addEventListener('submit', handleCustomerSubmit);
  elements.scheduleForm.addEventListener('submit', handleScheduleSubmit);
  elements.editForm.addEventListener('submit', handleEditSubmit);
  elements.scheduleRows.addEventListener('click', handleTableClick);
  elements.cancelEdit.addEventListener('click', () => elements.editDialog.close());

  elements.personSearch.addEventListener('input', handleSearchInput);

  [elements.filterStatus, elements.filterCustomer, elements.filterFrom, elements.filterTo]
    .forEach((input) => input.addEventListener('change', () => {
      state.page = 1;
      loadSchedules().catch((error) => showToast(error.message, true));
    }));

  elements.resetFilters.addEventListener('click', () => {
    clearTimeout(searchTimer);
    elements.personSearch.value = '';
    elements.filterStatus.value = '';
    elements.filterCustomer.value = '';
    elements.filterFrom.value = '';
    elements.filterTo.value = '';
    state.page = 1;
    loadSchedules().catch((error) => showToast(error.message, true));
  });

  elements.prevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      loadSchedules().catch((error) => showToast(error.message, true));
    }
  });

  elements.nextPage.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      loadSchedules().catch((error) => showToast(error.message, true));
    }
  });
}

async function init() {
  elements.brandLogo.addEventListener('error', () => {
    elements.brandLogo.hidden = true;
    elements.logoFallback.hidden = false;
  });

  elements.checkInDate.value = '2026-11-02';
  elements.checkOutDate.value = '2026-11-05';

  bindEvents();
  updateFormHints();
  await checkHealth();
  try {
    await loadOptions();
    await loadCustomers();
    await refresh();
  } catch (error) {
    showToast(error.message, true);
  }
}

init();
