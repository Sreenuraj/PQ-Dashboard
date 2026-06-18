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
  let clean = url.replace(/^https?:\/\//, '');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '…';
}

function getParsedOrRawBody(bodyStr) {
  if (!bodyStr) return null;
  try {
    return JSON.parse(bodyStr);
  } catch {
    return bodyStr;
  }
}

function generateCurl(r) {
  let cmd = `curl -X ${r.method} "${r.url}"`;
  
  if (r.requestHeaders) {
    Object.entries(r.requestHeaders).forEach(([name, val]) => {
      const safeVal = String(val).replace(/"/g, '\\"');
      cmd += ` \\\n  -H "${name}: ${safeVal}"`;
    });
  }
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    let bodyData = typeof parsed === 'object' ? JSON.stringify(parsed) : parsed;
    const safeBody = String(bodyData).replace(/"/g, '\\"');
    cmd += ` \\\n  -d "${safeBody}"`;
  }
  
  return cmd;
}

function generateNodeFetch(r) {
  const headers = { ...r.requestHeaders };
  delete headers['host'];
  delete headers['connection'];
  delete headers['content-length'];
  delete headers['accept-encoding'];

  let code = `const response = await fetch("${r.url}", {\n`;
  code += `  method: "${r.method}",\n`;
  code += `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`;
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    const bodyStr = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : `\`${parsed}\``;
    code += `,\n  body: ${bodyStr.replace(/\n/g, '\n  ')}`;
  }
  code += `\n});\nconst data = await response.json();\nconsole.log(data);`;
  return code;
}

function generateBrowserFetch(r) {
  const headers = { ...r.requestHeaders };
  delete headers['host'];
  delete headers['connection'];
  
  let code = `fetch("${r.url}", {\n`;
  code += `  method: "${r.method}",\n`;
  code += `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`;
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    const bodyStr = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : `\`${parsed}\``;
    code += `,\n  body: ${bodyStr.replace(/\n/g, '\n  ')}`;
  }
  code += `\n})\n.then(res => res.json())\n.then(data => console.log(data));`;
  return code;
}

function sortObjectKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted = {};
  Object.keys(obj).sort().forEach(k => {
    sorted[k] = sortObjectKeys(obj[k]);
  });
  return sorted;
}

function getPrettified(val) {
  if (!val) return '';
  try {
    const obj = JSON.parse(val);
    return JSON.stringify(obj, null, 2);
  } catch {
    return val;
  }
}

function diffLines(lines1, lines2) {
  const n = lines1.length;
  const m = lines2.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n;
  let j = m;
  const diff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      diff.unshift({ type: 'unchanged', left: lines1[i - 1], right: lines2[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'added', left: null, right: lines2[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'removed', left: lines1[i - 1], right: null });
      i--;
    }
  }
  return diff;
}

function calculateUsageAndCost(r) {
  if (!r.responseBody) return null;

  let reqJson = null;
  let resJson = null;
  
  try { reqJson = JSON.parse(r.requestBody); } catch {}
  try { resJson = JSON.parse(r.responseBody); } catch {}
  
  if (!resJson) return null;

  // Extract model name
  const model = reqJson?.model || resJson?.model || '';
  if (!model) return null;

  // Extract token counts
  let inputTokens = 0;
  let outputTokens = 0;
  
  if (resJson.usage) {
    inputTokens = resJson.usage.prompt_tokens || resJson.usage.input_tokens || 0;
    outputTokens = resJson.usage.completion_tokens || resJson.usage.output_tokens || 0;
  } else if (resJson.usageMetadata) {
    inputTokens = resJson.usageMetadata.promptTokenCount || 0;
    outputTokens = resJson.usageMetadata.candidatesTokenCount || 0;
  }

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) return null;

  // Simple pricing database (Rates per 1M tokens in USD)
  let inputRate = 1.0; // fallback $1.00 / 1M
  let outputRate = 3.0; // fallback $3.00 / 1M
  const m = model.toLowerCase();

  if (m.includes('gpt-4o-mini')) {
    inputRate = 0.15;
    outputRate = 0.60;
  } else if (m.includes('gpt-4o')) {
    inputRate = 5.00;
    outputRate = 15.00;
  } else if (m.includes('o1-mini')) {
    inputRate = 3.00;
    outputRate = 12.00;
  } else if (m.includes('o1-')) {
    inputRate = 15.00;
    outputRate = 60.00;
  } else if (m.includes('gpt-4')) {
    inputRate = 10.00;
    outputRate = 30.00;
  } else if (m.includes('gpt-3.5')) {
    inputRate = 0.50;
    outputRate = 1.50;
  } else if (m.includes('claude-3-5-sonnet') || m.includes('claude-3.5-sonnet')) {
    inputRate = 3.00;
    outputRate = 15.00;
  } else if (m.includes('claude-3-opus')) {
    inputRate = 15.00;
    outputRate = 75.00;
  } else if (m.includes('claude-3-haiku')) {
    inputRate = 0.25;
    outputRate = 1.25;
  } else if (m.includes('gemini-1.5-flash')) {
    inputRate = 0.075;
    outputRate = 0.30;
  } else if (m.includes('gemini-1.5-pro')) {
    inputRate = 1.25;
    outputRate = 5.00;
  } else if (m.includes('deepseek')) {
    inputRate = 0.14;
    outputRate = 0.28;
  }

  const cost = (inputTokens * inputRate / 1000000) + (outputTokens * outputRate / 1000000);

  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    cost
  };
}

// ── State ──
let ws = null;
let isRecording = true;
let requests = [];
let selectedRequest = null;
let activeFilters = { host: 'all', method: '', status: '', search: '', limit: 'all' };
let activeDetailTab = 'headers';
let mockRulesState = [];
let compareBaseRequest = null;

// ── Intercept State ──
let interceptEnabled = false;
let interceptFilters = [];
let pendingIntercepts = [];  // { id, method, url, host, path, requestHeaders, requestBody, tag, timestamp, elapsed }
let interceptElapsedTimer = null;
let editingIntercept = null; // currently editing intercept request

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
      } else if (msg.type === 'intercepted') {
        handleInterceptedRequest(msg.data);
      } else if (msg.type === 'intercept_resolved') {
        handleInterceptResolved(msg.data);
      } else if (msg.type === 'intercept_timeout') {
        handleInterceptTimeout(msg.data);
      } else if (msg.type === 'intercept_state_changed') {
        handleInterceptStateChanged(msg.data);
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
  if (interceptElapsedTimer) {
    clearInterval(interceptElapsedTimer);
    interceptElapsedTimer = null;
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

async function loadMockRulesState() {
  try {
    mockRulesState = await api.networkMocks();
    renderMocksList();
  } catch (err) {
    console.error('Failed to load mock rules:', err);
  }
}

function renderMocksList() {
  const listEl = document.getElementById('mock-rules-list');
  if (!listEl) return;

  if (mockRulesState.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-3); font-size: 11px;">
        No mock rules defined. Click "+ Add Rule" to create one.
      </div>
    `;
    return;
  }

  listEl.innerHTML = mockRulesState.map(rule => {
    return `
      <div class="mock-rule-row" data-rule-id="${rule.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 6px;">
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; overflow: hidden; margin-right: 12px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="badge ${rule.enabled ? 'green' : 'grey'} mock-toggle-btn" style="font-size: 9px; cursor: pointer;" title="Click to toggle rule">
              ${rule.enabled ? 'Active' : 'Disabled'}
            </span>
            ${rule.method ? `<span class="badge blue" style="font-size: 9px;">${escHtml(rule.method)}</span>` : '<span class="badge grey" style="font-size: 9px;">ANY</span>'}
            <span class="mono" style="font-size: 11px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" title="${escHtml(rule.urlPattern)}">
              ${escHtml(rule.urlPattern)}
            </span>
          </div>
          <div style="font-size: 10px; color: var(--text-3);">
            Returns Status: <strong style="color:var(--text-2)">${rule.statusCode || 200}</strong> 
            ${rule.delay ? `| Delay: <strong style="color:var(--text-2)">${rule.delay}ms</strong>` : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="action-btn secondary mock-edit-btn" style="padding: 2px 6px; min-height: auto; font-size: 10px;">Edit</button>
          <button class="action-btn secondary mock-delete-btn" style="padding: 2px 6px; min-height: auto; font-size: 10px; border-color: var(--red); color: var(--red);">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateCompareBanner() {
  const banner = document.getElementById('network-compare-banner');
  const baseIdEl = document.getElementById('compare-base-id');
  const baseUrlEl = document.getElementById('compare-base-url');

  if (!banner) return;

  if (compareBaseRequest) {
    baseIdEl.textContent = compareBaseRequest.id;
    baseUrlEl.textContent = truncateUrl(compareBaseRequest.url, 50);
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function openCompareModal(baseReq, compareReq) {
  const diffModal = document.getElementById('network-diff-modal');
  if (!diffModal) return;

  document.getElementById('diff-base-info').textContent = `#${baseReq.id} - ${baseReq.method} ${truncateUrl(baseReq.url, 40)}`;
  document.getElementById('diff-compare-info').textContent = `#${compareReq.id} - ${compareReq.method} ${truncateUrl(compareReq.url, 40)}`;

  // Default to request body tab
  document.querySelectorAll('.network-diff-tab').forEach(btn => {
    if (btn.dataset.diffTab === 'request') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  diffModal.style.display = 'flex';
  renderDiffContent(baseReq, compareReq, 'request');
}

function renderDiffContent(baseReq, compareReq, tab) {
  const leftPane = document.getElementById('diff-pane-left');
  const rightPane = document.getElementById('diff-pane-right');
  if (!leftPane || !rightPane) return;

  let baseStr = '';
  let compareStr = '';

  if (tab === 'request') {
    baseStr = getPrettified(baseReq.requestBody);
    compareStr = getPrettified(compareReq.requestBody);
  } else if (tab === 'response') {
    baseStr = getPrettified(baseReq.responseBody);
    compareStr = getPrettified(compareReq.responseBody);
  } else if (tab === 'headers') {
    const headers1 = {
      request: baseReq.requestHeaders || {},
      response: baseReq.responseHeaders || {}
    };
    const headers2 = {
      request: compareReq.requestHeaders || {},
      response: compareReq.responseHeaders || {}
    };
    const sorted1 = sortObjectKeys(headers1);
    const sorted2 = sortObjectKeys(headers2);
    baseStr = JSON.stringify(sorted1, null, 2);
    compareStr = JSON.stringify(sorted2, null, 2);
  }

  const lines1 = baseStr.split('\n');
  const lines2 = compareStr.split('\n');
  const diff = diffLines(lines1, lines2);

  let leftHtml = '';
  let rightHtml = '';

  let leftLineNum = 1;
  let rightLineNum = 1;

  diff.forEach(item => {
    if (item.type === 'unchanged') {
      leftHtml += `
        <div class="diff-line diff-line-unchanged">
          <span class="diff-line-num">${leftLineNum++}</span>
          <span class="diff-line-text">${escHtml(item.left)}</span>
        </div>
      `;
      rightHtml += `
        <div class="diff-line diff-line-unchanged">
          <span class="diff-line-num">${rightLineNum++}</span>
          <span class="diff-line-text">${escHtml(item.right)}</span>
        </div>
      `;
    } else if (item.type === 'removed') {
      leftHtml += `
        <div class="diff-line diff-line-removed">
          <span class="diff-line-num">${leftLineNum++}</span>
          <span class="diff-line-text">${escHtml(item.left)}</span>
        </div>
      `;
      rightHtml += `
        <div class="diff-line diff-line-empty">
          <span class="diff-line-num"></span>
          <span class="diff-line-text"></span>
        </div>
      `;
    } else if (item.type === 'added') {
      leftHtml += `
        <div class="diff-line diff-line-empty">
          <span class="diff-line-num"></span>
          <span class="diff-line-text"></span>
        </div>
      `;
      rightHtml += `
        <div class="diff-line diff-line-added">
          <span class="diff-line-num">${rightLineNum++}</span>
          <span class="diff-line-text">${escHtml(item.right)}</span>
        </div>
      `;
    }
  });

  leftPane.innerHTML = leftHtml;
  rightPane.innerHTML = rightHtml;
  leftPane.scrollTop = 0;
  rightPane.scrollTop = 0;
}

function bindMockAndDiffEvents() {
  // --- Mock Rules Panel ---
  const mocksBtn = document.getElementById('network-mocks-btn');
  const mocksPanel = document.getElementById('network-mocks-panel');
  const addMockBtn = document.getElementById('add-mock-rule-btn');
  const formContainer = document.getElementById('mock-rules-form-container');
  const cancelMockBtn = document.getElementById('cancel-mock-rule-btn');
  const saveMockBtn = document.getElementById('save-mock-rule-btn');
  const listEl = document.getElementById('mock-rules-list');

  // Toggle Panel
  mocksBtn?.addEventListener('click', () => {
    const isHidden = mocksPanel.style.display === 'none';
    mocksPanel.style.display = isHidden ? '' : 'none';
    if (isHidden) {
      loadMockRulesState();
    }
  });

  // Toggle Form
  addMockBtn?.addEventListener('click', () => {
    const isHidden = formContainer.style.display === 'none';
    if (isHidden) {
      document.getElementById('mock-form-id').value = '';
      document.getElementById('mock-form-method').value = '';
      document.getElementById('mock-form-pattern').value = '';
      document.getElementById('mock-form-status').value = '200';
      document.getElementById('mock-form-delay').value = '0';
      document.getElementById('mock-form-body').value = '';
      document.getElementById('mock-form-enabled').checked = true;
      formContainer.style.display = '';
    } else {
      formContainer.style.display = 'none';
    }
  });

  // Cancel Form
  cancelMockBtn?.addEventListener('click', () => {
    formContainer.style.display = 'none';
  });

  // Save Rule
  saveMockBtn?.addEventListener('click', async () => {
    const id = document.getElementById('mock-form-id').value || ('mock_' + Date.now());
    const method = document.getElementById('mock-form-method').value;
    const urlPattern = document.getElementById('mock-form-pattern').value.trim();
    const statusCode = parseInt(document.getElementById('mock-form-status').value, 10) || 200;
    const delay = parseInt(document.getElementById('mock-form-delay').value, 10) || 0;
    const responseBody = document.getElementById('mock-form-body').value;
    const enabled = document.getElementById('mock-form-enabled').checked;

    if (!urlPattern) {
      alert('URL Pattern is required');
      return;
    }

    const rule = { id, method, urlPattern, statusCode, delay, responseBody, enabled };
    try {
      await api.networkSaveMock(rule);
      formContainer.style.display = 'none';
      await loadMockRulesState();
    } catch (err) {
      console.error('Failed to save mock rule:', err);
      alert('Failed to save mock rule: ' + err.message);
    }
  });

  // List Actions via Event Delegation
  listEl?.addEventListener('click', async (e) => {
    const row = e.target.closest('.mock-rule-row');
    if (!row) return;
    const ruleId = row.dataset.ruleId;
    const rule = mockRulesState.find(r => r.id === ruleId);
    if (!rule) return;

    if (e.target.classList.contains('mock-toggle-btn')) {
      rule.enabled = !rule.enabled;
      try {
        await api.networkSaveMock(rule);
        await loadMockRulesState();
      } catch (err) {
        console.error('Failed to toggle mock rule:', err);
      }
    } else if (e.target.classList.contains('mock-edit-btn')) {
      document.getElementById('mock-form-id').value = rule.id;
      document.getElementById('mock-form-method').value = rule.method || '';
      document.getElementById('mock-form-pattern').value = rule.urlPattern || '';
      document.getElementById('mock-form-status').value = rule.statusCode || '200';
      document.getElementById('mock-form-delay').value = rule.delay || '0';
      document.getElementById('mock-form-body').value = rule.responseBody || '';
      document.getElementById('mock-form-enabled').checked = rule.enabled;
      formContainer.style.display = '';
    } else if (e.target.classList.contains('mock-delete-btn')) {
      if (confirm('Are you sure you want to delete this mock rule?')) {
        try {
          await api.networkDeleteMock(ruleId);
          await loadMockRulesState();
        } catch (err) {
          console.error('Failed to delete mock rule:', err);
        }
      }
    }
  });

  // --- Diff Comparison Modal ---
  const diffModal = document.getElementById('network-diff-modal');
  const closeDiffBtn = document.getElementById('close-diff-modal-btn');
  const clearCompareBtn = document.getElementById('clear-compare-btn');

  // Clear base request selection
  clearCompareBtn?.addEventListener('click', () => {
    compareBaseRequest = null;
    updateCompareBanner();
  });

  // Close Diff Modal
  closeDiffBtn?.addEventListener('click', () => {
    diffModal.style.display = 'none';
  });

  // Diff Tabs
  document.querySelector('.network-diff-modal-tabs')?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.network-diff-tab');
    if (!tabBtn) return;

    document.querySelectorAll('.network-diff-tab').forEach(btn => btn.classList.remove('active'));
    tabBtn.classList.add('active');

    const activeDiffTab = tabBtn.dataset.diffTab;
    const baseText = document.getElementById('diff-base-info').textContent;
    const compareText = document.getElementById('diff-compare-info').textContent;
    
    const baseId = parseInt(baseText.match(/#(\d+)/)?.[1] || 0);
    const compareId = parseInt(compareText.match(/#(\d+)/)?.[1] || 0);

    const baseReq = requests.find(r => r.id === baseId);
    const compareReq = requests.find(r => r.id === compareId);

    if (baseReq && compareReq) {
      renderDiffContent(baseReq, compareReq, activeDiffTab);
    }
  });
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
            <button id="network-mocks-btn" class="network-control-btn" title="Mock Rules" style="font-size: 13px;">⚙️</button>
            <button id="network-intercept-btn" class="network-control-btn" title="Request Breakpoints" style="font-size: 13px;">🛑</button>
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

    <!-- Mock Rules Manager Panel (hidden by default) -->
    <div id="network-mocks-panel" class="panel network-mocks-panel" style="display: none; border-top: 2px solid var(--accent); margin-bottom: 14px;">
      <div class="panel-title" style="padding: 8px 14px;">
        <span>⚙️ Mock Rules Manager — Intercept and hijack proxy requests</span>
        <button id="add-mock-rule-btn" class="action-btn primary" style="padding: 2px 8px; min-height: auto; font-size: 10px;">+ Add Rule</button>
      </div>
      <div class="panel-body" style="padding: 12px 14px;">
        <div id="mock-rules-form-container" style="display: none; margin-bottom: 12px; padding: 12px; background: var(--bg-3); border-radius: var(--radius-sm); border: 1px solid var(--border);">
          <h4 style="margin-bottom: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-2);">Add / Edit Mock Rule</h4>
          <input type="hidden" id="mock-form-id" />
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px;">
            <div>
              <label class="mono" style="font-size: 10px; color: var(--text-3); display: block; margin-bottom: 4px;">Method</label>
              <select id="mock-form-method" class="filter-select" style="width: 100%;">
                <option value="">ANY</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div style="grid-column: span 2;">
              <label class="mono" style="font-size: 10px; color: var(--text-3); display: block; margin-bottom: 4px;">URL Pattern (Match Substring)</label>
              <input type="text" id="mock-form-pattern" class="filter-input" placeholder="e.g. api.openai.com/v1" style="width: 100%;" />
            </div>
            <div>
              <label class="mono" style="font-size: 10px; color: var(--text-3); display: block; margin-bottom: 4px;">Status Code</label>
              <input type="number" id="mock-form-status" class="filter-input" value="200" placeholder="e.g. 200, 429" style="width: 100%;" />
            </div>
            <div>
              <label class="mono" style="font-size: 10px; color: var(--text-3); display: block; margin-bottom: 4px;">Delay (ms)</label>
              <input type="number" id="mock-form-delay" class="filter-input" value="0" placeholder="e.g. 1500" style="width: 100%;" />
            </div>
            <div style="display: flex; align-items: center; margin-top: 18px;">
              <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2);">
                <input type="checkbox" id="mock-form-enabled" checked /> Enabled
              </label>
            </div>
          </div>
          <div style="margin-bottom: 10px;">
            <label class="mono" style="font-size: 10px; color: var(--text-3); display: block; margin-bottom: 4px;">Mock Response Body (JSON / Text)</label>
            <textarea id="mock-form-body" class="filter-input mono" placeholder='e.g. { "error": "rate limit exceeded" }' style="width: 100%; height: 80px; font-size: 11px; font-family: var(--font-mono); resize: vertical;"></textarea>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="save-mock-rule-btn" class="action-btn primary" style="padding: 4px 12px; min-height: auto; font-size: 11px;">Save Rule</button>
            <button id="cancel-mock-rule-btn" class="action-btn secondary" style="padding: 4px 12px; min-height: auto; font-size: 11px;">Cancel</button>
          </div>
        </div>
        <div id="mock-rules-list" class="network-kv-table" style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
          <!-- Mock rules render here -->
        </div>
      </div>
    </div>

    <!-- Intercept / Breakpoint Panel (hidden by default) -->
    <div id="network-intercept-panel" class="panel network-intercept-panel" style="display: none;">
      <div class="panel-title" style="padding: 8px 14px;">
        <div class="intercept-header-row">
          <span>🛑 Request Breakpoints — Intercept, Edit & Forward Requests</span>
          <label class="intercept-toggle" title="Enable/Disable Intercept Mode">
            <input type="checkbox" id="intercept-enabled-toggle" />
            <span class="intercept-toggle-slider"></span>
          </label>
          <span id="intercept-pending-count" class="intercept-pending-badge empty">0 Pending</span>
        </div>
        <button id="intercept-forward-all-btn" class="intercept-action-btn forward-all" style="display: none;">✅ Forward All</button>
      </div>
      <div class="panel-body" style="padding: 12px 14px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <input type="text" id="intercept-filter-input" class="filter-input" placeholder="Add URL filter pattern (e.g. api.openai.com)…" style="flex: 1; min-width: 180px;" />
          <button id="intercept-add-filter-btn" class="action-btn secondary" style="padding: 4px 10px; min-height: auto; font-size: 11px;">+ Add Filter</button>
        </div>
        <div id="intercept-filter-chips" class="intercept-filters" style="display: none;"></div>
        <div id="intercept-pending-queue" class="intercept-pending-queue">
          <div class="intercept-empty-state">No intercepted requests. Enable intercept mode and send requests through the proxy.</div>
        </div>
      </div>
    </div>

    <!-- Request Table + Detail Split -->
    <div class="network-content">
      <div class="panel network-table-panel">
        <div id="network-compare-banner" class="network-compare-banner" style="display:none; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--accent-glow); border-bottom:1px solid var(--accent); font-size:12px; color:var(--text); border-radius: var(--radius-sm) var(--radius-sm) 0 0;">
          <span>📊 Comparing with Request <strong>#<span id="compare-base-id"></span></strong>: <span id="compare-base-url" class="mono" style="font-size:11px"></span></span>
          <button id="clear-compare-btn" class="action-btn secondary" style="padding:2px 8px; min-height:auto; font-size:10px">Clear</button>
        </div>
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

    <!-- Diff Comparison Modal -->
    <div id="network-diff-modal" class="network-diff-modal" style="display:none;">
      <div class="network-diff-modal-content">
        <div class="network-diff-modal-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <h3 style="margin:0; font-size:15px; color:var(--text)">Compare Requests</h3>
            <div class="network-diff-modal-tabs">
              <button class="network-diff-tab active" data-diff-tab="request">Request Body</button>
              <button class="network-diff-tab" data-diff-tab="response">Response Body</button>
              <button class="network-diff-tab" data-diff-tab="headers">Headers</button>
            </div>
          </div>
          <button id="close-diff-modal-btn" class="network-control-btn" style="font-size:14px">✕</button>
        </div>
        <div class="network-diff-modal-subheader">
          <div class="diff-header-left">
            <strong>Base Request:</strong> <span id="diff-base-info" class="mono" style="font-size:11px"></span>
          </div>
          <div class="diff-header-right">
            <strong>Compare Request:</strong> <span id="diff-compare-info" class="mono" style="font-size:11px"></span>
          </div>
        </div>
        <div class="network-diff-modal-body">
          <div class="network-diff-container">
            <div class="network-diff-pane" id="diff-pane-left"></div>
            <div class="network-diff-pane" id="diff-pane-right"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Intercept Edit Modal -->
    <div id="intercept-edit-modal" class="intercept-edit-modal" style="display: none;">
      <div class="intercept-edit-content">
        <div class="intercept-edit-header">
          <h3>✏️ Edit Intercepted Request <span id="intercept-edit-id" class="mono" style="font-size:11px; color:var(--text-3)"></span></h3>
          <button id="intercept-edit-close" class="network-control-btn" style="font-size:14px">✕</button>
        </div>
        <div class="intercept-edit-body">
          <div class="intercept-edit-section">
            <span class="intercept-edit-label">Method & URL</span>
            <div class="intercept-edit-row">
              <select id="intercept-edit-method" class="filter-select" style="flex: 0 0 100px;">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option>
                <option value="HEAD">HEAD</option>
              </select>
              <input type="text" id="intercept-edit-url" class="filter-input" placeholder="Request URL" />
            </div>
          </div>
          <div class="intercept-edit-section">
            <span class="intercept-edit-label">Request Headers</span>
            <div id="intercept-edit-headers" class="intercept-kv-editor"></div>
            <button id="intercept-edit-add-header" class="intercept-kv-add">+ Add Header</button>
          </div>
          <div class="intercept-edit-section">
            <span class="intercept-edit-label">Request Body</span>
            <textarea id="intercept-edit-body" class="intercept-edit-textarea" placeholder="Request body (JSON or text)..."></textarea>
          </div>
        </div>
        <div class="intercept-edit-footer">
          <button id="intercept-edit-cancel" class="action-btn secondary" style="padding: 6px 14px; min-height: auto; font-size: 12px;">Cancel</button>
          <button id="intercept-edit-send" class="action-btn primary" style="padding: 6px 14px; min-height: auto; font-size: 12px;">✏️ Send Modified</button>
        </div>
      </div>
    </div>
  `;

  // ── Bind Events ──
  renderChips();
  bindToolbarEvents(status);
  bindChipEvents();
  bindTableEvents();
  bindMockAndDiffEvents();
  bindInterceptEvents();
  updateCompareBanner();
  loadMockRulesState();
  loadInterceptState();

  // Connect WebSocket and start receiving
  connectWebSocket((record) => {
    addRequest(record);
  });

  // Start elapsed timer for pending intercepts
  interceptElapsedTimer = setInterval(() => {
    pendingIntercepts.forEach(p => { p.elapsed = Date.now() - new Date(p.timestamp).getTime(); });
    renderInterceptPendingQueue();
  }, 1000);

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

    // Option 5: Copy as cURL
    const copyCurlOption = document.createElement('div');
    copyCurlOption.className = 'network-context-menu-item';
    copyCurlOption.innerHTML = `💻 <span>Copy as cURL</span>`;
    copyCurlOption.addEventListener('click', () => {
      navigator.clipboard.writeText(generateCurl(record));
    });

    // Option 6: Copy as Node Fetch
    const copyNodeFetchOption = document.createElement('div');
    copyNodeFetchOption.className = 'network-context-menu-item';
    copyNodeFetchOption.innerHTML = `🟢 <span>Copy as Node Fetch</span>`;
    copyNodeFetchOption.addEventListener('click', () => {
      navigator.clipboard.writeText(generateNodeFetch(record));
    });

    // Option 7: Copy as Browser Fetch
    const copyBrowserFetchOption = document.createElement('div');
    copyBrowserFetchOption.className = 'network-context-menu-item';
    copyBrowserFetchOption.innerHTML = `🌐 <span>Copy as Browser Fetch</span>`;
    copyBrowserFetchOption.addEventListener('click', () => {
      navigator.clipboard.writeText(generateBrowserFetch(record));
    });

    // Option 8: Select for Comparison
    const selectCompareOption = document.createElement('div');
    selectCompareOption.className = 'network-context-menu-item';
    selectCompareOption.innerHTML = `📊 <span>Select for Comparison</span>`;
    selectCompareOption.addEventListener('click', () => {
      compareBaseRequest = record;
      updateCompareBanner();
    });

    // Option 9: Compare with Selected
    let compareOption = null;
    if (compareBaseRequest && compareBaseRequest.id !== record.id) {
      compareOption = document.createElement('div');
      compareOption.className = 'network-context-menu-item';
      compareOption.innerHTML = `⚔️ <span>Compare with #${compareBaseRequest.id}</span>`;
      compareOption.addEventListener('click', () => {
        openCompareModal(compareBaseRequest, record);
      });
    }

    menu.appendChild(replayOption);
    menu.appendChild(document.createElement('div')).className = 'network-context-menu-divider';
    menu.appendChild(pathOption);
    menu.appendChild(hostOption);
    menu.appendChild(document.createElement('div')).className = 'network-context-menu-divider';
    menu.appendChild(copyOption);
    menu.appendChild(copyCurlOption);
    menu.appendChild(copyNodeFetchOption);
    menu.appendChild(copyBrowserFetchOption);
    menu.appendChild(document.createElement('div')).className = 'network-context-menu-divider';
    menu.appendChild(selectCompareOption);
    if (compareOption) {
      menu.appendChild(compareOption);
    }

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
  // Determine intercept badge
  let interceptBadge = '';
  if (r.isIntercepted) {
    if (r.interceptAction === 'drop') {
      interceptBadge = `<span class="badge dropped" style="margin-left:4px" title="Dropped by breakpoint">DROPPED</span>`;
    } else if (r.interceptAction === 'edited') {
      interceptBadge = `<span class="badge intercepted" style="margin-left:4px" title="Edited & forwarded via breakpoint">EDITED</span>`;
    } else if (r.interceptAction === 'forwarded') {
      interceptBadge = `<span class="badge intercepted" style="margin-left:4px" title="Forwarded via breakpoint">BP</span>`;
    }
  }
  // Check if this request is currently held in the pending queue
  const isHeld = pendingIntercepts.some(p => {
    // Match by URL + timestamp proximity (intercepts don't have the same ID as store records)
    return false; // Held requests haven't reached the store yet
  });

  return `
    <td class="mono" style="color:var(--text-3);font-size:10px">${r.id}</td>
    <td>
      <span class="badge ${methodClass(r.method)}">${escHtml(r.method)}</span>
      ${r.isReplay ? `<span class="badge grey" style="font-size:8px;padding:1px 3px;margin-left:4px" title="Replayed request (Replayed from #${r.replayedFromId})">REPLAY</span>` : ''}
      ${r.isMocked ? `<span class="badge purple" style="font-size:8px;padding:1px 3px;margin-left:4px" title="Mocked response">MOCK</span>` : ''}
      ${interceptBadge}
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
  const usage = calculateUsageAndCost(r);
  return `
    <div class="network-detail-section">
      <h4 class="network-detail-section-title">General</h4>
      <div class="network-kv-table">
        <div class="network-kv-row"><span class="network-kv-key">Request URL</span><span class="network-kv-val mono">${escHtml(r.url)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Method</span><span class="network-kv-val"><span class="badge ${methodClass(r.method)}">${escHtml(r.method)}</span></span></div>
        <div class="network-kv-row"><span class="network-kv-key">Status Code</span><span class="network-kv-val"><span class="badge ${statusClass(r.statusCode)}">${r.statusCode || 'Error'}</span>${r.error ? ` <span style="color:var(--red);font-size:11px">${escHtml(r.error)}</span>` : ''}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Host</span><span class="network-kv-val mono">${escHtml(r.host)}</span></div>
        <div class="network-kv-row"><span class="network-kv-key">Tag</span><span class="network-kv-val"><span class="badge ${tagColorClass(r.tag)}">${escHtml(tagLabel(r.tag))}</span></span></div>
        ${usage ? `
          <div class="network-kv-row"><span class="network-kv-key">LLM Model</span><span class="network-kv-val mono">${escHtml(usage.model)}</span></div>
          <div class="network-kv-row"><span class="network-kv-key">Tokens Usage</span><span class="network-kv-val mono">${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output (${usage.totalTokens.toLocaleString()} total)</span></div>
          <div class="network-kv-row"><span class="network-kv-key">Estimated Cost</span><span class="network-kv-val mono" style="color:var(--green);font-weight:bold">$${usage.cost.toFixed(5)}</span></div>
        ` : ''}
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

// ── Intercept / Breakpoint Functions ──

async function loadInterceptState() {
  try {
    const state = await api.networkIntercept();
    interceptEnabled = state.enabled;
    interceptFilters = state.filters || [];
    pendingIntercepts = state.pending || [];
    syncInterceptUI();
    renderInterceptFilterChips();
    renderInterceptPendingQueue();
  } catch (err) {
    console.error('Failed to load intercept state:', err);
  }
}

function syncInterceptUI() {
  const toggle = document.getElementById('intercept-enabled-toggle');
  if (toggle) toggle.checked = interceptEnabled;

  const toolbarBtn = document.getElementById('network-intercept-btn');
  if (toolbarBtn) {
    toolbarBtn.classList.toggle('intercept-active', interceptEnabled);
  }

  updateInterceptPendingCount();
}

function updateInterceptPendingCount() {
  const countEl = document.getElementById('intercept-pending-count');
  if (countEl) {
    const count = pendingIntercepts.length;
    countEl.textContent = `${count} Pending`;
    countEl.className = `intercept-pending-badge ${count === 0 ? 'empty' : ''}`;
  }

  const forwardAllBtn = document.getElementById('intercept-forward-all-btn');
  if (forwardAllBtn) {
    forwardAllBtn.style.display = pendingIntercepts.length > 0 ? '' : 'none';
  }
}

function handleInterceptedRequest(data) {
  // Add to pending queue
  const existing = pendingIntercepts.find(p => p.id === data.id);
  if (!existing) {
    pendingIntercepts.push({
      ...data,
      elapsed: 0,
    });
  }
  updateInterceptPendingCount();
  renderInterceptPendingQueue();
}

function handleInterceptResolved(data) {
  if (data.id === '*') {
    // Forward all
    pendingIntercepts = [];
  } else {
    pendingIntercepts = pendingIntercepts.filter(p => p.id !== data.id);
  }
  updateInterceptPendingCount();
  renderInterceptPendingQueue();
}

function handleInterceptTimeout(data) {
  pendingIntercepts = pendingIntercepts.filter(p => p.id !== data.id);
  updateInterceptPendingCount();
  renderInterceptPendingQueue();
}

function handleInterceptStateChanged(data) {
  interceptEnabled = data.enabled;
  interceptFilters = data.filters || [];
  syncInterceptUI();
  renderInterceptFilterChips();
}

function renderInterceptFilterChips() {
  const container = document.getElementById('intercept-filter-chips');
  if (!container) return;

  if (interceptFilters.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = `
    <span style="font-size: 10px; color: var(--text-3); font-weight: 600;">FILTERS:</span>
    ${interceptFilters.map((f, i) => `
      <span class="intercept-filter-chip" data-filter-idx="${i}">
        ${escHtml(f)}
        <span class="remove-filter" title="Remove filter">&times;</span>
      </span>
    `).join('')}
  `;
}

function renderInterceptPendingQueue() {
  const container = document.getElementById('intercept-pending-queue');
  if (!container) return;

  if (pendingIntercepts.length === 0) {
    container.innerHTML = `<div class="intercept-empty-state">No intercepted requests. ${interceptEnabled ? 'Waiting for requests through the proxy…' : 'Enable intercept mode and send requests through the proxy.'}</div>`;
    return;
  }

  container.innerHTML = pendingIntercepts.map(p => {
    const elapsedMs = p.elapsed || (Date.now() - new Date(p.timestamp).getTime());
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const isWarning = elapsedSec > 240; // > 4 minutes
    const elapsedStr = elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

    return `
      <div class="intercept-pending-row ${isWarning ? 'timing-warning' : ''}" data-intercept-id="${escHtml(p.id)}">
        <div class="intercept-req-info">
          <div class="intercept-req-summary">
            <span class="badge ${methodClass(p.method)}" style="font-size:9px">${escHtml(p.method)}</span>
            <span class="badge ${tagColorClass(p.tag)}" style="font-size:8px">${escHtml(tagLabel(p.tag))}</span>
            <span class="intercept-req-url" title="${escHtml(p.url)}">${escHtml(truncateUrl(p.url, 60))}</span>
          </div>
          <div class="intercept-req-meta">${escHtml(p.host)} · ${fmtTime(p.timestamp)}</div>
        </div>
        <span class="intercept-elapsed ${isWarning ? 'warning' : ''}">${elapsedStr}</span>
        <div class="intercept-actions">
          <button class="intercept-action-btn forward" data-action="forward" title="Forward request as-is">✅</button>
          <button class="intercept-action-btn edit" data-action="edit" title="Edit and send">✏️</button>
          <button class="intercept-action-btn drop" data-action="drop" title="Drop request">❌</button>
        </div>
      </div>
    `;
  }).join('');
}

function openInterceptEditModal(interceptReq) {
  editingIntercept = interceptReq;
  const modal = document.getElementById('intercept-edit-modal');
  if (!modal) return;

  document.getElementById('intercept-edit-id').textContent = interceptReq.id.slice(0, 8) + '…';
  document.getElementById('intercept-edit-method').value = interceptReq.method || 'GET';
  document.getElementById('intercept-edit-url').value = interceptReq.url || '';

  // Populate headers
  const headersContainer = document.getElementById('intercept-edit-headers');
  const headers = interceptReq.requestHeaders || {};
  // Filter out internal/proxy headers
  const filteredHeaders = Object.entries(headers).filter(([k]) =>
    !['host', 'connection', 'proxy-connection', 'proxy-authorization'].includes(k.toLowerCase())
  );

  headersContainer.innerHTML = filteredHeaders.map(([k, v], i) => `
    <div class="intercept-kv-row" data-header-idx="${i}">
      <input type="text" class="filter-input intercept-header-key" value="${escHtml(k)}" placeholder="Header name" />
      <input type="text" class="filter-input intercept-header-val" value="${escHtml(typeof v === 'string' ? v : JSON.stringify(v))}" placeholder="Value" />
      <button class="intercept-kv-remove" title="Remove header">&times;</button>
    </div>
  `).join('');

  // Populate body
  const bodyEl = document.getElementById('intercept-edit-body');
  bodyEl.value = prettyJson(interceptReq.requestBody || '');

  modal.style.display = 'flex';
}

function closeInterceptEditModal() {
  editingIntercept = null;
  const modal = document.getElementById('intercept-edit-modal');
  if (modal) modal.style.display = 'none';
}

function getEditedRequestData() {
  const method = document.getElementById('intercept-edit-method').value;
  const url = document.getElementById('intercept-edit-url').value;

  // Collect headers
  const headers = {};
  document.querySelectorAll('#intercept-edit-headers .intercept-kv-row').forEach(row => {
    const key = row.querySelector('.intercept-header-key')?.value?.trim();
    const val = row.querySelector('.intercept-header-val')?.value || '';
    if (key) headers[key] = val;
  });

  const body = document.getElementById('intercept-edit-body').value;

  return { method, url, headers, body };
}

function bindInterceptEvents() {
  const interceptBtn = document.getElementById('network-intercept-btn');
  const interceptPanel = document.getElementById('network-intercept-panel');
  const toggle = document.getElementById('intercept-enabled-toggle');
  const filterInput = document.getElementById('intercept-filter-input');
  const addFilterBtn = document.getElementById('intercept-add-filter-btn');
  const forwardAllBtn = document.getElementById('intercept-forward-all-btn');
  const filterChips = document.getElementById('intercept-filter-chips');
  const pendingQueue = document.getElementById('intercept-pending-queue');

  // Toggle panel visibility
  interceptBtn?.addEventListener('click', () => {
    const isHidden = interceptPanel.style.display === 'none';
    interceptPanel.style.display = isHidden ? '' : 'none';
    if (isHidden) {
      loadInterceptState();
    }
  });

  // Toggle intercept on/off
  toggle?.addEventListener('change', async () => {
    try {
      await api.networkSetIntercept({ enabled: toggle.checked, filters: interceptFilters });
      interceptEnabled = toggle.checked;
      syncInterceptUI();
    } catch (err) {
      console.error('Failed to set intercept state:', err);
      toggle.checked = !toggle.checked;
    }
  });

  // Add URL filter
  function addFilter() {
    const val = filterInput?.value?.trim();
    if (!val) return;
    if (interceptFilters.includes(val)) {
      filterInput.value = '';
      return;
    }
    interceptFilters.push(val);
    filterInput.value = '';
    renderInterceptFilterChips();
    // Persist to server
    api.networkSetIntercept({ enabled: interceptEnabled, filters: interceptFilters }).catch(console.error);
  }

  addFilterBtn?.addEventListener('click', addFilter);
  filterInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFilter();
  });

  // Remove filter chips (event delegation)
  filterChips?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-filter');
    if (!removeBtn) return;
    const chip = removeBtn.closest('.intercept-filter-chip');
    if (!chip) return;
    const idx = parseInt(chip.dataset.filterIdx, 10);
    if (!isNaN(idx) && idx >= 0 && idx < interceptFilters.length) {
      interceptFilters.splice(idx, 1);
      renderInterceptFilterChips();
      api.networkSetIntercept({ enabled: interceptEnabled, filters: interceptFilters }).catch(console.error);
    }
  });

  // Forward all
  forwardAllBtn?.addEventListener('click', async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'intercept_forward_all' }));
      } else {
        await api.networkInterceptForwardAll();
      }
      pendingIntercepts = [];
      updateInterceptPendingCount();
      renderInterceptPendingQueue();
    } catch (err) {
      console.error('Failed to forward all:', err);
    }
  });

  // Pending queue actions (event delegation)
  pendingQueue?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.intercept-action-btn');
    if (!btn) return;
    const row = btn.closest('.intercept-pending-row');
    if (!row) return;
    const interceptId = row.dataset.interceptId;
    const action = btn.dataset.action;
    const interceptReq = pendingIntercepts.find(p => p.id === interceptId);

    if (action === 'forward') {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'intercept_forward', interceptId }));
        } else {
          await api.networkInterceptForward(interceptId, {});
        }
      } catch (err) {
        console.error('Failed to forward request:', err);
      }
    } else if (action === 'drop') {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'intercept_drop', interceptId }));
        } else {
          await api.networkInterceptDrop(interceptId);
        }
      } catch (err) {
        console.error('Failed to drop request:', err);
      }
    } else if (action === 'edit') {
      if (interceptReq) {
        openInterceptEditModal(interceptReq);
      }
    }
  });

  // Edit modal events
  const editModal = document.getElementById('intercept-edit-modal');
  const editClose = document.getElementById('intercept-edit-close');
  const editCancel = document.getElementById('intercept-edit-cancel');
  const editSend = document.getElementById('intercept-edit-send');
  const editAddHeader = document.getElementById('intercept-edit-add-header');

  editClose?.addEventListener('click', closeInterceptEditModal);
  editCancel?.addEventListener('click', closeInterceptEditModal);

  // Add header row
  editAddHeader?.addEventListener('click', () => {
    const container = document.getElementById('intercept-edit-headers');
    if (!container) return;
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'intercept-kv-row';
    row.dataset.headerIdx = idx;
    row.innerHTML = `
      <input type="text" class="filter-input intercept-header-key" value="" placeholder="Header name" />
      <input type="text" class="filter-input intercept-header-val" value="" placeholder="Value" />
      <button class="intercept-kv-remove" title="Remove header">&times;</button>
    `;
    container.appendChild(row);
  });

  // Remove header row (event delegation on headers container)
  document.getElementById('intercept-edit-headers')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('intercept-kv-remove')) {
      e.target.closest('.intercept-kv-row')?.remove();
    }
  });

  // Send modified request
  editSend?.addEventListener('click', async () => {
    if (!editingIntercept) return;
    const modifiedData = getEditedRequestData();
    const interceptId = editingIntercept.id;

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'intercept_forward', interceptId, data: modifiedData }));
      } else {
        await api.networkInterceptForward(interceptId, modifiedData);
      }
      closeInterceptEditModal();
    } catch (err) {
      console.error('Failed to send modified request:', err);
    }
  });

  // Close modal on background click
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) {
      closeInterceptEditModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingIntercept) {
      closeInterceptEditModal();
    }
  });
}
