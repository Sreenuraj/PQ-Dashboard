import { api } from '../api.js';

// ── Helpers ──
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function methodClass(m) {
  const map = { GET: 'green', POST: 'blue', PUT: 'yellow', PATCH: 'yellow', DELETE: 'red', OPTIONS: 'grey', HEAD: 'grey' };
  return map[(m || '').toUpperCase()] || 'grey';
}

function statusClass(code) {
  if (!code || code === 0) return 'red';
  if (code < 300) return 'green';
  if (code < 400) return 'blue';
  if (code < 500) return 'yellow';
  return 'red';
}

function tagLabel(tag) {
  const labels = {
    postqode: 'PostQode',
    openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', cohere: 'Cohere',
    mistral: 'Mistral', groq: 'Groq', deepseek: 'DeepSeek', together: 'Together',
    fireworks: 'Fireworks', github: 'GitHub', copilot: 'Copilot', other: 'Other',
  };
  return labels[tag] || tag || 'Other';
}

function tagColorClass(tag) {
  const map = {
    postqode: 'accent',
    openai: 'green', anthropic: 'purple', google: 'blue', cohere: 'cyan',
    mistral: 'yellow', groq: 'accent', copilot: 'cyan', github: 'grey',
  };
  return map[tag] || 'grey';
}

function prettyJson(str) {
  if (!str) return '';
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

function syntaxHighlight(json) {
  if (!json) return '';
  return escHtml(json)
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "(.*?)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

function truncateUrl(url, maxLen = 80) {
  if (!url) return '';
  // Remove protocol
  let clean = url.replace(/^https?:\/\//, '');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '…';
}

// ── State ──
let ws = null;
let isRecording = true;
let requests = [];
let selectedRequest = null;
let activeFilters = { host: 'all', method: '', status: '', search: '', limit: 'all' };
let activeDetailTab = 'headers';

// ── WebSocket ──
function connectWebSocket(onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/network`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateStatusDot(true);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'request' && isRecording) {
        onMessage(msg.data);
      }
    } catch (e) {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    updateStatusDot(false);
    // Reconnect after delay
    setTimeout(() => connectWebSocket(onMessage), 3000);
  };

  ws.onerror = () => {
    updateStatusDot(false);
  };
}

function disconnectWebSocket() {
  if (ws) {
    ws.onclose = null; // Prevent reconnect
    ws.close();
    ws = null;
  }
}

function updateStatusDot(connected) {
  const dot = document.getElementById('network-status-dot');
  const label = document.getElementById('network-status-label');
  if (dot) {
    dot.className = `network-status-dot ${connected ? 'connected' : 'disconnected'}`;
  }
  if (label) {
    label.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

// ── Render ──
export async function renderNetwork(container) {
  // Cleanup previous WebSocket
  disconnectWebSocket();
  requests = [];
  selectedRequest = null;
  isRecording = true;

  // Fetch initial status
  let status = { running: false, port: 3457, count: 0 };
  try {
    status = await api.networkStatus();
  } catch (e) {
    // Proxy might not be running yet
  }

  const setupDismissed = localStorage.getItem('pq-network-setup-dismissed') === 'true';

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Network Inspector</h1>
      <p class="view-subtitle">Live HTTP/HTTPS traffic capture from PostQode via MITM proxy</p>
    </div>

    <!-- Setup Instructions -->
    <div id="network-setup-card" class="panel network-setup ${setupDismissed ? 'dismissed' : ''}" style="${setupDismissed ? 'display:none' : ''}">
      <div class="panel-title">
        <span>📡 Setup Required — Configure VS Code to route traffic through the proxy</span>
        <button id="dismiss-setup-btn" class="action-btn secondary" style="padding:2px 8px;min-height:auto;font-size:10px">Hide</button>
      </div>
      <div class="panel-body">
        <div class="network-setup-steps">
          <div class="setup-step">
            <div class="setup-step-num">1</div>
            <div class="setup-step-content">
              <strong>Open VS Code Settings</strong>
              <p>Press <code>Cmd + ,</code> (or <code>Ctrl + ,</code> on Windows/Linux)</p>
            </div>
          </div>
          <div class="setup-step">
            <div class="setup-step-num">2</div>
            <div class="setup-step-content">
              <strong>Set HTTP Proxy</strong>
              <p>Search for <code>http.proxy</code> and set value to:</p>
              <div class="setup-code-block">
                <code id="proxy-url-value">http://localhost:${status.port || 3457}</code>
                <button id="copy-proxy-url" class="setup-copy-btn" title="Copy">📋</button>
              </div>
            </div>
          </div>
          <div class="setup-step">
            <div class="setup-step-num">3</div>
            <div class="setup-step-content">
              <strong>Disable Strict SSL</strong>
              <p>Search for <code>http.proxyStrictSSL</code> and <strong>uncheck</strong> it (set to <code>false</code>)</p>
            </div>
          </div>
          <div class="setup-step">
            <div class="setup-step-num">4</div>
            <div class="setup-step-content">
              <strong>Configure Proxy Bypass</strong>
              <p>Search for <code>http.noProxy</code> and add: <code>localhost, 127.0.0.1</code> to prevent proxying local IPC</p>
            </div>
          </div>
          <div class="setup-step" style="grid-column: span 2;">
            <div class="setup-step-num">5</div>
            <div class="setup-step-content" style="width: 100%;">
              <strong>Handle Extension Auth & TLS Trust (Required)</strong>
              <p>Many extensions (and VS Code login services) run in processes that ignore strict SSL configurations, causing handshake errors (alert 46) or logging you out. Use one of these solutions:</p>
              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 10px;">
                <div>
                  <span style="font-size: 10px; color: var(--text-3); font-weight: bold; display: block;">Option A: Bypass Proxy for Authentication (Simplest, keeps login working)</span>
                  <p style="margin: 4px 0; font-size: 11px;">Add <code>"api.postqode.ai"</code> (or other auth domain) to your <code>"http.noProxy"</code> setting in VS Code. It will bypass the proxy for account sync/auth while still capturing direct AI calls (OpenAI, Anthropic, etc.).</p>
                </div>
                <div>
                  <span style="font-size: 10px; color: var(--text-3); font-weight: bold; display: block;">Option B: Trust CA Certificate in macOS System (Recommended, proxies everything)</span>
                  <p style="margin: 4px 0 6px 0; font-size: 11px;">Add the proxy CA certificate to your macOS System Keychain to trust it globally for all processes (including Electron/VS Code main process):</p>
                  <div class="setup-code-block" style="margin-top: 4px;">
                    <code id="macos-trust-cmd-value" style="word-break: break-all;">sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${status.ca_cert_path || ''}"</code>
                    <button id="copy-macos-trust-cmd" class="setup-copy-btn" title="Copy">📋</button>
                  </div>
                  <p style="margin: 6px 0 0 0; font-size: 10px; color: var(--text-3);">Or double-click the certificate file at the path above, open it in macOS <strong>Keychain Access</strong>, double-click the certificate under Certificates, expand <strong>Trust</strong>, and set <strong>Always Trust</strong>.</p>
                </div>
                <div>
                  <span style="font-size: 10px; color: var(--text-3); font-weight: bold; display: block;">Option C: Launch VS Code with Node Certificate Trust (Terminal option)</span>
                  <p style="margin: 4px 0 6px 0; font-size: 11px;">If you don't want to install it globally, launch VS Code from your terminal instructing Node.js to trust the certificate:</p>
                  <div class="setup-code-block" style="margin-top: 4px;">
                    <code id="env-var-secure-value" style="word-break: break-all;">NODE_EXTRA_CA_CERTS="${status.ca_cert_path || ''}" code</code>
                    <button id="copy-env-var-secure" class="setup-copy-btn" title="Copy">📋</button>
                  </div>
                </div>
                <div>
                  <span style="font-size: 10px; color: var(--text-3); font-weight: bold; display: block;">Option D: Ignore Validation (Quick local bypass)</span>
                  <div class="setup-code-block" style="margin-top: 4px;">
                    <code id="env-var-easy-value" style="word-break: break-all;">NODE_TLS_REJECT_UNAUTHORIZED=0 code</code>
                    <button id="copy-env-var-easy" class="setup-copy-btn" title="Copy">📋</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="setup-step">
            <div class="setup-step-num">6</div>
            <div class="setup-step-content">
              <strong>Restart VS Code</strong>
              <p>Close and launch VS Code using one of the Options above for interception to work.</p>
            </div>
          </div>
        </div>
        <div class="setup-json-block">
          <p style="font-size:11px;color:var(--text-3);margin-bottom:6px">Or paste this into your <code>settings.json</code>:</p>
          <pre class="setup-json-pre"><code id="settings-json-value">{
  "http.proxy": "http://localhost:${status.port || 3457}",
  "http.proxyStrictSSL": false,
  "http.noProxy": [
    "localhost",
    "127.0.0.1",
    "api.postqode.ai"
  ]
}</code></pre>
          <button id="copy-settings-json" class="setup-copy-btn" title="Copy JSON" style="position:absolute;top:8px;right:8px">📋</button>
        </div>
      </div>
    </div>
    ${setupDismissed ? `<button id="show-setup-btn" class="action-btn secondary" style="margin-bottom:14px;padding:4px 10px;min-height:auto;font-size:11px">📡 Show Setup Instructions</button>` : ''}

    <!-- Toolbar -->
    <div class="panel network-toolbar-panel">
      <div class="panel-body" style="padding:10px 14px">
        <div class="network-toolbar">
          <div class="network-toolbar-controls">
            <button id="network-record-btn" class="network-control-btn recording" title="Recording">
              <span class="record-dot"></span>
            </button>
            <button id="network-clear-btn" class="network-control-btn" title="Clear">🗑</button>
            <button id="network-export-btn" class="network-control-btn" title="Export HAR">📥</button>
            <div class="network-toolbar-divider"></div>
            <div class="network-status-indicator">
              <span id="network-status-dot" class="network-status-dot disconnected"></span>
              <span id="network-status-label" class="network-status-text">Connecting…</span>
            </div>
            <span id="network-request-count" class="network-count-badge">0 requests</span>
          </div>
          <div class="network-toolbar-filters">
            <input id="network-search" type="text" class="filter-input network-search-input" placeholder="Filter by URL, host, or method…" />
            <select id="network-method-filter" class="filter-select">
              <option value="">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="OPTIONS">OPTIONS</option>
            </select>
            <select id="network-status-filter" class="filter-select">
              <option value="">All Status</option>
              <option value="2xx">2xx Success</option>
              <option value="3xx">3xx Redirect</option>
              <option value="4xx">4xx Client Error</option>
              <option value="5xx">5xx Server Error</option>
              <option value="0">Failed / Error</option>
            </select>
            <select id="network-limit-filter" class="filter-select">
              <option value="all">All Requests</option>
              <option value="5">Last 5</option>
              <option value="10">Last 10</option>
              <option value="15">Last 15</option>
            </select>
          </div>
        </div>
        <div class="network-domain-chips" id="network-domain-chips">
          <button class="network-chip active" data-tag="all">All</button>
          <button class="network-chip" data-tag="postqode">PostQode</button>
          <button class="network-chip" data-tag="openai">OpenAI</button>
          <button class="network-chip" data-tag="anthropic">Anthropic</button>
          <button class="network-chip" data-tag="google">Google</button>
          <button class="network-chip" data-tag="copilot">Copilot</button>
          <button class="network-chip" data-tag="github">GitHub</button>
          <button class="network-chip" data-tag="other">Other</button>
        </div>
      </div>
    </div>

    <!-- Request Table + Detail Split -->
    <div class="network-content">
      <div class="panel network-table-panel">
        <div class="table-wrap">
          <table class="data-table network-table" id="network-request-table">
            <thead>
              <tr>
                <th style="width:44px">#</th>
                <th style="width:62px">Method</th>
                <th>URL</th>
                <th style="width:60px">Status</th>
                <th style="width:50px">Tag</th>
                <th style="width:68px">Size</th>
                <th style="width:72px">Time</th>
                <th style="width:64px">When</th>
              </tr>
            </thead>
            <tbody id="network-request-tbody">
              <tr><td colspan="8" class="network-empty-row">
                <div class="empty-state" style="padding:40px 20px;min-height:auto">
                  <div class="icon">📡</div>
                  <p>Waiting for network requests…</p>
                  <p style="margin-top:6px;font-size:11px;color:var(--text-3)">
                    Make sure VS Code is configured to use the proxy and PostQode is active.
                  </p>
                </div>
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel (hidden until a request is selected) -->
      <div id="network-detail-panel" class="panel network-detail-panel" style="display:none">
        <div class="panel-title" style="padding:8px 14px">
          <span id="network-detail-title">Request Detail</span>
          <button id="network-detail-close" class="network-control-btn" title="Close" style="font-size:12px">✕</button>
        </div>
        <div class="network-detail-tabs">
          <button class="network-detail-tab active" data-tab="headers">Headers</button>
          <button class="network-detail-tab" data-tab="request">Request</button>
          <button class="network-detail-tab" data-tab="response">Response</button>
          <button class="network-detail-tab" data-tab="timing">Timing</button>
        </div>
        <div id="network-detail-body" class="network-detail-body"></div>
      </div>
    </div>
  `;

  // ── Bind Events ──
  renderChips();
  bindToolbarEvents(status);
  bindChipEvents();
  bindTableEvents();

  // Connect WebSocket and start receiving
  connectWebSocket((record) => {
    addRequest(record);
  });

  // Load any existing buffered requests
  try {
    const { requests: buffered } = await api.networkRequests({ limit: 200 });
    if (buffered && buffered.length) {
      requests = buffered.reverse(); // oldest first
      renderTable();
    }
  } catch (e) {
    // OK if no requests yet
  }
}

// ── Toolbar Events ──
function bindToolbarEvents(status) {
  // Record/Pause
  const recordBtn = document.getElementById('network-record-btn');
  recordBtn?.addEventListener('click', () => {
    isRecording = !isRecording;
    recordBtn.classList.toggle('recording', isRecording);
    recordBtn.title = isRecording ? 'Recording' : 'Paused';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: isRecording ? 'resume' : 'pause' }));
    }
  });

  // Clear
  document.getElementById('network-clear-btn')?.addEventListener('click', async () => {
    requests = [];
    selectedRequest = null;
    renderTable();
    hideDetail();
    try { await api.networkClear(); } catch (e) {}
    updateRequestCount();
  });

  // Export HAR
  document.getElementById('network-export-btn')?.addEventListener('click', () => {
    window.open('/api/network/export', '_blank');
  });

  // Search
  let searchTimer = null;
  document.getElementById('network-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      activeFilters.search = e.target.value;
      renderChips();
      renderTable();
    }, 200);
  });

  // Method filter
  document.getElementById('network-method-filter')?.addEventListener('change', (e) => {
    activeFilters.method = e.target.value;
    renderTable();
  });

  // Status filter
  document.getElementById('network-status-filter')?.addEventListener('change', (e) => {
    activeFilters.status = e.target.value;
    renderTable();
  });

  // Limit filter
  document.getElementById('network-limit-filter')?.addEventListener('change', (e) => {
    activeFilters.limit = e.target.value;
    renderTable();
  });

  // Setup dismiss
  document.getElementById('dismiss-setup-btn')?.addEventListener('click', () => {
    localStorage.setItem('pq-network-setup-dismissed', 'true');
    const card = document.getElementById('network-setup-card');
    if (card) card.style.display = 'none';
    // Add show button
    card?.insertAdjacentHTML('afterend', `<button id="show-setup-btn" class="action-btn secondary" style="margin-bottom:14px;padding:4px 10px;min-height:auto;font-size:11px">📡 Show Setup Instructions</button>`);
    document.getElementById('show-setup-btn')?.addEventListener('click', showSetup);
  });

  document.getElementById('show-setup-btn')?.addEventListener('click', showSetup);

  // Copy buttons
  document.getElementById('copy-proxy-url')?.addEventListener('click', () => {
    const val = document.getElementById('proxy-url-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('copy-proxy-url');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
    });
  });

  document.getElementById('copy-settings-json')?.addEventListener('click', () => {
    const val = document.getElementById('settings-json-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('copy-settings-json');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
    });
  });

  document.getElementById('copy-env-var-easy')?.addEventListener('click', () => {
    const val = document.getElementById('env-var-easy-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('copy-env-var-easy');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
    });
  });

  document.getElementById('copy-env-var-secure')?.addEventListener('click', () => {
    const val = document.getElementById('env-var-secure-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('copy-env-var-secure');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
    });
  });

  document.getElementById('copy-macos-trust-cmd')?.addEventListener('click', () => {
    const val = document.getElementById('macos-trust-cmd-value')?.textContent || '';
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('copy-macos-trust-cmd');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
    });
  });
}

function showSetup() {
  localStorage.removeItem('pq-network-setup-dismissed');
  const card = document.getElementById('network-setup-card');
  if (card) { card.style.display = ''; card.classList.remove('dismissed'); }
  const showBtn = document.getElementById('show-setup-btn');
  if (showBtn) showBtn.remove();
}

function renderChips() {
  const container = document.getElementById('network-domain-chips');
  if (!container) return;

  const defaultChips = [
    { tag: 'all', label: 'All' },
    { tag: 'postqode', label: 'PostQode' },
    { tag: 'openai', label: 'OpenAI' },
    { tag: 'anthropic', label: 'Anthropic' },
    { tag: 'google', label: 'Google' },
    { tag: 'copilot', label: 'Copilot' },
    { tag: 'github', label: 'GitHub' },
    { tag: 'other', label: 'Other' }
  ];

  let html = defaultChips.map(c => {
    const isActive = activeFilters.host === c.tag;
    return `<button class="network-chip ${isActive ? 'active' : ''}" data-tag="${c.tag}">${escHtml(c.label)}</button>`;
  }).join('');

  if (activeFilters.search) {
    html += `
      <button class="network-chip active custom-filter-chip" title="Click to clear filter" style="border-color:var(--accent);background:var(--accent-glow);color:var(--text);display:flex;align-items:center;gap:6px">
        <span>Filter: "${escHtml(activeFilters.search)}"</span>
        <span style="font-weight:bold;color:var(--text-3);cursor:pointer;padding:0 2px">&times;</span>
      </button>
    `;
  }

  container.innerHTML = html;
}

// ── Domain Chip Events ──
function bindChipEvents() {
  document.getElementById('network-domain-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.network-chip');
    if (!chip) return;

    if (chip.classList.contains('custom-filter-chip')) {
      const searchInput = document.getElementById('network-search');
      if (searchInput) searchInput.value = '';
      activeFilters.search = '';
      renderChips();
      renderTable();
      return;
    }

    activeFilters.host = chip.dataset.tag || 'all';
    renderChips();
    renderTable();
  });
}

// Helper to remove any open context menu
function removeContextMenu() {
  const existing = document.getElementById('network-context-menu');
  if (existing) {
    existing.remove();
  }
}

// ── Table Events ──
function bindTableEvents() {
  document.getElementById('network-request-tbody')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-req-id]');
    if (!row) return;
    const id = parseInt(row.dataset.reqId);
    selectedRequest = requests.find(r => r.id === id) || null;
    if (selectedRequest) {
      showDetail(selectedRequest);
      // Highlight selected row
      document.querySelectorAll('.network-table tbody tr').forEach(tr => tr.classList.remove('selected'));
      row.classList.add('selected');
    }
  });

  document.getElementById('network-request-tbody')?.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('tr[data-req-id]');
    if (!row) return;
    e.preventDefault();

    const id = parseInt(row.dataset.reqId, 10);
    const record = requests.find(r => r.id === id);
    if (!record) return;

    removeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'network-context-menu';
    menu.className = 'network-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // Option 1: Replay Request
    const replayOption = document.createElement('div');
    replayOption.className = 'network-context-menu-item';
    replayOption.innerHTML = `🔁 <span>Replay Request</span>`;
    replayOption.addEventListener('click', async () => {
      try {
        await api.networkReplay(record.id);
      } catch (err) {
        console.error('Failed to replay request:', err.message);
      }
    });

    // Option 2: Filter by path
    const pathOption = document.createElement('div');
    pathOption.className = 'network-context-menu-item';
    pathOption.innerHTML = `🔍 <span>Filter by path: <b>${escHtml(record.path)}</b></span>`;
    pathOption.addEventListener('click', () => {
      const searchInput = document.getElementById('network-search');
      if (searchInput) {
        searchInput.value = record.path;
        activeFilters.search = record.path;
        renderTable();
      }
    });

    // Option 3: Filter by host
    const hostOption = document.createElement('div');
    hostOption.className = 'network-context-menu-item';
    hostOption.innerHTML = `🌐 <span>Filter by host: <b>${escHtml(record.host)}</b></span>`;
    hostOption.addEventListener('click', () => {
      const searchInput = document.getElementById('network-search');
      if (searchInput) {
        searchInput.value = record.host;
        activeFilters.search = record.host;
        renderTable();
      }
    });

    // Option 4: Copy URL
    const copyOption = document.createElement('div');
    copyOption.className = 'network-context-menu-item';
    copyOption.innerHTML = `📋 <span>Copy URL</span>`;
    copyOption.addEventListener('click', () => {
      navigator.clipboard.writeText(record.url);
    });

    menu.appendChild(replayOption);
    menu.appendChild(document.createElement('div')).className = 'network-context-menu-divider';
    menu.appendChild(pathOption);
    menu.appendChild(hostOption);
    menu.appendChild(document.createElement('div')).className = 'network-context-menu-divider';
    menu.appendChild(copyOption);

    document.body.appendChild(menu);

    // Reposition menu if it goes off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    const dismissListener = () => {
      removeContextMenu();
      document.removeEventListener('click', dismissListener);
      document.removeEventListener('contextmenu', dismissListener);
      window.removeEventListener('resize', dismissListener);
    };

    setTimeout(() => {
      document.addEventListener('click', dismissListener);
      document.addEventListener('contextmenu', dismissListener);
      window.addEventListener('resize', dismissListener);
    }, 10);
  });

  // Detail tabs
  document.querySelector('.network-detail-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.network-detail-tab');
    if (!tab) return;
    document.querySelectorAll('.network-detail-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeDetailTab = tab.dataset.tab;
    if (selectedRequest) renderDetailContent(selectedRequest);
  });

  // Close detail
  document.getElementById('network-detail-close')?.addEventListener('click', hideDetail);
}

// ── Add a request ──
function addRequest(record) {
  requests.push(record);
  if (requests.length > 500) {
    requests.shift();
  }
  renderTable();
}

function passesFilters(r) {
  if (activeFilters.host && activeFilters.host !== 'all') {
    if ((r.tag || '').toLowerCase() !== activeFilters.host.toLowerCase() &&
        !(r.host || '').toLowerCase().includes(activeFilters.host.toLowerCase())) {
      return false;
    }
  }
  if (activeFilters.method) {
    if ((r.method || '').toUpperCase() !== activeFilters.method.toUpperCase()) return false;
  }
  if (activeFilters.status) {
    if (activeFilters.status === '0') {
      if (r.statusCode && r.statusCode !== 0) return false;
    } else {
      const prefix = activeFilters.status.charAt(0);
      if (String(r.statusCode || '').charAt(0) !== prefix) return false;
    }
  }
  if (activeFilters.search) {
    const q = activeFilters.search.toLowerCase();
    if (!(r.url || '').toLowerCase().includes(q) &&
        !(r.host || '').toLowerCase().includes(q) &&
        !(r.method || '').toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

// ── Render full table ──
function renderTable() {
  const tbody = document.getElementById('network-request-tbody');
  if (!tbody) return;

  const filtered = requests.filter(passesFilters);
  updateRequestCount();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="network-empty-row">
      <div class="empty-state" style="padding:40px 20px;min-height:auto">
        <div class="icon">📡</div>
        <p>${requests.length > 0 ? 'No requests match current filters' : 'Waiting for network requests…'}</p>
      </div>
    </td></tr>`;
    return;
  }

  // Newest first
  let sorted = [...filtered].reverse();

  // Set dynamic max-height on the container wrapper based on selected limit
  const tableWrap = document.querySelector('.network-table-panel .table-wrap');
  if (tableWrap) {
    if (activeFilters.limit && activeFilters.limit !== 'all') {
      const lim = parseInt(activeFilters.limit, 10);
      if (!isNaN(lim)) {
        // Header height is ~32px, each row is ~35px.
        const calculatedHeight = 32 + (lim * 35);
        tableWrap.style.maxHeight = `${calculatedHeight}px`;
      }
    } else {
      tableWrap.style.maxHeight = '380px'; // default fallback max-height
    }
  }

  tbody.innerHTML = sorted.map(r => `<tr data-req-id="${r.id}"${selectedRequest?.id === r.id ? ' class="selected"' : ''}>${renderRow(r)}</tr>`).join('');
}

function renderRow(r) {
  return `
    <td class="mono" style="color:var(--text-3);font-size:10px">${r.id}</td>
    <td>
      <span class="badge ${methodClass(r.method)}">${escHtml(r.method)}</span>
      ${r.isReplay ? `<span class="badge grey" style="font-size:8px;padding:1px 3px;margin-left:4px" title="Replayed request (Replayed from #${r.replayedFromId})">REPLAY</span>` : ''}
    </td>
    <td class="network-url-cell" title="${escHtml(r.url)}">
      <span class="mono">${escHtml(truncateUrl(r.url))}</span>
    </td>
    <td><span class="badge ${statusClass(r.statusCode)}">${r.statusCode || 'ERR'}</span></td>
    <td><span class="badge ${tagColorClass(r.tag)}" style="font-size:9px">${escHtml(tagLabel(r.tag))}</span></td>
    <td class="mono" style="font-size:10.5px">${fmtBytes(r.size)}</td>
    <td class="mono" style="font-size:10.5px">${fmtDuration(r.duration)}</td>
    <td class="mono" style="font-size:10px;color:var(--text-3)">${fmtTime(r.timestamp)}</td>
  `;
}

function updateRequestCount() {
  const countEl = document.getElementById('network-request-count');
  if (countEl) {
    const filtered = requests.filter(passesFilters);
    countEl.textContent = `${filtered.length} / ${requests.length} requests`;
  }
}

// ── Detail Panel ──
function showDetail(record) {
  const panel = document.getElementById('network-detail-panel');
  if (!panel) return;
  panel.style.display = '';

  const title = document.getElementById('network-detail-title');
  if (title) {
    title.innerHTML = `<span class="badge ${methodClass(record.method)}">${escHtml(record.method)}</span> <span class="mono" style="font-size:11px">${escHtml(truncateUrl(record.url, 60))}</span>`;
  }

  renderDetailContent(record);
}

function hideDetail() {
  const panel = document.getElementById('network-detail-panel');
  if (panel) panel.style.display = 'none';
  selectedRequest = null;
  document.querySelectorAll('.network-table tbody tr').forEach(tr => tr.classList.remove('selected'));
}

function renderDetailContent(record) {
  const body = document.getElementById('network-detail-body');
  if (!body) return;

  switch (activeDetailTab) {
    case 'headers':
      body.innerHTML = renderHeadersTab(record);
      break;
    case 'request':
      body.innerHTML = renderBodyTab(record.requestBody, 'Request Body');
      break;
    case 'response':
      body.innerHTML = renderBodyTab(record.responseBody, 'Response Body');
      break;
    case 'timing':
      body.innerHTML = renderTimingTab(record);
      break;
  }
}

function renderHeadersTab(r) {
  return `
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">General</h4>
      <div class="network-kv-table">
        <div class="network-kv-row"><span class="network-kv-key">Request URL</span><span class="network-kv-val mono">${escHtml(r.url)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Method</span><span class="network-kv-val"><span class="badge ${methodClass(r.method)}">${escHtml(r.method)}</span></span></div>
        <div class="network-kv-row"><span class="network-kv-key">Status Code</span><span class="network-kv-val"><span class="badge ${statusClass(r.statusCode)}">${r.statusCode || 'Error'}</span>${r.error ? ` <span style="color:var(--red);font-size:11px">${escHtml(r.error)}</span>` : ''}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Host</span><span class="network-kv-val mono">${escHtml(r.host)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Tag</span><span class="network-kv-val"><span class="badge ${tagColorClass(r.tag)}">${escHtml(tagLabel(r.tag))}</span></span></div>
      </div>
    </div>
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">Request Headers</h4>
      <div class="network-kv-table">
        ${Object.entries(r.requestHeaders || {}).map(([k, v]) => `
          <div class="network-kv-row"><span class="network-kv-key mono">${escHtml(k)}</span><span class="network-kv-val mono">${escHtml(typeof v === 'string' ? v : JSON.stringify(v))}</span></div>
        `).join('') || '<div class="network-kv-row" style="color:var(--text-3)">No request headers</div>'}
      </div>
    </div>
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">Response Headers</h4>
      <div class="network-kv-table">
        ${Object.entries(r.responseHeaders || {}).map(([k, v]) => `
          <div class="network-kv-row"><span class="network-kv-key mono">${escHtml(k)}</span><span class="network-kv-val mono">${escHtml(typeof v === 'string' ? v : JSON.stringify(v))}</span></div>
        `).join('') || '<div class="network-kv-row" style="color:var(--text-3)">No response headers</div>'}
      </div>
    </div>
  `;
}

function renderBodyTab(bodyStr, label) {
  if (!bodyStr) {
    return `<div class="empty-state" style="padding:30px;min-height:auto"><p>No ${label.toLowerCase()}</p></div>`;
  }

  const pretty = prettyJson(bodyStr);
  const highlighted = syntaxHighlight(pretty);

  return `
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">${escHtml(label)}</h4>
      <pre class="network-body-pre">${highlighted}</pre>
    </div>
  `;
}

function renderTimingTab(r) {
  const total = r.duration || 0;
  return `
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">Timing</h4>
      <div class="network-timing-bar-group">
        <div class="network-timing-row">
          <span class="network-timing-label">Total Duration</span>
          <div class="network-timing-bar-wrap">
            <div class="network-timing-bar" style="width:100%;background:var(--accent)"></div>
          </div>
          <span class="network-timing-value mono">${fmtDuration(total)}</span>
        </div>
        <div class="network-timing-row">
          <span class="network-timing-label">Response Size</span>
          <div class="network-timing-bar-wrap">
            <div class="network-timing-bar" style="width:${Math.min(100, (r.size || 0) / 1024)}%;background:var(--blue)"></div>
          </div>
          <span class="network-timing-value mono">${fmtBytes(r.size)}</span>
        </div>
      </div>
    </div>
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">Request Info</h4>
      <div class="network-kv-table">
        <div class="network-kv-row"><span class="network-kv-key">Timestamp</span><span class="network-kv-val mono">${escHtml(r.timestamp)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Duration</span><span class="network-kv-val mono">${fmtDuration(r.duration)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Response Size</span><span class="network-kv-val mono">${fmtBytes(r.size)}</span></div>
        ${r.error ? `<div class="network-kv-row"><span class="network-kv-key" style="color:var(--red)">Error</span><span class="network-kv-val" style="color:var(--red)">${escHtml(r.error)}</span></div>` : ''}
      </div>
    </div>
  `;
}
