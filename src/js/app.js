import { renderOverview } from './views/overview.js';
import { renderSessions } from './views/sessions.js';
import { renderTimeline } from './views/timeline.js';
import { renderModels, renderCosts, renderTools } from './views/models.js';
import { renderErrors }   from './views/errors.js';
import { renderFlow }     from './views/flow.js';
import { renderInvestigate } from './views/investigate.js';
import { renderCompare }  from './views/compare.js';
import { renderEval }     from './views/eval.js';
import { renderActivity } from './views/activity.js';
import { renderBaselines } from './views/baselines.js';
import { renderBaselineEditor } from './views/baseline-editor.js';
import { renderBaselineEnrich } from './views/baseline-enrich.js';
import { renderTest } from './views/test.js';
import { renderDeepCompare } from './views/deep-compare.js';
import { renderNetwork } from './views/network.js';
import { renderPromptAnalytics, silentRefreshPromptAnalytics } from './views/prompt-analytics.js';
import { api }            from './api.js';
import { getDateRange, initDatePicker } from './components/date-picker.js';
import { applyChartTheme } from './components/charts.js';
import { initSidebar }     from './components/sidebar.js';

// ── Theme Init ──
const root = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

function setTheme(theme) {
  root.setAttribute('data-theme', theme);
  localStorage.setItem('pq-theme', theme);
  themeIcon.textContent = theme === 'light' ? '☾' : '☼';
  applyChartTheme();
}

// Load saved theme
const savedTheme = localStorage.getItem('pq-theme') || 'dark';
setTheme(savedTheme);

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    setTheme(isLight ? 'dark' : 'light');
    navigate(); // Re-render to pick up chart color changes
  });
}

const container = document.getElementById('view-container');

// ── Routes ──
const routes = {
  overview:    (p) => renderOverview(container, getDateRange()),
  sessions:    (p) => renderSessions(container, getDateRange(), p),
  timeline:    (p) => renderTimeline(container, p.get('task')),
  errors:      (p) => renderErrors(container, getDateRange(), p),
  models:      (p) => renderModels(container, getDateRange(), p),
  costs:       (p) => renderCosts(container, getDateRange()),
  tools:       (p) => renderTools(container, getDateRange(), p),
  flow:        (p) => renderFlow(container, getDateRange()),
  investigate: (p) => renderInvestigate(container, p.get('task')),
  compare:     (p) => renderCompare(container, p.get('tasks')),
  eval:        (p) => renderEval(container, p.get('task')),
  activity:    (p) => renderActivity(container, getDateRange()),
  baselines:   (p) => renderBaselines(container),
  'baseline-editor': (p) => renderBaselineEditor(container, p.get('id')),
  'baseline-enrich': (p) => renderBaselineEnrich(container, p.get('id')),
  test:        (p) => renderTest(container, p),
  deepcompare: (p) => renderDeepCompare(container, p),
  network:     (p) => renderNetwork(container),
  'prompt-analytics': (p) => renderPromptAnalytics(container, p),
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

  const render = routes[view] || routes.overview;

  const wrapper = document.getElementById('date-range-wrapper');
  if (wrapper) document.body.appendChild(wrapper);

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
  
  Promise.resolve(render(params)).then(() => {
    initDatePicker('view-container');
  }).catch(err => {
    console.error(err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p style="color:var(--red)">Error loading view: ${err.message}</p>
        <p style="margin-top:8px;font-size:11px">Make sure the server is running on port 3456</p>
      </div>`;
  });
}

// Re-render current view when date range changes — preserve existing URL params
window.addEventListener('daterange:change', () => {
  const view = currentView();
  const queryStr = window.location.hash.split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const render = routes[view] || routes.overview;

  const wrapper = document.getElementById('date-range-wrapper');
  if (wrapper) document.body.appendChild(wrapper);

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
  Promise.resolve(render(params)).then(() => {
    initDatePicker('view-container');
  }).catch(console.error);
});

window.addEventListener('hashchange', navigate);

// ── Refresh & Auto-Refresh Controls ──
const refreshWidget = document.getElementById('refresh-widget');
const refreshBtn = document.getElementById('refresh-btn');
const refreshLabel = document.getElementById('refresh-label');
const refreshStatus = document.getElementById('refresh-status');
const autoRefreshBtn = document.getElementById('auto-refresh-toggle-btn');
const autoRefreshTimerEl = document.getElementById('auto-refresh-timer');

let isRefreshing = false;
let autoRefreshTimer = null;
let countdownVal = 10;
let isAutoRefreshActive = false;

async function executeRefresh({ isSilent = false } = {}) {
  if (isRefreshing) return;
  isRefreshing = true;

  if (refreshBtn) {
    refreshBtn.classList.add('spinning');
    if (!isSilent && refreshLabel) refreshLabel.textContent = 'Refreshing...';
  }

  try {
    await api.refresh();
    if (refreshStatus) refreshStatus.textContent = 'Scanning new tasks...';
    await pollRefresh();
    if (refreshStatus) {
      refreshStatus.textContent = isSilent ? '✓ Updated' : '✓ Done!';
      setTimeout(() => { if (refreshStatus) refreshStatus.textContent = ''; }, 3000);
    }

    const view = currentView();
    if (view === 'prompt-analytics' && typeof silentRefreshPromptAnalytics === 'function') {
      await silentRefreshPromptAnalytics();
    } else if (isSilent) {
      const queryStr = window.location.hash.split('?')[1] || '';
      const params = new URLSearchParams(queryStr);
      const render = routes[view];
      if (render) await render(params);
    } else {
      navigate();
    }
  } catch (e) {
    console.error('Refresh error:', e);
    if (refreshStatus) refreshStatus.textContent = '✕ Error: ' + e.message;
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      if (refreshLabel) refreshLabel.textContent = 'Refresh Data';
    }
    isRefreshing = false;
  }
}

refreshBtn?.addEventListener('click', () => {
  executeRefresh({ isSilent: false });
});

autoRefreshBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAutoRefresh();
});

function toggleAutoRefresh(enable = null) {
  isAutoRefreshActive = enable !== null ? enable : !isAutoRefreshActive;
  localStorage.setItem('pq_auto_refresh', isAutoRefreshActive ? 'true' : 'false');
  updateAutoRefreshUI();
  if (isAutoRefreshActive) startAutoRefresh();
  else stopAutoRefresh();
}

function updateAutoRefreshUI() {
  if (refreshWidget) refreshWidget.classList.toggle('auto-active', isAutoRefreshActive);
  if (autoRefreshBtn) autoRefreshBtn.classList.toggle('active', isAutoRefreshActive);
  if (refreshBtn) {
    const title = isAutoRefreshActive
      ? 'Refresh Data (⚡ Auto 10s Active — Click for manual scan)'
      : 'Refresh Data (Click to scan manually)';
    refreshBtn.setAttribute('title', title);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  isAutoRefreshActive = true;
  updateAutoRefreshUI();
  countdownVal = 10;
  if (autoRefreshTimerEl) autoRefreshTimerEl.textContent = '10s';

  autoRefreshTimer = setInterval(async () => {
    countdownVal--;
    if (countdownVal <= 0) {
      countdownVal = 10;
      if (autoRefreshTimerEl) autoRefreshTimerEl.textContent = '10s';
      await executeRefresh({ isSilent: true });
    } else {
      if (autoRefreshTimerEl) autoRefreshTimerEl.textContent = `${countdownVal}s`;
    }
  }, 1000);
}

function stopAutoRefresh() {
  isAutoRefreshActive = false;
  updateAutoRefreshUI();
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (autoRefreshTimerEl) autoRefreshTimerEl.textContent = '10s';
}

// Load saved auto-refresh state
const savedAutoRefresh = localStorage.getItem('pq_auto_refresh') === 'true';
if (savedAutoRefresh) {
  startAutoRefresh();
}

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
initSidebar();
navigate();
