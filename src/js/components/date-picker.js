/**
 * Global date range picker — matches PostQode dashboard style.
 * Emits a 'daterange:change' event on window when selection changes.
 *
 * KEY FIX: listeners are attached only ONCE to the persistent DOM elements.
 * initDatePicker() only handles moving the wrapper into the current top-bar.
 */

const OPTIONS = [
  { label: 'Today',          value: 'today' },
  { label: 'Yesterday',      value: 'yesterday' },
  { label: 'Last 24 hours',  value: '24h' },
  { label: 'Last 7 days',    value: '7d' },
  { label: 'Last 30 days',   value: '30d' },
  { label: 'Last 3 months',  value: '3m' },
  { label: 'Last 6 months',  value: '6m' },
  { label: 'Last 12 months', value: '12m' },
  { label: 'All Time',       value: 'all' },
];

let current  = 'all';
let isOpen   = false;
let _booted  = false;   // ensure we only wire up listeners once

export function getDateRange() {
  const now = Date.now();
  switch (current) {
    case 'today':     return { from: startOfDay(now), to: null };
    case 'yesterday': return { from: startOfDay(now - 86400000), to: startOfDay(now) };
    case '24h':       return { from: new Date(now - 86400000).toISOString(), to: null };
    case '7d':        return { from: new Date(now - 7*86400000).toISOString(), to: null };
    case '30d':       return { from: new Date(now - 30*86400000).toISOString(), to: null };
    case '3m':        return { from: new Date(now - 90*86400000).toISOString(), to: null };
    case '6m':        return { from: new Date(now - 180*86400000).toISOString(), to: null };
    case '12m':       return { from: new Date(now - 365*86400000).toISOString(), to: null };
    default:          return { from: null, to: null };
  }
}

export function getCurrentRangeLabel() {
  return OPTIONS.find(o => o.value === current)?.label || 'All Time';
}

/**
 * Called on every route change.
 * Moves the persistent date-range wrapper into whichever .top-bar is now visible.
 * Listeners are only ever attached once (_booted guard).
 */
export function initDatePicker(containerId) {
  const wrapper  = document.getElementById('date-range-wrapper');
  const btn      = document.getElementById('date-range-btn');
  const label    = document.getElementById('date-range-label');
  const dropdown = document.getElementById('date-range-dropdown');

  if (!wrapper || !btn) return;

  // Move wrapper into the new view's top-bar
  const container = document.getElementById(containerId);
  if (container) {
    const topBar = container.querySelector('.top-bar');
    if (topBar) topBar.appendChild(wrapper);
  }
  wrapper.style.display = 'flex';

  // Keep label in sync with current selection
  label.textContent = getCurrentRangeLabel();

  // Only wire up event listeners ONCE for the lifetime of the page
  if (_booted) return;
  _booted = true;

  function renderOptions() {
    dropdown.innerHTML = OPTIONS.map(o => `
      <div class="date-range-option ${o.value === current ? 'active' : ''}" data-value="${o.value}">
        <span>${o.label}</span>
        ${o.value === current ? '<span class="check">✓</span>' : ''}
      </div>
    `).join('');

    dropdown.querySelectorAll('.date-range-option').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        current = el.dataset.value;
        label.textContent = OPTIONS.find(o => o.value === current)?.label || 'All Time';
        close();
        window.dispatchEvent(new CustomEvent('daterange:change', { detail: getDateRange() }));
      });
    });
  }

  function open()  { isOpen = true;  dropdown.style.display = 'block'; btn.classList.add('open');    renderOptions(); }
  function close() { isOpen = false; dropdown.style.display = 'none';  btn.classList.remove('open'); }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (isOpen && !wrapper.contains(e.target)) close();
  });
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
