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
          <p>Automated Release Testing Studio for PostQode Extension &bull; Module-by-Module Automation &bull; Fullscreen Mode &bull; Clean Teardown</p>
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

      <!-- Compact Control Strip (Replaces massive bulky cards) -->
      <div class="testlab-config-strip">
        <div class="testlab-config-bar">
          <!-- 1. Target IDE Host -->
          <div class="testlab-config-group">
            <label class="testlab-config-label" for="testlab-target-select">
              <span>💻 Target Host</span>
              <span class="testlab-info-badge" id="testlab-target-badge">Checking...</span>
            </label>
            <select id="testlab-target-select" class="testlab-select testlab-config-select">
              <option value="vscode-insiders">VS Code Insiders (Detected)</option>
              <option value="vscode">VS Code Stable</option>
              <option value="cursor">Cursor</option>
              <option value="windsurf">Windsurf</option>
            </select>
          </div>

          <!-- 2. Extension Build Source -->
          <div class="testlab-config-group">
            <label class="testlab-config-label" for="testlab-build-select">
              <span>📦 Extension Build</span>
              <span class="testlab-info-badge success" id="testlab-build-badge">Installed</span>
            </label>
            <select id="testlab-build-select" class="testlab-select testlab-config-select">
              <option value="installed" selected>Already Installed (Sandbox Copy)</option>
              <option value="local">Local Build (VSIX / Directory)</option>
              <option value="marketplace">Marketplace (Fetch &amp; Verify)</option>
            </select>
          </div>

          <!-- 3. AI Response Mode & Model -->
          <div class="testlab-config-group">
            <label class="testlab-config-label">
              <span>⚡ AI Mode</span>
              <span class="testlab-info-badge" id="testlab-mode-badge">Mocked (Free)</span>
            </label>
            <div class="testlab-pill-group testlab-config-pills" id="testlab-mode-pills">
              <button class="testlab-pill active" data-mode="mocked" title="Deterministic mock responses via port 3457 (Free)">Mocked (Free)</button>
              <button class="testlab-pill" data-mode="live" title="Live API execution via PostQode Cloud">Live Provider</button>
            </div>
          </div>

          <!-- Advanced / Drawer Toggle Button -->
          <div class="testlab-config-action">
            <button id="testlab-toggle-advanced-btn" type="button" class="testlab-btn testlab-btn-secondary" style="padding: 6px 12px; font-size: 11px; white-space: nowrap;">
              <span>⚙ Options &amp; Credentials</span>
              <span id="testlab-advanced-chevron" style="display: inline-block; transition: transform 0.2s;">▾</span>
            </button>
          </div>
        </div>

        <!-- Collapsible Advanced Drawer (VSIX file picker, Live Provider inputs, Sandbox notes) -->
        <div id="testlab-advanced-drawer" class="testlab-advanced-drawer" style="display: none;">
          <!-- Interactive File Picker & Detected Builds Container -->
          <div id="testlab-local-path-container" style="display: none; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 4px;">Local VSIX Build File or Directory:</div>
            <div class="testlab-file-row">
              <input type="text" id="testlab-local-path-input" class="testlab-select" placeholder="/path/to/postqode.vsix or directory" style="flex: 1; font-family: var(--font-mono); font-size: 11px;" />
              <button id="testlab-browse-file-btn" class="testlab-btn testlab-btn-secondary" style="padding: 6px 12px; font-size: 11px; white-space: nowrap;">
                📁 Browse File...
              </button>
              <input type="file" id="testlab-file-picker" accept=".vsix" style="display: none;" />
            </div>

            <!-- Detected Local Builds Quick-Picker -->
            <div id="testlab-detected-chips-container" style="margin-top: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-2);">Discovered Local Builds:</span>
                <span id="testlab-refresh-vsix-btn" style="font-size: 10px; color: var(--accent); cursor: pointer;">Scan</span>
              </div>
              <div class="testlab-chip-group" id="testlab-detected-chips">
                <span style="color: var(--text-3); font-size: 11px;">Scanning workspace &amp; downloads...</span>
              </div>
            </div>
          </div>

          <!-- Live Provider & Model Inputs (revealed in Live mode) -->
          <div id="testlab-live-model-container" style="display: none; flex-direction: column; gap: 8px;">
            <div style="font-size: 11px; color: var(--text-2); background: rgba(56, 139, 253, 0.08); border: 1px solid rgba(56, 139, 253, 0.25); border-radius: var(--radius-sm); padding: 6px 10px; line-height: 1.4;">
              💡 <strong>Live Execution:</strong> Enter the API Provider and Model ID below (or auto-fill directly from your active PostQode extension).
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
              <!-- API Provider Input -->
              <div>
                <label for="testlab-live-provider-input" style="font-size: 11px; font-weight: 600; color: var(--text-2); display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span>API Provider:</span>
                  <span id="testlab-detected-provider-badge" class="testlab-info-badge success" style="font-size: 9.5px; padding: 1px 6px; display: none;">From PostQode</span>
                </label>
                <input type="text" id="testlab-live-provider-input" class="testlab-input" placeholder="e.g. postqode, anthropic, openai-native, openrouter" value="postqode" style="width: 100%; box-sizing: border-box; padding: 6px 10px; font-size: 12px; font-family: var(--font-mono); background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text);" />
              </div>

              <!-- Model Input -->
              <div>
                <label for="testlab-live-model-input" style="font-size: 11px; font-weight: 600; color: var(--text-2); display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span>Model ID:</span>
                  <span id="testlab-detected-model-badge" class="testlab-info-badge success" style="font-size: 9.5px; padding: 1px 6px; display: none;">From PostQode</span>
                </label>
                <input type="text" id="testlab-live-model-input" class="testlab-input" placeholder="e.g. moonshotai/kimi-k3, claude-sonnet-4.5, gpt-4o" value="moonshotai/kimi-k3" style="width: 100%; box-sizing: border-box; padding: 6px 10px; font-size: 12px; font-family: var(--font-mono); background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text);" />
              </div>
            </div>

            <!-- Auto-Fill from PostQode & Sync status -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; color: var(--text-3); background: var(--bg-1); padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
              <span id="testlab-detected-config-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">⚡ Detecting PostQode active config...</span>
              <button id="testlab-sync-config-btn" type="button" class="testlab-btn testlab-btn-secondary" style="padding: 2px 8px; font-size: 10px; flex-shrink: 0;" title="Re-detect and auto-fill current active provider and model from PostQode">🔄 Auto-fill</button>
            </div>
          </div>

          <!-- Sandbox Note -->
          <div style="font-size: 10.5px; color: var(--text-3); line-height: 1.4; border-top: 1px dashed var(--border); padding-top: 6px;">
            🛡 <strong>Isolated Sandbox:</strong> Runs in <code style="font-family: var(--font-mono); color: var(--text-2);">/tmp/pq-profile-*</code>. Daily VS Code settings, extensions, and workspaces remain 100% untouched.
          </div>
        </div>
      </div>

      <!-- Test Scenarios Checklist -->
      <div class="testlab-card">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span style="display: flex; align-items: center; gap: 8px;"><span>📋</span> Test Scenarios</span>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <!-- Quick Module Selector -->
              <div style="display: flex; align-items: center; gap: 6px; background: var(--bg-1); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
                <span style="font-size: 11px; color: var(--text-2); font-weight: 600;">Run Module:</span>
                <select id="testlab-quick-sheet-select" class="testlab-select" style="width: auto; padding: 2px 6px; font-size: 11px; border: none; background: transparent; cursor: pointer;">
                  <option value="">-- Choose a Module --</option>
                  <option value="Install &amp; Activation">Install &amp; Activation</option>
                  <option value="GUI &amp; Editor Integration">GUI &amp; Editor Integration</option>
                  <option value="Chat &amp; Agent Mode">Chat &amp; Agent Mode</option>
                  <option value="Slash Commands">Slash Commands</option>
                  <option value="Workflows, Rules &amp; Skills">Workflows, Rules &amp; Skills</option>
                  <option value="Providers &amp; Models">Providers &amp; Models</option>
                  <option value="Files &amp; Terminal Tools">Files &amp; Terminal Tools</option>
                  <option value="Checkpoints, History &amp; State">Checkpoints, History &amp; State</option>
                  <option value="Settings &amp; Feature Flags">Settings &amp; Feature Flags</option>
                  <option value="MCP">MCP</option>
                </select>
                <button id="testlab-run-sheet-btn" class="testlab-btn testlab-btn-primary" style="padding: 2px 8px; font-size: 10px;" disabled>
                  ▶ Run Module
                </button>
              </div>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-p0">P0 Sanity</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-slash">Slash Commands</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-flows">Workflows &amp; Skills</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-prov">Providers</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-chat">Chat &amp; Agent</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-gui">Fullscreen &amp; GUI</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-lifecycle">Lifecycle</span>
                <span style="font-size: 11px; color: var(--text-3); cursor: pointer;" id="testlab-select-all">Select All</span>
              </div>
            </div>
          </div>

          <!-- Category Navigation Tabs -->
          <div class="testlab-tabs" id="testlab-category-tabs">
            <button class="testlab-tab active" data-category="all">All Modules</button>
            <button class="testlab-tab" data-category="Install &amp; Activation">Install &amp; Activation</button>
            <button class="testlab-tab" data-category="GUI &amp; Editor Integration">GUI &amp; Editor</button>
            <button class="testlab-tab" data-category="Chat &amp; Agent Mode">Chat &amp; Agent Mode</button>
            <button class="testlab-tab" data-category="Slash Commands">Slash Commands</button>
            <button class="testlab-tab" data-category="Workflows, Rules &amp; Skills">Workflows &amp; Skills</button>
            <button class="testlab-tab" data-category="Providers &amp; Models">Providers &amp; Models</button>
            <button class="testlab-tab" data-category="Files &amp; Terminal Tools">Files &amp; Tools</button>
            <button class="testlab-tab" data-category="Checkpoints, History &amp; State">History &amp; State</button>
            <button class="testlab-tab" data-category="Settings &amp; Feature Flags">Settings &amp; Flags</button>
            <button class="testlab-tab" data-category="MCP">MCP</button>
          </div>

          <!-- Checklist Grid Container -->
          <div class="testlab-checklist" id="testlab-checklist" style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
            <div style="color: var(--text-3); font-size: 12px; padding: 12px;">Loading release checklist...</div>
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

      <!-- Past Test Runs History -->
      <div class="testlab-card" id="testlab-runs-card">
        <div class="testlab-card-title">
          <span>Recent Test Runs</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span id="testlab-runs-pagination-info" style="font-size: 11px; color: var(--text-3);"></span>
            <button id="testlab-runs-prev-btn" class="testlab-btn testlab-btn-secondary" style="padding: 3px 8px; font-size: 11px;" disabled>‹ Prev</button>
            <button id="testlab-runs-next-btn" class="testlab-btn testlab-btn-secondary" style="padding: 3px 8px; font-size: 11px;" disabled>Next ›</button>
            <button id="testlab-refresh-runs-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px;">↻ Refresh</button>
          </div>
        </div>
        <div id="testlab-runs-table-container">
          <div style="color: var(--text-3); font-size: 12px;">Loading past test runs...</div>
        </div>
      </div>

      <!-- Execution Report (opens inline below Runs History when View is clicked) -->
      <div id="testlab-report-section" style="display: none; margin-top: 0;">
        <div class="testlab-card" style="border-top: 2px solid var(--accent);">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>Execution Report</span>
              <span id="testlab-report-badge" class="testlab-info-badge success">PASSED</span>
              <button id="testlab-close-report-btn" class="testlab-btn testlab-btn-secondary" style="padding: 2px 8px; font-size: 10px;">✕ Close</button>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button id="testlab-rerun-failed-btn" class="testlab-btn testlab-btn-danger" style="display: none; padding: 4px 10px; font-size: 11px;">
                🔄 Re-run Failed
              </button>
              <a id="testlab-view-allure-btn" href="#" target="_blank" class="testlab-btn testlab-btn-primary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                📊 Allure Report
              </a>
              <a id="testlab-download-allure-btn" href="#" download class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download Allure HTML">
                ⬇ Allure HTML
              </a>
              <a id="testlab-download-bundle-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download full evidence zip">
                📦 ZIP
              </a>
              <a id="testlab-download-shots-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;" title="Download screenshots">
                📸 Screenshots
              </a>
              <a id="testlab-export-html-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px; text-decoration: none;">
                Export HTML
              </a>
              <button id="testlab-export-json-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 10px; font-size: 11px;">
                Export JSON
              </button>
            </div>
          </div>

          <!-- Live Capture & Promotion Callout Banner -->
          <div id="testlab-live-promo-banner" style="display: none; margin-bottom: 16px; background: linear-gradient(135deg, rgba(56, 139, 253, 0.12), rgba(163, 113, 247, 0.12)); border: 1px solid rgba(56, 139, 253, 0.35); border-radius: var(--radius-md); padding: 12px 16px; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 280px;">
              <div style="font-size: 20px; background: rgba(56, 139, 253, 0.2); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">⚡</div>
              <div>
                <div style="font-size: 13px; font-weight: 700; color: #f0f6fc; display: flex; align-items: center; gap: 6px;">
                  <span>Live Model Execution Captured</span>
                  <span id="testlab-live-promo-count" class="testlab-info-badge" style="background: rgba(56, 139, 253, 0.25); color: #58a6ff; font-size: 10px;">0 Scenarios</span>
                </div>
                <div id="testlab-live-promo-desc" style="font-size: 11.5px; color: var(--text-2); margin-top: 2px; line-height: 1.4;">
                  Real model SSE network streams &amp; PostQode task sessions were captured. Would you like to replace the current mock baselines with these live recordings?
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="testlab-promote-all-btn" type="button" class="testlab-btn testlab-btn-primary" style="padding: 6px 14px; font-size: 11px; font-weight: 600; white-space: nowrap; box-shadow: 0 0 12px rgba(56, 139, 253, 0.35);">
                ⚡ Replace All Mocks with Live
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
              <span class="testlab-kpi-value" id="testlab-kpi-version" style="font-size: 15px; color: var(--accent-cyan, #58a6ff);">—</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Host OS</span>
              <span class="testlab-kpi-value" id="testlab-kpi-os" style="font-size: 14px;">—</span>
            </div>
            <div class="testlab-kpi-card">
              <span class="testlab-kpi-label">Model</span>
              <span class="testlab-kpi-value" id="testlab-kpi-model" style="font-size: 13px; font-family: monospace; color: #a371f7;">—</span>
            </div>
          </div>

          <!-- Feature Area Filter + Matrix Table -->
          <div style="display: flex; align-items: center; gap: 10px; margin: 10px 0 6px;">
            <span style="font-size: 11px; color: var(--text-2); font-weight: 600; white-space: nowrap;">Filter by Feature Area:</span>
            <select id="testlab-area-filter" class="testlab-select" style="width: auto; padding: 3px 8px; font-size: 11px;">
              <option value="">All Areas</option>
            </select>
            <span id="testlab-area-filter-count" style="font-size: 10px; color: var(--text-3);"></span>
          </div>
          <div style="overflow-x: auto;">
            <table class="testlab-report-table" id="testlab-report-matrix-table">
              <thead>
                <tr>
                  <th style="width: 80px;">Test ID</th>
                  <th style="width: 130px;">Feature Area</th>
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
            <span>Screenshots &amp; Visual Evidence</span>
            <a id="testlab-download-all-shots-link" href="#" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding: 2px 10px; font-size: 11px; text-decoration: none;">
              ⬇ Download All (.zip)
            </a>
          </div>
          <div class="testlab-evidence-grid" id="testlab-screenshots-grid"></div>
        </div>

        <!-- Preserved Workspace Artifacts -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title">
            <span>Preserved Workspace Artifacts</span>
            <span class="testlab-info-badge" id="testlab-artifacts-badge">0 files</span>
          </div>
          <div id="testlab-artifacts-container" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>

        <!-- Intercepted Network Evidence -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title">
            <span>Intercepted HTTP / SSE Payloads</span>
          </div>
          <div id="testlab-evidence-details" style="display: flex; flex-direction: column; gap: 10px;"></div>
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
