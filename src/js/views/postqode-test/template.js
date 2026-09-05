/**
 * template.js — PostQode Test Lab HTML template.
 * Returns the full static HTML string injected into the view container.
 * Keep structure changes here; logic lives in checklist.js / runner.js / report.js.
 */
export function getTemplate() {
  return `
    <div class="testlab-container">
      <!-- Header -->
      <div class="testlab-header">
        <div class="testlab-title-group">
          <h1>
            <span>🧪</span> PostQode Test Lab
            <span class="testlab-info-badge success" id="testlab-host-status">Inspecting Hosts...</span>
          </h1>
          <p>Automated Release Testing Studio for PostQode Extension &bull; Sheet-by-Sheet Automation &bull; Fullscreen Mode &bull; Clean Teardown</p>
        </div>
        <div class="testlab-header-actions">
          <button id="testlab-pause-btn" class="testlab-btn testlab-btn-warning" style="display: none;">
            <span>⏸</span> Pause
          </button>
          <button id="testlab-stop-btn" class="testlab-btn testlab-btn-danger" style="display: none;">
            <span>⏹</span> Stop &amp; Teardown
          </button>
          <button id="testlab-run-btn" class="testlab-btn testlab-btn-primary">
            <span>▶</span> Run Selected Scenarios
          </button>
        </div>
      </div>

      <!-- Control Grid -->
      <div class="testlab-grid">
        <!-- 1. Target Host -->
        <div class="testlab-card">
          <div class="testlab-card-title">
            <span>1. Target IDE Host</span>
            <span class="testlab-info-badge" id="testlab-target-badge">Checking...</span>
          </div>
          <select id="testlab-target-select" class="testlab-select">
            <option value="vscode-insiders">VS Code Insiders (Detected)</option>
            <option value="vscode">VS Code Stable</option>
            <option value="cursor">Cursor</option>
            <option value="windsurf">Windsurf</option>
          </select>
          <div style="font-size: 11px; color: var(--text-3); line-height: 1.4;">
            Runs in an isolated sandbox (<code style="font-family: var(--font-mono); color: var(--text-2);">/tmp/pq-profile-*</code>). Your daily VS Code workspace, extensions, and settings remain 100% untouched.
          </div>
        </div>

        <!-- 2. Build Source -->
        <div class="testlab-card">
          <div class="testlab-card-title">
            <span>2. Extension Build Source</span>
            <span class="testlab-info-badge success" id="testlab-build-badge">Installed</span>
          </div>
          <select id="testlab-build-select" class="testlab-select">
            <option value="installed" selected>Already Installed Version (Sandbox Copy)</option>
            <option value="local">Local Build (VSIX / Directory)</option>
            <option value="marketplace">Marketplace (Fetch, Test &amp; Verify Latest)</option>
          </select>

          <!-- Interactive File Picker & Detected Builds Container -->
          <div id="testlab-local-path-container" style="display: none; margin-top: 4px;">
            <div class="testlab-file-row">
              <input type="text" id="testlab-local-path-input" class="testlab-select" placeholder="/path/to/postqode.vsix or directory" style="flex: 1; font-family: var(--font-mono); font-size: 11px;" />
              <button id="testlab-browse-file-btn" class="testlab-btn testlab-btn-secondary" style="padding: 6px 12px; font-size: 11px; white-space: nowrap;">
                📁 Browse File...
              </button>
              <input type="file" id="testlab-file-picker" accept=".vsix" style="display: none;" />
            </div>

            <!-- Detected Local Builds Quick-Picker -->
            <div id="testlab-detected-chips-container" style="margin-top: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-2);">Discovered Local Builds:</span>
                <span id="testlab-refresh-vsix-btn" style="font-size: 10px; color: var(--accent); cursor: pointer;">Scan</span>
              </div>
              <div class="testlab-chip-group" id="testlab-detected-chips">
                <span style="color: var(--text-3); font-size: 11px;">Scanning workspace &amp; downloads...</span>
              </div>
            </div>
          </div>

          <div style="font-size: 11px; color: var(--text-3); line-height: 1.4;">
            Selecting <strong>Local Build</strong> or <strong>Marketplace</strong> automatically tests both <strong>Clean Uninstall</strong> and <strong>Clean Install</strong> lifecycle phases (INS-07 &amp; INS-01).
          </div>
        </div>

        <!-- 3. AI Response Mode & Model Selection -->
        <div class="testlab-card">
          <div class="testlab-card-title">
            <span>3. AI Response Mode &amp; Model</span>
            <span class="testlab-info-badge" id="testlab-mode-badge">Mocked (Free)</span>
          </div>
          <div class="testlab-pill-group" id="testlab-mode-pills">
            <button class="testlab-pill active" data-mode="mocked">Mocked (Free / Deterministic)</button>
            <button class="testlab-pill" data-mode="live">Live Provider</button>
          </div>

          <!-- Live Model Selector (revealed in Live mode) -->
          <div id="testlab-live-model-container" style="display: none; margin-top: 4px;">
            <label style="font-size: 11px; font-weight: 600; color: var(--text-2); display: block; margin-bottom: 4px;">
              PostQode API Model:
            </label>
            <select id="testlab-live-model-select" class="testlab-select">
              <option value="moonshotai/kimi-k3" selected>moonshotai/kimi-k3 (Default cost-effective coding model)</option>
              <option value="moonshotai/kimi-k2.6">moonshotai/kimi-k2.6 (Fast coding model)</option>
              <option value="anthropic/claude-sonnet-4.6">anthropic/claude-sonnet-4.6</option>
              <option value="openai/gpt-5.4">openai/gpt-5.4</option>
              <option value="z-ai/glm-5.1">z-ai/glm-5.1</option>
            </select>
            <div style="font-size: 10px; color: var(--text-3); margin-top: 3px;">
              PROV-03 uses this model in Live mode. In Mocked mode, PROV-03 is safely disabled.
            </div>
          </div>

          <div style="font-size: 11px; color: var(--text-3); line-height: 1.4;">
            <strong style="color: var(--text-2);">Mocked:</strong> Intercepts completions via PQ proxy (port 3457) with zero token cost. Fullscreen testing runs automatically.
          </div>
        </div>

        <!-- 4. Release Checklist Matrix Grouped by Sheet Name -->
        <div class="testlab-card" style="grid-column: 1 / -1;">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span>4. Release Checklist Matrix (Grouped by Excel Sheet)</span>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <!-- Quick Sheet Selector -->
              <div style="display: flex; align-items: center; gap: 6px; background: var(--bg-1); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
                <span style="font-size: 11px; color: var(--text-2); font-weight: 600;">Run Sheet:</span>
                <select id="testlab-quick-sheet-select" class="testlab-select" style="width: auto; padding: 2px 6px; font-size: 11px; border: none; background: transparent; cursor: pointer;">
                  <option value="">-- Choose a Sheet --</option>
                  <option value="Providers &amp; Models">Providers &amp; Models</option>
                  <option value="GUI &amp; Editor Integration">GUI &amp; Editor Integration</option>
                  <option value="Install &amp; Activation">Install &amp; Activation</option>
                  <option value="Chat &amp; Agent Mode">Chat &amp; Agent Mode</option>
                  <option value="Settings &amp; Feature Flags">Settings &amp; Feature Flags</option>
                  <option value="MCP">MCP</option>
                  <option value="Checkpoints, History &amp; State">Checkpoints, History &amp; State</option>
                  <option value="Files &amp; Terminal Tools">Files &amp; Terminal Tools</option>
                </select>
                <button id="testlab-run-sheet-btn" class="testlab-btn testlab-btn-primary" style="padding: 2px 8px; font-size: 10px;" disabled>
                  ▶ Run Sheet
                </button>
              </div>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-p0">P0 Sanity</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-prov">Providers &amp; Models</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-chat">Chat &amp; Agent</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-gui">Fullscreen &amp; GUI</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-lifecycle">Lifecycle</span>
                <span style="font-size: 11px; color: var(--text-3); cursor: pointer;" id="testlab-select-all">Select All</span>
              </div>
            </div>
          </div>

          <!-- Category Navigation Tabs -->
          <div class="testlab-tabs" id="testlab-category-tabs">
            <button class="testlab-tab active" data-category="all">All Sheets</button>
            <button class="testlab-tab" data-category="Providers &amp; Models">Providers &amp; Models</button>
            <button class="testlab-tab" data-category="GUI &amp; Editor Integration">GUI &amp; Editor</button>
            <button class="testlab-tab" data-category="Install &amp; Activation">Install &amp; Activation</button>
            <button class="testlab-tab" data-category="Chat &amp; Agent Mode">Chat &amp; Agent Mode</button>
            <button class="testlab-tab" data-category="Settings &amp; Feature Flags">Settings &amp; Flags</button>
            <button class="testlab-tab" data-category="MCP">MCP</button>
            <button class="testlab-tab" data-category="Checkpoints, History &amp; State">History &amp; State</button>
            <button class="testlab-tab" data-category="Files &amp; Terminal Tools">Files &amp; Tools</button>
          </div>

          <!-- Checklist Grid Container -->
          <div class="testlab-checklist" id="testlab-checklist" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px;">
            <div style="color: var(--text-3); font-size: 12px; padding: 12px;">Loading release checklist...</div>
          </div>
        </div>
      </div>

      <!-- Active Execution & Step Monitor with Pause / Resume / Stop Controls -->
      <div id="testlab-execution-section" style="display: none;">
        <div class="testlab-card">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span id="testlab-execution-title">Live Execution Monitor</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="testlab-exec-pause-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px; display: none;">⏸ Pause</button>
              <button id="testlab-exec-stop-btn" class="testlab-btn testlab-btn-danger" style="padding: 4px 12px; font-size: 11px; display: none;">⏹ Stop &amp; Teardown</button>
              <span id="testlab-execution-status" class="testlab-info-badge">Initializing...</span>
            </div>
          </div>

          <!-- Step Progression Grid -->
          <div class="testlab-steps" id="testlab-steps-container"></div>

          <!-- Live Terminal Output -->
          <div style="margin-top: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-3);">Execution Log Stream</span>
              <span style="font-size: 10px; color: var(--text-3);" id="testlab-log-count">0 events</span>
            </div>
            <div class="testlab-terminal" id="testlab-terminal-logs"></div>
          </div>
        </div>
      </div>

      <!-- Execution Report & Artifacts View -->
      <div id="testlab-report-section" style="display: none;">
        <div class="testlab-card">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>5. Release Checklist Execution Report</span>
              <span id="testlab-report-badge" class="testlab-info-badge success">PASSED</span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button id="testlab-rerun-failed-btn" class="testlab-btn testlab-btn-danger" style="display: none; padding: 4px 10px; font-size: 11px;">
                🔄 Re-run Failed Tests
              </button>
              <a id="testlab-view-allure-btn" href="#" target="_blank" class="testlab-btn testlab-btn-primary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                📊 View Allure Report
              </a>
              <a id="testlab-download-allure-btn" href="#" download class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download standalone portable Allure HTML report with embedded screenshots">
                ⬇ Allure HTML
              </a>
              <a id="testlab-download-bundle-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download complete release evidence zip bundle">
                📦 Evidence Bundle (ZIP)
              </a>
              <a id="testlab-download-shots-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download all captured screenshots">
                📸 Screenshots (ZIP)
              </a>
              <a id="testlab-export-html-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;">
                Export HTML
              </a>
              <button id="testlab-export-json-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px;">
                Export JSON
              </button>
            </div>
          </div>

          <!-- KPI Summary -->
          <div class="testlab-kpi-grid">
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Pass Rate</span>
              <span class="testlab-kpi-value" id="testlab-kpi-passrate">100%</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Scenarios Passed</span>
              <span class="testlab-kpi-value" id="testlab-kpi-tests">0 / 0</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Total Duration</span>
              <span class="testlab-kpi-value" id="testlab-kpi-duration">0.0s</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Target Sandbox</span>
              <span class="testlab-kpi-value" id="testlab-kpi-host" style="font-size: 15px;">VS Code</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">PostQode Version</span>
              <span class="testlab-kpi-value" id="testlab-kpi-version" style="font-size: 15px; color: var(--accent-cyan, #58a6ff);">v3.0.26-beta.2</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Host OS</span>
              <span class="testlab-kpi-value" id="testlab-kpi-os" style="font-size: 14px;">macOS (arm64)</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Active Default Model</span>
              <span class="testlab-kpi-value" id="testlab-kpi-model" style="font-size: 13px; font-family: monospace; color: #a371f7;">kimi-k3</span>
            </div>
          </div>

          <!-- Checklist Execution Matrix Table -->
          <div style="overflow-x: auto; margin-top: 8px;">
            <table class="testlab-report-table" id="testlab-report-matrix-table">
              <thead>
                <tr>
                  <th style="width: 80px;">Test ID</th>
                  <th style="width: 130px;">Sheet</th>
                  <th>Scenario &amp; Steps</th>
                  <th style="width: 135px;">Model</th>
                  <th>Expected Result</th>
                  <th>Actual Result / Assertions</th>
                  <th style="width: 75px;">Duration</th>
                  <th style="width: 85px;">Status</th>
                  <th style="width: 80px;">Evidence</th>
                  <th style="width: 100px;">Action</th>
                </tr>
              </thead>
              <tbody id="testlab-report-matrix-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Visual UI Evidence & Screenshots Gallery -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Visual UI Evidence &amp; Screenshots</span>
            <a id="testlab-download-all-shots-link" href="#" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding: 2px 10px; font-size: 11px; text-decoration: none;">
              ⬇ Download All Screenshots (.zip)
            </a>
          </div>
          <div class="testlab-evidence-grid" id="testlab-screenshots-grid"></div>
        </div>

        <!-- Preserved Workspace Artifacts -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title">
            <span>Preserved Workspace Artifacts (Modified by Agent)</span>
            <span class="testlab-info-badge" id="testlab-artifacts-badge">0 files</span>
          </div>
          <div id="testlab-artifacts-container" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>

        <!-- Intercepted Network Evidence -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title">
            <span>Intercepted HTTP / SSE Network Payloads</span>
          </div>
          <div id="testlab-evidence-details" style="display: flex; flex-direction: column; gap: 10px;"></div>
        </div>
      </div>

      <!-- Past Test Runs History -->
      <div class="testlab-card">
        <div class="testlab-card-title">
          <span>Recent Test Runs History</span>
          <button id="testlab-refresh-runs-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px;">Refresh</button>
        </div>
        <div id="testlab-runs-table-container">
          <div style="color: var(--text-3); font-size: 12px;">Loading past test runs...</div>
        </div>
      </div>
    </div>

    <!-- Lightbox Modal -->
    <div id="testlab-modal" class="testlab-modal-backdrop" style="display: none;">
      <div class="testlab-modal-content">
        <img id="testlab-modal-img" src="" alt="Test Screenshot" />
        <div class="testlab-modal-footer">
          <span id="testlab-modal-caption"></span>
          <div style="display: flex; gap: 8px;">
            <a id="testlab-modal-download-btn" href="#" download="" class="testlab-btn testlab-btn-primary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;">
              ⬇ Download Image
            </a>
            <button id="testlab-modal-close-btn" class="testlab-modal-close">✕</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
