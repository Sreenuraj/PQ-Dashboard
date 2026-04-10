import { renderOverview } from './views/overview.js';
import { renderSessions } from './views/sessions.js';
import { renderTimeline } from './views/timeline.js';
import { renderModels, renderCosts, renderTools } from './views/models.js';
import { renderFlow }     from './views/flow.js';
import { api }            from './api.js';
import { getDateRange, initDatePicker } from './components/date-picker.js';

const container = document.getElementById('view-container');

// ── Routes ──
const routes = {
  overview: (p) => renderOverview(container, getDateRange()),
  sessions: (p) => renderSessions(container, getDateRange()),
  timeline: (p) => renderTimeline(container, p.get('task')),
  errors:   (p) => renderErrors(container, getDateRange()),
  models:   (p) => renderModels(container, getDateRange()),
  costs:    (p) => renderCosts(container, getDateRange()),
  tools:    (p) => renderTools(container, getDateRange()),
  flow:     (p) => renderFlow(container, getDateRange()),
};

function currentView() {
  return window.location.hash.replace('#/', '').split('?')[0] || 'overview';
}

function navigate() {
  const view = currentView();
  const queryStr = window.location.hash.split('?')[1] || '';
  const params = new URLSearchParams(queryStr);

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  // Init date picker in new view's top-bar
  setTimeout(() => initDatePicker('view-container'), 50);

  const render = routes[view] || routes.overview;

  const wrapper = document.getElementById('date-range-wrapper');
  if (wrapper) document.body.appendChild(wrapper);

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
  render(params).catch(err => {
    console.error(err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p style="color:var(--red)">Error loading view: ${err.message}</p>
        <p style="margin-top:8px;font-size:11px">Make sure the server is running on port 3456</p>
      </div>`;
  });
}

// Re-render current view when date range changes
window.addEventListener('daterange:change', () => {
  const view = currentView();
  const render = routes[view] || routes.overview;

  const wrapper = document.getElementById('date-range-wrapper');
  if (wrapper) document.body.appendChild(wrapper);

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
  render(new URLSearchParams()).then(() => {
    setTimeout(() => initDatePicker('view-container'), 50);
  }).catch(console.error);
});

window.addEventListener('hashchange', navigate);

// ── Refresh button ──
const refreshBtn    = document.getElementById('refresh-btn');
const refreshLabel  = document.getElementById('refresh-label');
const refreshStatus = document.getElementById('refresh-status');

refreshBtn?.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  refreshLabel.textContent = 'Refreshing...';
  refreshStatus.textContent = '';

  try {
    await api.refresh();
    refreshStatus.textContent = 'Scanning new tasks...';
    await pollRefresh();
    refreshStatus.textContent = '✓ Done!';
    refreshLabel.textContent = 'Refresh Data';
    setTimeout(() => { refreshStatus.textContent = ''; }, 4000);
    navigate(); // re-render current view with fresh data
  } catch (e) {
    refreshStatus.textContent = '✕ Error: ' + e.message;
    refreshLabel.textContent = 'Refresh Data';
  } finally {
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
});

async function pollRefresh() {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 800));
    try {
      const { parsing } = await fetch('/api/refresh/status').then(r => r.json());
      if (!parsing) return;
    } catch { break; }
  }
}

// ── Init ──
navigate();
