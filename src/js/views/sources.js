/**
 * Sources & Configuration View
 * Allows users to view, enable/disable, add custom task directories, and manage proxy routing without touching YAML.
 */

export async function renderSources(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title" style="display:flex;align-items:center;gap:10px">
          <span>⚙️</span> Sources & Configuration
        </h1>
        <p class="view-subtitle">
          Manage PostQode task directories across IDEs, connect custom storage locations, and monitor proxy routing.
        </p>
      </div>
      <div class="view-actions" style="display:flex;gap:8px">
        <button id="sources-rescan-btn" class="action-btn primary" style="display:flex;align-items:center;gap:6px">
          <span>↻</span> Scan & Refresh Tasks
        </button>
      </div>
    </div>

    <!-- Summary KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:20px">
      <div class="summary-card" style="padding:14px 16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Configured Sources</div>
        <div id="kpi-sources-count" style="font-size:24px;font-weight:700;color:var(--text)">—</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:4px">Task storage locations</div>
      </div>
      <div class="summary-card" style="padding:14px 16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Total Indexed Tasks</div>
        <div id="kpi-total-tasks" style="font-size:24px;font-weight:700;color:var(--primary, #10b981)">—</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:4px">Across all enabled sources</div>
      </div>
      <div class="summary-card" style="padding:14px 16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Detected IDEs</div>
        <div id="kpi-detected-ides" style="font-size:24px;font-weight:700;color:var(--accent, #6366f1)">—</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:4px">Installed on this machine</div>
      </div>
      <div class="summary-card" style="padding:14px 16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Network Proxy</div>
        <div id="kpi-proxy-status" style="font-size:18px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;margin-top:4px">
          <span class="status-pill info">Checking...</span>
        </div>
        <div style="font-size:11px;color:var(--text-2);margin-top:4px">Port 3457 (Traffic Inspector)</div>
      </div>
    </div>

    <!-- Main Two-Column Layout -->
    <div style="display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start">
      
      <!-- Left Column: Configured & Detected Sources -->
      <div style="display:flex;flex-direction:column;gap:20px">
        
        <!-- Configured Sources Section -->
        <div class="card" style="padding:18px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0;font-size:15px;color:var(--text);display:flex;align-items:center;gap:8px">
                <span>📁</span> Configured Task Sources
              </h3>
              <p style="margin:4px 0 0 0;font-size:12px;color:var(--text-2)">
                Directories actively scanned for PostQode tasks and LLM traces.
              </p>
            </div>
            <span id="sources-badge" class="status-pill" style="font-size:11px">Loading...</span>
          </div>

          <div id="sources-list-container" style="display:flex;flex-direction:column;gap:10px">
            <div style="padding:20px;text-align:center;color:var(--text-3)">Loading sources...</div>
          </div>
        </div>

        <!-- Detected IDE Sources (Auto-Detection) -->
        <div class="card" style="padding:18px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="margin-bottom:14px">
            <h3 style="margin:0;font-size:15px;color:var(--text);display:flex;align-items:center;gap:8px">
              <span>🔍</span> Auto-Detected IDE Installations
            </h3>
            <p style="margin:4px 0 0 0;font-size:12px;color:var(--text-2)">
              PostQode automatically discovers standard directories for VS Code, Insiders, Cursor, and Windsurf.
            </p>
          </div>
          <div id="detected-ides-container" style="display:flex;flex-direction:column;gap:8px">
            <div style="padding:14px;text-align:center;color:var(--text-3)">Scanning system for IDEs...</div>
          </div>
        </div>

      </div>

      <!-- Right Column: Add Custom Folder & Proxy Status -->
      <div style="display:flex;flex-direction:column;gap:20px">
        
        <!-- Add Custom Task Source Form -->
        <div class="card" style="padding:18px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <h3 style="margin:0 0 6px 0;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px">
            <span>➕</span> Add Custom Task Folder
          </h3>
          <p style="margin:0 0 14px 0;font-size:11.5px;color:var(--text-2)">
            Have tasks in an exported folder, shared drive, or non-standard directory? Add it below:
          </p>

          <form id="add-source-form" style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:4px">
                Source Name
              </label>
              <input 
                id="input-source-name" 
                type="text" 
                placeholder="e.g. Shared Team Tasks" 
                style="width:100%;padding:8px 10px;font-size:12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text)"
                required
              />
            </div>

            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:4px">
                Folder Path
              </label>
              <div style="display:flex;gap:6px">
                <input 
                  id="input-source-path" 
                  type="text" 
                  placeholder="e.g. ~/Downloads/tasks" 
                  style="flex:1;padding:8px 10px;font-size:12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:monospace"
                  required
                />
                <button type="button" id="btn-browse-path" class="action-btn secondary" style="font-size:11px;padding:6px 10px;white-space:nowrap" title="Browse local folders via native file dialog">
                  📁 Browse
                </button>
                <button type="button" id="btn-validate-path" class="action-btn secondary" style="font-size:11px;padding:6px 10px;white-space:nowrap" title="Check if folder exists and count tasks">
                  Test
                </button>
              </div>
              <div id="path-validation-msg" style="font-size:11px;margin-top:6px;display:none"></div>
            </div>

            <button type="submit" id="btn-submit-source" class="action-btn primary" style="width:100%;padding:8px;font-size:12px;margin-top:4px">
              Add Source & Rescan
            </button>
          </form>
        </div>

        <!-- 1-Click Proxy Configuration Card -->
        <div class="card" style="padding:18px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h3 style="margin:0;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px">
              <span>📡</span> Network Proxy Routing
            </h3>
            <span id="sources-proxy-pill" class="status-pill info" style="font-size:10px">Checking...</span>
          </div>
          <p style="margin:0 0 12px 0;font-size:11.5px;color:var(--text-2)">
            Route PostQode AI requests through <code>127.0.0.1:3457</code> to inspect live prompts.
          </p>

          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
            <button id="sources-auto-proxy-btn" class="action-btn primary" style="font-size:11.5px;padding:7px 12px;width:100%;text-align:center">
              ⚡ 1-Click Auto-Configure Proxy
            </button>
            <div style="display:flex;gap:8px">
              <button id="sources-disable-proxy-btn" class="action-btn secondary" style="flex:1;font-size:11px;padding:6px 10px">
                🛑 Disable
              </button>
              <button id="sources-trust-cert-btn" class="action-btn secondary" style="flex:1;font-size:11px;padding:6px 10px">
                🔐 Trust Cert
              </button>
            </div>
          </div>
          <div id="sources-proxy-msg" style="font-size:11px;color:var(--text-3);display:none;margin-bottom:10px"></div>

          <details style="font-size:11px;color:var(--text-3)">
            <summary style="cursor:pointer;user-select:none">View Exact settings.json</summary>
            <pre style="margin-top:6px;padding:8px;background:var(--bg-3);border:1px solid var(--border);border-radius:4px;overflow-x:auto;font-size:10.5px;color:var(--text-2)"><code>{
  "http.proxy": "http://127.0.0.1:3457",
  "http.proxyStrictSSL": false,
  "http.proxySupport": "override",
  "http.noProxy": [
    "localhost",
    "127.0.0.1",
    "us.i.posthog.com",
    "mobile.events.data.microsoft.com",
    "main.vscode-cdn.net"
  ]
}</code></pre>
          </details>
        </div>

      </div>

    </div>
  `;

  // Attach dynamic logic
  await loadAndRenderSourcesData();
  attachSourcesEventListeners();
}

async function loadAndRenderSourcesData() {
  try {
    const [sourcesData, ideStatus, certStatus] = await Promise.all([
      fetch('/api/sources').then(r => r.json()),
      fetch('/api/network/proxy/ide-status').then(r => r.json()).catch(() => ({})),
      fetch('/api/network/proxy/trust-cert').then(r => r.json()).catch(() => ({})),
    ]);

    const configured = sourcesData.configured || [];
    const detected = sourcesData.detected || [];

    // Update KPIs
    const kpiSourcesCount = document.getElementById('kpi-sources-count');
    const kpiTotalTasks = document.getElementById('kpi-total-tasks');
    const kpiDetectedIdes = document.getElementById('kpi-detected-ides');
    const kpiProxyStatus = document.getElementById('kpi-proxy-status');
    const sourcesBadge = document.getElementById('sources-badge');
    const proxyPill = document.getElementById('sources-proxy-pill');
    const autoProxyBtn = document.getElementById('sources-auto-proxy-btn');
    const trustCertBtn = document.getElementById('sources-trust-cert-btn');

    const totalTasks = configured.filter(s => s.enabled).reduce((sum, s) => sum + (s.taskCount || 0), 0);
    const activeDetected = detected.filter(d => d.exists).length;

    if (kpiSourcesCount) kpiSourcesCount.textContent = configured.length;
    if (kpiTotalTasks) kpiTotalTasks.textContent = totalTasks.toLocaleString();
    if (kpiDetectedIdes) kpiDetectedIdes.textContent = `${activeDetected} of ${detected.length}`;
    if (sourcesBadge) {
      sourcesBadge.className = 'status-pill success';
      sourcesBadge.textContent = `${configured.filter(s => s.enabled).length} Enabled`;
    }

    // Proxy status
    if (ideStatus.anyConfigured) {
      if (kpiProxyStatus) kpiProxyStatus.innerHTML = `<span class="status-pill success">🟢 Active</span>`;
      if (proxyPill) {
        proxyPill.className = 'status-pill success';
        proxyPill.textContent = '🟢 Proxy Active';
      }
      if (autoProxyBtn) {
        autoProxyBtn.textContent = '✓ Proxy Configured (127.0.0.1:3457)';
        autoProxyBtn.classList.remove('primary');
        autoProxyBtn.classList.add('secondary');
      }
    } else {
      if (kpiProxyStatus) kpiProxyStatus.innerHTML = `<span class="status-pill">⚪ Direct</span>`;
      if (proxyPill) {
        proxyPill.className = 'status-pill';
        proxyPill.textContent = '⚪ Direct (No Proxy)';
      }
      if (autoProxyBtn) {
        autoProxyBtn.textContent = '⚡ 1-Click Auto-Configure Proxy';
        autoProxyBtn.classList.add('primary');
        autoProxyBtn.classList.remove('secondary');
      }
    }

    if (certStatus.isTrusted && trustCertBtn) {
      trustCertBtn.textContent = '✅ Cert Trusted';
      trustCertBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      trustCertBtn.style.color = '#10b981';
    }

    // Render Configured Sources List
    const listContainer = document.getElementById('sources-list-container');
    if (listContainer) {
      if (!configured.length) {
        listContainer.innerHTML = `
          <div style="padding:24px;text-align:center;color:var(--text-3);background:var(--bg-3);border-radius:var(--radius-sm)">
            No sources configured yet. Enable a detected IDE below or add a custom folder.
          </div>
        `;
      } else {
        listContainer.innerHTML = configured.map((src) => `
          <div style="padding:12px 14px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <span style="font-size:20px;opacity:${src.enabled ? '1' : '0.4'}">
                ${src.name.toLowerCase().includes('windsurf') ? '🌊' : (src.name.toLowerCase().includes('cursor') ? '⚡' : '💻')}
              </span>
              <div style="min-width:0">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:13px;font-weight:600;color:${src.enabled ? 'var(--text)' : 'var(--text-3)'}">
                    ${src.name}
                  </span>
                  ${src.exists 
                    ? `<span class="status-pill success" style="font-size:10px">${src.taskCount} tasks</span>`
                    : `<span class="status-pill warning" style="font-size:10px">Path not found</span>`}
                </div>
                <div style="font-size:11px;color:var(--text-3);font-family:monospace;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${src.fullPath}">
                  ${src.path}
                </div>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <label style="position:relative;display:inline-block;width:36px;height:20px;margin:0;cursor:pointer">
                <input 
                  type="checkbox" 
                  class="source-toggle-checkbox" 
                  data-index="${src.index}" 
                  ${src.enabled ? 'checked' : ''} 
                  style="opacity:0;width:0;height:0"
                />
                <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${src.enabled ? 'var(--primary, #10b981)' : 'var(--bg-hover, #3f3f46)'};transition:.2s;border-radius:20px">
                  <span style="position:absolute;content:'';height:14px;width:14px;left:${src.enabled ? '19px' : '3px'};bottom:3px;background-color:white;transition:.2s;border-radius:50%"></span>
                </span>
              </label>

              <button class="source-remove-btn action-btn secondary" data-index="${src.index}" style="padding:3px 8px;font-size:11px;min-height:auto" title="Remove source">
                ✕
              </button>
            </div>
          </div>
        `).join('');
      }
    }

    // Render Detected IDEs
    const detectedContainer = document.getElementById('detected-ides-container');
    if (detectedContainer) {
      detectedContainer.innerHTML = detected.map(d => {
        const isConfigured = configured.some(c => c.fullPath === d.fullPath);
        return `
          <div style="padding:10px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <span style="font-size:16px">${d.exists ? '🟢' : '⚪'}</span>
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text)">${d.name}</div>
                <div style="font-size:10.5px;color:var(--text-3);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${d.exists ? `${d.taskCount} tasks • ${d.fullPath}` : 'Not detected on system'}
                </div>
              </div>
            </div>

            <div>
              ${d.exists ? (
                isConfigured 
                  ? `<span style="font-size:11px;color:var(--primary, #10b981);font-weight:600">✓ In Config</span>`
                  : `<button class="add-detected-btn action-btn secondary" data-name="${d.name}" data-path="${d.path}" style="font-size:10.5px;padding:3px 8px;min-height:auto">+ Add</button>`
              ) : `<span style="font-size:11px;color:var(--text-3)">Unavailable</span>`}
            </div>
          </div>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Failed to load sources:', err);
  }
}

function attachSourcesEventListeners() {
  // Rescan all sources
  document.getElementById('sources-rescan-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sources-rescan-btn');
    if (btn) btn.innerHTML = '<span>⏳</span> Scanning...';
    try {
      await fetch('/api/refresh', { method: 'POST' });
      await loadAndRenderSourcesData();
    } finally {
      if (btn) btn.innerHTML = '<span>↻</span> Scan & Refresh Tasks';
    }
  });

  // Toggle sources
  document.getElementById('sources-list-container')?.addEventListener('change', async (e) => {
    if (e.target.classList.contains('source-toggle-checkbox')) {
      const index = parseInt(e.target.dataset.index, 10);
      const enabled = e.target.checked;
      await fetch('/api/sources/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, enabled }),
      });
      await loadAndRenderSourcesData();
    }
  });

  // Remove source
  document.getElementById('sources-list-container')?.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.source-remove-btn');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index, 10);
      if (confirm('Are you sure you want to remove this task source from configuration?')) {
        await fetch('/api/sources/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index }),
        });
        await loadAndRenderSourcesData();
      }
    }
  });

  // Add detected IDE button
  document.getElementById('detected-ides-container')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.add-detected-btn');
    if (btn) {
      const name = btn.dataset.name;
      const path = btn.dataset.path;
      btn.disabled = true;
      btn.textContent = 'Adding...';
      await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path, enabled: true }),
      });
      await loadAndRenderSourcesData();
    }
  });

  // Test / Validate Custom Path
  document.getElementById('btn-validate-path')?.addEventListener('click', async () => {
    const pathInput = document.getElementById('input-source-path');
    const msgEl = document.getElementById('path-validation-msg');
    const testPath = pathInput?.value.trim();
    if (!testPath) return;

    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = 'var(--text-3)';
      msgEl.textContent = 'Testing path...';
    }

    try {
      const res = await fetch('/api/sources/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: testPath }),
      });
      const data = await res.json();
      if (msgEl) {
        if (data.exists) {
          msgEl.style.color = '#10b981';
          msgEl.textContent = `✓ Folder exists! Found ${data.taskCount} task directories.`;
        } else {
          msgEl.style.color = '#ef4444';
          msgEl.textContent = `✕ Folder does not exist: ${data.fullPath}`;
        }
      }
    } catch (e) {
      if (msgEl) {
        msgEl.style.color = '#ef4444';
        msgEl.textContent = `Validation error: ${e.message}`;
      }
    }
  });

  // Browse local folder button
  document.getElementById('btn-browse-path')?.addEventListener('click', () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'browseFolder' }, '*');
    } else {
      const p = prompt('Enter or paste the full directory path to your PostQode tasks:');
      if (p) {
        const pathInput = document.getElementById('input-source-path');
        const nameInput = document.getElementById('input-source-name');
        if (pathInput) pathInput.value = p.trim();
        if (nameInput && !nameInput.value) {
          const parts = p.trim().split(/[\/\\]/);
          nameInput.value = parts[parts.length - 1] || 'Custom Tasks';
        }
        document.getElementById('btn-validate-path')?.click();
      }
    }
  });

  // Listen for native folder selection response from VS Code extension host
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'folderSelected' && event.data.path) {
      const pathInput = document.getElementById('input-source-path');
      const nameInput = document.getElementById('input-source-name');
      if (pathInput) pathInput.value = event.data.path;
      if (nameInput && !nameInput.value) {
        const parts = event.data.path.split(/[\/\\]/);
        nameInput.value = parts[parts.length - 1] || 'Custom Tasks';
      }
      document.getElementById('btn-validate-path')?.click();
    }
  });

  // Add Custom Source Form Submission
  document.getElementById('add-source-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('input-source-name');
    const pathInput = document.getElementById('input-source-path');
    const submitBtn = document.getElementById('btn-submit-source');
    const msgEl = document.getElementById('path-validation-msg');

    const name = nameInput?.value.trim();
    const path = pathInput?.value.trim();
    if (!name || !path) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding & Scanning...';
    }

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path, enabled: true }),
      });
      const data = await res.json();
      if (data.ok) {
        nameInput.value = '';
        pathInput.value = '';
        if (msgEl) {
          msgEl.style.display = 'block';
          msgEl.style.color = '#10b981';
          msgEl.textContent = `✓ Successfully added "${name}" (${data.taskCount} tasks found)!`;
        }
        await loadAndRenderSourcesData();
      }
    } catch (err) {
      if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#ef4444';
        msgEl.textContent = `Error adding source: ${err.message}`;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Source & Rescan';
      }
    }
  });

  // 1-Click Proxy Controls inside Sources View
  document.getElementById('sources-auto-proxy-btn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('sources-proxy-msg');
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#818cf8';
      msgEl.textContent = 'Checking configuration...';
    }

    try {
      const statusRes = await fetch('/api/network/proxy/ide-status').then(r => r.json());
      if (statusRes.anyConfigured) {
        const configuredNames = statusRes.ides.filter(i => i.isConfigured).map(i => i.name);
        if (msgEl) {
          msgEl.style.color = '#10b981';
          msgEl.textContent = `ℹ️ Proxy is already configured in: ${configuredNames.join(', ')} (127.0.0.1:3457). No changes needed.`;
        }
        await loadAndRenderSourcesData();
        return;
      }

      try {
        window.parent?.postMessage({ type: 'enableProxy' }, '*');
      } catch {}

      const res = await fetch('/api/network/proxy/auto-configure', { method: 'POST' });
      const data = await res.json();
      if (msgEl) {
        msgEl.style.color = '#10b981';
        msgEl.textContent = `✅ Proxy configured in: ${data.modified?.join(', ')}! (127.0.0.1:3457)`;
      }
      await loadAndRenderSourcesData();
    } catch (e) {
      if (msgEl) {
        msgEl.style.color = '#ef4444';
        msgEl.textContent = `Error: ${e.message}`;
      }
    }
  });

  document.getElementById('sources-disable-proxy-btn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('sources-proxy-msg');
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#818cf8';
      msgEl.textContent = 'Checking configuration...';
    }

    try {
      const statusRes = await fetch('/api/network/proxy/ide-status').then(r => r.json());
      if (!statusRes.anyConfigured) {
        if (msgEl) {
          msgEl.style.color = '#94a3b8';
          msgEl.textContent = 'ℹ️ Proxy is not configured. PostQode is already connecting directly.';
        }
        await loadAndRenderSourcesData();
        return;
      }

      try {
        window.parent?.postMessage({ type: 'disableProxy' }, '*');
      } catch {}

      await fetch('/api/network/proxy/disable', { method: 'POST' });
      if (msgEl) {
        msgEl.style.color = '#94a3b8';
        msgEl.textContent = '🛑 Proxy disabled. PostQode now connects directly to the internet.';
      }
      await loadAndRenderSourcesData();
    } catch (e) {
      if (msgEl) {
        msgEl.style.color = '#ef4444';
        msgEl.textContent = `Error: ${e.message}`;
      }
    }
  });

  document.getElementById('sources-trust-cert-btn')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('sources-proxy-msg');
    try {
      const certRes = await fetch('/api/network/proxy/trust-cert').then(r => r.json());
      if (certRes.isTrusted) {
        if (msgEl) {
          msgEl.style.display = 'block';
          msgEl.style.color = '#10b981';
          msgEl.textContent = '✅ Proxy CA Certificate is already trusted in your system Keychain! HTTPS decryption is active.';
        }
        return;
      }

      try {
        window.parent?.postMessage({ type: 'trustCertificate' }, '*');
      } catch {}

      if (certRes.command) {
        await navigator.clipboard.writeText(certRes.command);
      }
      if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#10b981';
        msgEl.textContent = `🔐 Trust command copied to clipboard! (Path: ${certRes.caPath || ''})`;
      }
    } catch (e) {
      if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#ef4444';
        msgEl.textContent = `Error: ${e.message}`;
      }
    }
  });
}
