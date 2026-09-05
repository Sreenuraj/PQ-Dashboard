/**
 * PostQode Test Lab View
 * Interactive UI to configure, trigger, pause, resume, and stop end-to-end
 * PostQode tests inside VS Code Insiders and other hosts, mapped to the
 * PostQode Release Test Checklist sheets.
 */

export async function renderPostQodeTest(container) {
  container.innerHTML = `
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
            <span>⏹</span> Stop & Teardown
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
            <option value="marketplace">Marketplace (Fetch, Test & Verify Latest)</option>
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
                <span style="color: var(--text-3); font-size: 11px;">Scanning workspace & downloads...</span>
              </div>
            </div>
          </div>

          <div style="font-size: 11px; color: var(--text-3); line-height: 1.4;">
            Selecting <strong>Local Build</strong> or <strong>Marketplace</strong> automatically tests both <strong>Clean Uninstall</strong> and <strong>Clean Install</strong> lifecycle phases (INS-07 & INS-01).
          </div>
        </div>

        <!-- 3. AI Response Mode & Model Selection -->
        <div class="testlab-card">
          <div class="testlab-card-title">
            <span>3. AI Response Mode & Model</span>
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
                  <option value="Providers & Models">Providers & Models</option>
                  <option value="GUI & Editor Integration">GUI & Editor Integration</option>
                  <option value="Install & Activation">Install & Activation</option>
                  <option value="Chat & Agent Mode">Chat & Agent Mode</option>
                  <option value="Settings & Feature Flags">Settings & Feature Flags</option>
                  <option value="MCP">MCP</option>
                  <option value="Checkpoints, History & State">Checkpoints, History & State</option>
                  <option value="Files & Terminal Tools">Files & Terminal Tools</option>
                </select>
                <button id="testlab-run-sheet-btn" class="testlab-btn testlab-btn-primary" style="padding: 2px 8px; font-size: 10px;" disabled>
                  ▶ Run Sheet
                </button>
              </div>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-p0">P0 Sanity</span>
                <span style="font-size: 11px; color: var(--accent); cursor: pointer;" id="testlab-preset-prov">Providers & Models</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-gui">Fullscreen & GUI</span>
                <span style="font-size: 11px; color: var(--text-2); cursor: pointer;" id="testlab-preset-lifecycle">Lifecycle</span>
                <span style="font-size: 11px; color: var(--text-3); cursor: pointer;" id="testlab-select-all">Select All</span>
              </div>
            </div>
          </div>

          <!-- Category Navigation Tabs -->
          <div class="testlab-tabs" id="testlab-category-tabs">
            <button class="testlab-tab active" data-category="all">All Sheets</button>
            <button class="testlab-tab" data-category="Providers & Models">Providers & Models</button>
            <button class="testlab-tab" data-category="GUI & Editor Integration">GUI & Editor</button>
            <button class="testlab-tab" data-category="Install & Activation">Install & Activation</button>
            <button class="testlab-tab" data-category="Chat & Agent Mode">Chat & Agent Mode</button>
            <button class="testlab-tab" data-category="Settings & Feature Flags">Settings & Flags</button>
            <button class="testlab-tab" data-category="MCP">MCP</button>
            <button class="testlab-tab" data-category="Checkpoints, History & State">History & State</button>
            <button class="testlab-tab" data-category="Files & Terminal Tools">Files & Tools</button>
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
            <div style="display: flex; align-items: center; gap: 10px;">
              <span id="testlab-execution-title">Live Execution Progress</span>
              <span class="testlab-info-badge" id="testlab-execution-status">Running...</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="testlab-exec-pause-btn" class="testlab-btn testlab-btn-warning" style="padding: 4px 12px; font-size: 11px;">
                <span>⏸</span> Pause
              </button>
              <button id="testlab-exec-stop-btn" class="testlab-btn testlab-btn-danger" style="padding: 4px 12px; font-size: 11px;">
                <span>⏹</span> Stop & Teardown
              </button>
            </div>
          </div>
          <div class="testlab-steps" id="testlab-steps-container"></div>
        </div>

        <!-- Terminal Logs -->
        <div class="testlab-terminal" style="margin-top: 14px;">
          <div class="testlab-terminal-header">
            <span>Execution Terminal Stream</span>
            <span id="testlab-log-count">0 lines</span>
          </div>
          <div class="testlab-terminal-body" id="testlab-terminal-logs"></div>
        </div>
      </div>

      <!-- Comprehensive Execution Report & Evidence -->
      <div id="testlab-report-section" style="display: none;">
        <!-- Overview Card -->
        <div class="testlab-card">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>PostQode Release Checklist Execution Report</span>
              <span class="testlab-info-badge success" id="testlab-report-badge">PASSED</span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button id="testlab-rerun-failed-btn" class="testlab-btn testlab-btn-danger" style="display: none; padding: 4px 12px; font-size: 11px;">
                🔄 Re-run Failed Tests
              </button>
              <a id="testlab-view-allure-btn" href="#" target="_blank" class="testlab-btn testlab-btn-primary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                📊 Open Allure Report
              </a>
              <a id="testlab-download-allure-btn" href="#" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                ⬇ Standalone Allure HTML
              </a>
              <a id="testlab-download-bundle-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;" title="Download complete test bundle with screenshots & artifacts">
                📦 Download Bundle (.zip)
              </a>
              <a id="testlab-download-shots-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                📸 Screenshots (.zip)
              </a>
              <a id="testlab-export-html-btn" href="#" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px; text-decoration: none;">
                Export HTML
              </a>
              <button id="testlab-export-json-btn" class="testlab-btn testlab-btn-secondary" style="padding: 4px 12px; font-size: 11px;">
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
              <span class="testlab-kpi-value" id="testlab-kpi-host" style="font-size: 16px;">VS Code</span>
            </div>
          </div>

          <!-- Checklist Execution Matrix Table -->
          <div style="overflow-x: auto; margin-top: 8px;">
            <table class="testlab-report-table" id="testlab-report-matrix-table">
              <thead>
                <tr>
                  <th style="width: 80px;">Test ID</th>
                  <th style="width: 140px;">Sheet</th>
                  <th>Scenario & Steps</th>
                  <th>Expected Result</th>
                  <th>Actual Result / Assertions</th>
                  <th style="width: 80px;">Duration</th>
                  <th style="width: 90px;">Status</th>
                  <th style="width: 80px;">Evidence</th>
                  <th style="width: 110px;">Action</th>
                </tr>
              </thead>
              <tbody id="testlab-report-matrix-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Visual UI Evidence & Screenshots Gallery -->
        <div class="testlab-card" style="margin-top: 14px;">
          <div class="testlab-card-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Visual UI Evidence & Screenshots</span>
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

  // Application State
  let currentMode = 'mocked';
  let activeEventSource = null;
  let activeRunId = null;
  let currentReportData = null;
  let currentCategory = 'all';
  let executionState = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped'

  // Master Checklist Scenarios Grouped by Sheet Name
  const scenariosData = [
    // SHEET: Providers & Models
    {
      id: 'prov-01',
      checklistId: 'PROV-01',
      sheetName: 'Providers & Models',
      priority: 'P0',
      title: 'PROV-01: Provider List & Selection Persistence',
      desc: 'Opens Settings, cycles through providers via react-select, asserts selection and field isolation.',
      defaultChecked: true,
    },
    {
      id: 'prov-02',
      checklistId: 'PROV-02',
      sheetName: 'Providers & Models',
      priority: 'P0',
      title: 'PROV-02: API Keys Stored as Secrets',
      desc: 'Asserts 0 plaintext keys in settings.json; enforces VS Code SecretStorage boundary.',
      defaultChecked: true,
    },
    {
      id: 'prov-03',
      checklistId: 'PROV-03',
      sheetName: 'Providers & Models',
      priority: 'P0',
      title: 'PROV-03: PostQode Cloud Provider Task',
      desc: 'Executes task with selected cost-effective model. (Disabled in Mocked mode; runs in Live mode).',
      defaultChecked: false,
      liveOnly: true,
    },
    {
      id: 'prov-04',
      checklistId: 'PROV-04',
      sheetName: 'Providers & Models',
      priority: 'P0',
      title: 'PROV-04: Anthropic Direct Key Task',
      desc: 'Executes task via Anthropic provider. Disabled by default; enter API key below to unlock.',
      defaultChecked: false,
      requiresApiKey: 'anthropic',
    },
    {
      id: 'prov-05',
      checklistId: 'PROV-05',
      sheetName: 'Providers & Models',
      priority: 'P1',
      title: 'PROV-05: OpenRouter / OpenAI Compatible Task',
      desc: 'Executes task via OpenRouter provider. Disabled by default; enter API key below to unlock.',
      defaultChecked: false,
      requiresApiKey: 'openrouter',
    },
    {
      id: 'prov-08',
      checklistId: 'PROV-08',
      sheetName: 'Providers & Models',
      priority: 'P1',
      title: 'PROV-08: Separate Plan vs Agent Model Config',
      desc: 'Verifies independent configuration tabs for Plan Mode and Agent Mode in Settings.',
      defaultChecked: true,
    },
    {
      id: 'prov-09',
      checklistId: 'PROV-09',
      sheetName: 'Providers & Models',
      priority: 'P0',
      title: 'PROV-09: Invalid Key Handling (401 Error Card)',
      desc: 'Simulates 401 authentication error; verifies clean error card, auto-retry backoff, and no IDE crash.',
      defaultChecked: true,
    },
    {
      id: 'prov-10',
      checklistId: 'PROV-10',
      sheetName: 'Providers & Models',
      priority: 'P2',
      title: 'PROV-10: Context-Window Info per Model',
      desc: 'Inspects model context badges (e.g. 1M CTX) and metadata in settings list.',
      defaultChecked: true,
    },

    // SHEET: GUI & Editor Integration
    {
      id: 'activation',
      checklistId: 'GUI-01',
      sheetName: 'GUI & Editor Integration',
      priority: 'P0',
      title: 'GUI-01: Activity-Bar UI Icon & Full Hydration',
      desc: 'Clicks PostQode Activity Bar icon via UI; asserts logo, tasks, prompt box, and status bar hydrate.',
      defaultChecked: true,
    },
    {
      id: 'view-title',
      checklistId: 'GUI-02',
      sheetName: 'GUI & Editor Integration',
      priority: 'P1',
      title: 'GUI-02: View Title Navigation Action Icons',
      desc: 'Inspects view title action buttons (+, History, Settings, MCP, Rules, Account) in header DOM.',
      defaultChecked: true,
    },
    {
      id: 'fullscreen-resize',
      checklistId: 'GUI-07',
      sheetName: 'GUI & Editor Integration',
      priority: 'P1',
      title: 'GUI-07: Fullscreen Toggle & Dynamic Editor Auto-Resize',
      desc: 'Expands PostQode to fullscreen; opens file in Monaco editor; asserts side-by-side resize and context attachment.',
      defaultChecked: true,
    },
    {
      id: 'bottom-controls',
      checklistId: 'UI-03',
      sheetName: 'GUI & Editor Integration',
      priority: 'P0',
      title: 'UI-03: Bottom Prompt Controls, Mode Dropdown & Model Badge',
      desc: 'Inspects prompt controls, tests Mode dropdown click, dynamically verifies active model badge.',
      defaultChecked: true,
    },

    // SHEET: Install & Activation
    {
      id: 'uninstall',
      checklistId: 'INS-07',
      sheetName: 'Install & Activation',
      priority: 'P2',
      title: 'INS-07: Clean Uninstall Lifecycle',
      desc: 'Uninstalls extension in test sandbox, verifies complete filesystem deletion and zero lingering processes.',
      defaultChecked: false,
    },
    {
      id: 'install',
      checklistId: 'INS-01',
      sheetName: 'Install & Activation',
      priority: 'P0',
      title: 'INS-01: Clean Install from VSIX / Marketplace',
      desc: 'Installs package into test profile; asserts unpack integrity, package.json manifest, and version.',
      defaultChecked: false,
    },
    {
      id: 'startup',
      checklistId: 'INS-02',
      sheetName: 'Install & Activation',
      priority: 'P1',
      title: 'INS-02: Startup Performance & Window Launch',
      desc: 'Measures time from window launch to CDP attachment and sidebar readiness (<15s SLA).',
      defaultChecked: true,
    },

    // SHEET: Checkpoints, History & State
    {
      id: 'recent-tasks',
      checklistId: 'HIST-02',
      sheetName: 'Checkpoints, History & State',
      priority: 'P1',
      title: 'HIST-02: Dynamic Recent Tasks Inspection (Middle Part)',
      desc: 'Dynamically parses Recent Tasks cards, token counts, and cost badges without hardcoding.',
      defaultChecked: true,
    },
    {
      id: 'history',
      checklistId: 'HIST-01',
      sheetName: 'Checkpoints, History & State',
      priority: 'P1',
      title: 'HIST-01: Task History Drawer via UI Click',
      desc: 'Clicks History Clock in view title via UI; verifies session history drawer renders cleanly.',
      defaultChecked: true,
    },

    // SHEET: Settings & Feature Flags
    {
      id: 'settings',
      checklistId: 'SET-01',
      sheetName: 'Settings & Feature Flags',
      priority: 'P0',
      title: 'SET-01: Settings Panel Inspection via UI Click',
      desc: 'Clicks Settings Gear icon in view title via UI; verifies settings controls render; returns via + click.',
      defaultChecked: true,
    },

    // SHEET: MCP
    {
      id: 'mcp',
      checklistId: 'MCP-01',
      sheetName: 'MCP',
      priority: 'P1',
      title: 'MCP-01: MCP Server View Inspection via UI Click',
      desc: 'Clicks MCP icon in view title via UI; inspects tool status and server list.',
      defaultChecked: true,
    },

    // SHEET: Chat & Agent Mode
    {
      id: 'new-session',
      checklistId: 'CHAT-01',
      sheetName: 'Chat & Agent Mode',
      priority: 'P0',
      title: 'CHAT-01: New Session UI Input Readiness',
      desc: 'Clicks New Task (+) button via UI; verifies prompt input field is empty, visible, and focused.',
      defaultChecked: true,
    },
    {
      id: 'chat',
      checklistId: 'CHAT-02',
      sheetName: 'Chat & Agent Mode',
      priority: 'P0',
      title: 'CHAT-02: Streaming Chat Completion & Render',
      desc: 'Submits prompt; streams SSE chunks through proxy; verifies incremental rendering into message card.',
      defaultChecked: true,
    },
    {
      id: 'resilience',
      checklistId: 'CHAT-04',
      sheetName: 'Chat & Agent Mode',
      priority: 'P1',
      title: 'CHAT-04: Stream Cancellation via UI Stop Button',
      desc: 'Initiates slow response stream; clicks Stop/Cancel button in webview; verifies clean cancellation.',
      defaultChecked: true,
    },

    // SHEET: Files & Terminal Tools
    {
      id: 'agent-tools',
      checklistId: 'FILE-01',
      sheetName: 'Files & Terminal Tools',
      priority: 'P0',
      title: 'FILE-01: Agent Tool Execution & Workspace Mutation',
      desc: 'Agent executes write_to_file in fixture workspace; verifies file content on disk and preserves artifact.',
      defaultChecked: true,
    },
  ];

  // DOM Elements
  const runBtn = document.getElementById('testlab-run-btn');
  const pauseBtn = document.getElementById('testlab-pause-btn');
  const stopBtn = document.getElementById('testlab-stop-btn');
  const execPauseBtn = document.getElementById('testlab-exec-pause-btn');
  const execStopBtn = document.getElementById('testlab-exec-stop-btn');

  const targetSelect = document.getElementById('testlab-target-select');
  const targetBadge = document.getElementById('testlab-target-badge');
  const hostStatus = document.getElementById('testlab-host-status');
  const buildSelect = document.getElementById('testlab-build-select');
  const buildBadge = document.getElementById('testlab-build-badge');
  const localPathContainer = document.getElementById('testlab-local-path-container');
  const localPathInput = document.getElementById('testlab-local-path-input');
  const browseFileBtn = document.getElementById('testlab-browse-file-btn');
  const filePicker = document.getElementById('testlab-file-picker');
  const detectedChips = document.getElementById('testlab-detected-chips');
  const refreshVsixBtn = document.getElementById('testlab-refresh-vsix-btn');

  const modeBadge = document.getElementById('testlab-mode-badge');
  const modePills = document.querySelectorAll('#testlab-mode-pills .testlab-pill');
  const liveModelContainer = document.getElementById('testlab-live-model-container');
  const liveModelSelect = document.getElementById('testlab-live-model-select');

  const checklist = document.getElementById('testlab-checklist');
  const categoryTabs = document.getElementById('testlab-category-tabs');
  const selectAllBtn = document.getElementById('testlab-select-all');
  const presetP0Btn = document.getElementById('testlab-preset-p0');
  const presetProvBtn = document.getElementById('testlab-preset-prov');
  const presetGuiBtn = document.getElementById('testlab-preset-gui');
  const presetLifecycleBtn = document.getElementById('testlab-preset-lifecycle');
  const quickSheetSelect = document.getElementById('testlab-quick-sheet-select');
  const runSheetBtn = document.getElementById('testlab-run-sheet-btn');

  const executionSection = document.getElementById('testlab-execution-section');
  const executionTitle = document.getElementById('testlab-execution-title');
  const executionStatus = document.getElementById('testlab-execution-status');
  const stepsContainer = document.getElementById('testlab-steps-container');
  const terminalLogs = document.getElementById('testlab-terminal-logs');
  const logCount = document.getElementById('testlab-log-count');

  const reportSection = document.getElementById('testlab-report-section');
  const reportBadge = document.getElementById('testlab-report-badge');
  const rerunFailedBtn = document.getElementById('testlab-rerun-failed-btn');
  const viewAllureBtn = document.getElementById('testlab-view-allure-btn');
  const downloadAllureBtn = document.getElementById('testlab-download-allure-btn');
  const downloadBundleBtn = document.getElementById('testlab-download-bundle-btn');
  const downloadShotsBtn = document.getElementById('testlab-download-shots-btn');
  const downloadAllShotsLink = document.getElementById('testlab-download-all-shots-link');
  const exportHtmlBtn = document.getElementById('testlab-export-html-btn');
  const exportJsonBtn = document.getElementById('testlab-export-json-btn');

  const kpiPassRate = document.getElementById('testlab-kpi-passrate');
  const kpiTests = document.getElementById('testlab-kpi-tests');
  const kpiDuration = document.getElementById('testlab-kpi-duration');
  const kpiHost = document.getElementById('testlab-kpi-host');
  const matrixTbody = document.getElementById('testlab-report-matrix-tbody');
  const screenshotsGrid = document.getElementById('testlab-screenshots-grid');
  const artifactsContainer = document.getElementById('testlab-artifacts-container');
  const artifactsBadge = document.getElementById('testlab-artifacts-badge');
  const evidenceDetails = document.getElementById('testlab-evidence-details');

  const runsTableContainer = document.getElementById('testlab-runs-table-container');
  const refreshRunsBtn = document.getElementById('testlab-refresh-runs-btn');

  const modal = document.getElementById('testlab-modal');
  const modalImg = document.getElementById('testlab-modal-img');
  const modalCaption = document.getElementById('testlab-modal-caption');
  const modalDownloadBtn = document.getElementById('testlab-modal-download-btn');
  const modalCloseBtn = document.getElementById('testlab-modal-close-btn');

  // Build Source toggle
  buildSelect.addEventListener('change', () => {
    const val = buildSelect.value;
    if (val === 'local') {
      localPathContainer.style.display = 'block';
      buildBadge.textContent = 'Local VSIX';
      buildBadge.className = 'testlab-info-badge';
      loadDetectedVsix();
      setScenarioChecked('uninstall', true);
      setScenarioChecked('install', true);
    } else if (val === 'marketplace') {
      localPathContainer.style.display = 'none';
      buildBadge.textContent = 'Marketplace';
      buildBadge.className = 'testlab-info-badge';
      setScenarioChecked('uninstall', true);
      setScenarioChecked('install', true);
    } else {
      localPathContainer.style.display = 'none';
      buildBadge.textContent = 'Installed';
      buildBadge.className = 'testlab-info-badge success';
    }
  });

  // Mode toggle
  modePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      modePills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentMode = pill.dataset.mode;
      modeBadge.textContent = currentMode === 'mocked' ? 'Mocked (Free)' : 'Live Provider';

      if (currentMode === 'live') {
        liveModelContainer.style.display = 'block';
      } else {
        liveModelContainer.style.display = 'none';
      }
      renderChecklist(currentCategory);
    });
  });

  // Browse File Button
  browseFileBtn.addEventListener('click', async () => {
    try {
      browseFileBtn.textContent = 'Opening...';
      const res = await fetch('/api/postqode-test/pick-file-dialog', { method: 'POST' });
      const data = await res.json();
      browseFileBtn.innerHTML = '📁 Browse File...';
      if (data.success && data.path) {
        localPathInput.value = data.path;
        return;
      }
    } catch (e) {
      browseFileBtn.innerHTML = '📁 Browse File...';
    }
    filePicker.click();
  });

  filePicker.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    browseFileBtn.textContent = 'Uploading...';
    try {
      const res = await fetch(`/api/postqode-test/upload-vsix?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
      });
      const data = await res.json();
      browseFileBtn.innerHTML = '📁 Browse File...';
      if (data.success && data.path) {
        localPathInput.value = data.path;
        loadDetectedVsix();
      } else {
        alert(data.error || 'Upload failed');
      }
    } catch (err) {
      browseFileBtn.innerHTML = '📁 Browse File...';
      alert(`Upload failed: ${err.message}`);
    }
  });

  // Load Discovered VSIX Packages
  async function loadDetectedVsix() {
    try {
      detectedChips.innerHTML = '<span style="color: var(--text-3); font-size: 11px;">Scanning...</span>';
      const res = await fetch('/api/postqode-test/local-vsix-files');
      const data = await res.json();

      if (!data.files || data.files.length === 0) {
        detectedChips.innerHTML = '<span style="color: var(--text-3); font-size: 11px;">No .vsix files found in workspace or Downloads. Click Browse to pick one.</span>';
        return;
      }

      detectedChips.innerHTML = data.files
        .map((f) => {
          const mb = (f.size / (1024 * 1024)).toFixed(1);
          return `<button class="testlab-chip" data-path="${f.path}">
            📦 ${f.filename} <span style="color: var(--text-3); font-size: 9px;">(${mb} MB)</span>
          </button>`;
        })
        .join('');

      detectedChips.querySelectorAll('.testlab-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          detectedChips.querySelectorAll('.testlab-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          localPathInput.value = chip.dataset.path;
        });
      });
    } catch (e) {
      detectedChips.innerHTML = '<span style="color: #f85149; font-size: 11px;">Failed to scan files.</span>';
    }
  }

  refreshVsixBtn.addEventListener('click', loadDetectedVsix);

  // Render Checklist Grouped by Excel Sheet Name
  function renderChecklist(categoryFilter = 'all') {
    currentCategory = categoryFilter;

    // Filter scenarios
    const filtered = scenariosData.filter((sc) => {
      if (categoryFilter === 'all') return true;
      return sc.sheetName === categoryFilter;
    });

    // Group filtered scenarios by sheetName
    const sheetsMap = {};
    for (const sc of filtered) {
      if (!sheetsMap[sc.sheetName]) sheetsMap[sc.sheetName] = [];
      sheetsMap[sc.sheetName].push(sc);
    }

    let html = '';
    for (const [sheetName, items] of Object.entries(sheetsMap)) {
      html += `
        <div class="sheet-group-heading" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="sheet-group-title">
              <span>📋</span> Sheet: <strong>${sheetName}</strong>
            </span>
            <span class="testlab-info-badge" style="font-size: 10px;">${items.length} Scenarios</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="testlab-btn testlab-btn-secondary sheet-select-btn" data-sheet="${sheetName}" style="padding: 2px 8px; font-size: 10px;" title="Select only tests in this sheet">
              ☑ Select Sheet
            </button>
            <button type="button" class="testlab-btn testlab-btn-primary sheet-run-btn" data-sheet="${sheetName}" style="padding: 2px 10px; font-size: 10px; font-weight: 600;" title="Run only tests in this sheet">
              ▶ Run Only This Sheet
            </button>
          </div>
        </div>
      `;

      for (const sc of items) {
        const pClass = sc.priority === 'P0' ? 'priority-p0' : sc.priority === 'P1' ? 'priority-p1' : 'priority-p2';
        const isLiveOnlyDisabled = sc.liveOnly && currentMode === 'mocked';

        let badgeHtml = '';
        if (isLiveOnlyDisabled) {
          badgeHtml = '<span class="testlab-info-badge" style="background: rgba(139,148,158,0.2); color: #8b949e; font-size: 9px;">Disabled in Mocked Mode</span>';
        } else if (sc.liveOnly && currentMode === 'live') {
          badgeHtml = `<span class="testlab-info-badge success" style="font-size: 9px;">Live: ${liveModelSelect.value}</span>`;
        }

        let keyInputHtml = '';
        if (sc.requiresApiKey) {
          keyInputHtml = `
            <div style="margin-top: 6px;" onclick="event.stopPropagation();">
              <input type="password" id="key-input-${sc.id}" class="api-key-input" placeholder="Enter ${sc.requiresApiKey.toUpperCase()} API key to enable..." autocomplete="off" />
            </div>
          `;
        }

        const isChecked = isLiveOnlyDisabled ? false : sc.defaultChecked;
        const isDisabled = isLiveOnlyDisabled || (sc.requiresApiKey && !isChecked);

        html += `
          <label class="testlab-check-item" data-id="${sc.id}" style="${isLiveOnlyDisabled ? 'opacity: 0.65;' : ''}">
            <input type="checkbox" value="${sc.id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} />
            <div class="testlab-check-text">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                <span class="testlab-info-badge" style="font-size: 10px; padding: 1px 6px;">${sc.checklistId}</span>
                <span class="priority-badge ${pClass}">${sc.priority}</span>
                <span class="testlab-check-title" style="font-size: 12px;">${sc.title.replace(/^[^:]+:\s*/, '')}</span>
                ${badgeHtml}
              </div>
              <span class="testlab-check-desc">${sc.desc}</span>
              ${keyInputHtml}
            </div>
          </label>
        `;
      }
    }

    checklist.innerHTML = html;

    // Wire Sheet Quick Action Buttons
    checklist.querySelectorAll('.sheet-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sheet = btn.dataset.sheet;
        scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.sheetName === sheet && (!sc.requiresApiKey || false) && (!sc.liveOnly || currentMode === 'live');
        });
        renderChecklist(currentCategory);
      });
    });

    checklist.querySelectorAll('.sheet-run-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sheet = btn.dataset.sheet;
        const sheetItems = scenariosData
          .filter((sc) => sc.sheetName === sheet && (!sc.requiresApiKey || false) && (!sc.liveOnly || currentMode === 'live'))
          .map((sc) => sc.checklistId || sc.id);

        scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.sheetName === sheet && (!sc.requiresApiKey || false) && (!sc.liveOnly || currentMode === 'live');
        });
        renderChecklist(currentCategory);
        startTestRun(sheetItems);
      });
    });

    // Wire dynamic API key input unlocks
    scenariosData.forEach((sc) => {
      if (sc.requiresApiKey) {
        const input = document.getElementById(`key-input-${sc.id}`);
        const cb = checklist.querySelector(`input[value="${sc.id}"]`);
        if (input && cb) {
          input.addEventListener('input', () => {
            const hasKey = input.value.trim().length > 5;
            cb.disabled = !hasKey;
            cb.checked = hasKey;
            sc.defaultChecked = hasKey;
          });
        }
      }
    });
  }

  function setScenarioChecked(id, isChecked) {
    const sc = scenariosData.find((s) => s.id === id);
    if (sc) sc.defaultChecked = isChecked;
    const cb = checklist.querySelector(`input[value="${id}"]`);
    if (cb && !cb.disabled) cb.checked = isChecked;
  }

  // Category Tab Clicks
  categoryTabs.querySelectorAll('.testlab-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      categoryTabs.querySelectorAll('.testlab-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderChecklist(tab.dataset.category);
    });
  });

  // Presets
  presetP0Btn.addEventListener('click', () => {
    scenariosData.forEach((sc) => {
      sc.defaultChecked = sc.priority === 'P0' && !sc.liveOnly && !sc.requiresApiKey;
    });
    renderChecklist(currentCategory);
  });

  presetProvBtn.addEventListener('click', () => {
    scenariosData.forEach((sc) => {
      if (sc.sheetName === 'Providers & Models') {
        sc.defaultChecked = !sc.requiresApiKey && (!sc.liveOnly || currentMode === 'live');
      }
    });
    renderChecklist(currentCategory);
  });

  presetGuiBtn.addEventListener('click', () => {
    scenariosData.forEach((sc) => {
      if (sc.sheetName === 'GUI & Editor Integration') sc.defaultChecked = true;
    });
    renderChecklist(currentCategory);
  });

  presetLifecycleBtn.addEventListener('click', () => {
    scenariosData.forEach((sc) => {
      sc.defaultChecked = ['uninstall', 'install', 'startup', 'activation'].includes(sc.id);
    });
    renderChecklist(currentCategory);
  });

  selectAllBtn.addEventListener('click', () => {
    scenariosData.forEach((sc) => {
      if (!sc.requiresApiKey && (!sc.liveOnly || currentMode === 'live')) {
        sc.defaultChecked = true;
      }
    });
    renderChecklist(currentCategory);
  });

  // Quick Sheet Selector Dropdown & Run Sheet
  if (quickSheetSelect && runSheetBtn) {
    quickSheetSelect.addEventListener('change', () => {
      const sheet = quickSheetSelect.value;
      runSheetBtn.disabled = !sheet;
      if (sheet) {
        scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.sheetName === sheet && (!sc.requiresApiKey || false) && (!sc.liveOnly || currentMode === 'live');
        });
        renderChecklist(sheet);
        categoryTabs.querySelectorAll('.testlab-tab').forEach((t) => {
          if (t.dataset.category === sheet) {
            categoryTabs.querySelectorAll('.testlab-tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
          }
        });
      }
    });

    runSheetBtn.addEventListener('click', () => {
      const sheet = quickSheetSelect.value;
      if (!sheet) return;
      const sheetItems = scenariosData
        .filter((sc) => sc.sheetName === sheet && (!sc.requiresApiKey || false) && (!sc.liveOnly || currentMode === 'live'))
        .map((sc) => sc.checklistId || sc.id);
      startTestRun(sheetItems);
    });
  }

  // Lightbox Modal
  modalCloseBtn.addEventListener('click', () => (modal.style.display = 'none'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  // Export JSON Report
  exportJsonBtn.addEventListener('click', () => {
    if (!currentReportData) return;
    const blob = new Blob([JSON.stringify(currentReportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `postqode-report-${currentReportData.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Load Detected Targets
  async function loadTargets() {
    try {
      const res = await fetch('/api/postqode-test/targets');
      const data = await res.json();
      if (data.targets && data.targets.length > 0) {
        targetSelect.innerHTML = data.targets
          .map((t) => {
            const availText = t.isAvailable ? 'Available' : 'Not found';
            const extText = t.extensionInstalled ? `(PostQode v${t.extensionVersion})` : '(Extension missing)';
            return `<option value="${t.id}" ${t.isDefault ? 'selected' : ''} ${!t.isAvailable ? 'disabled' : ''}>
              ${t.name} — ${availText} ${extText}
            </option>`;
          })
          .join('');

        const defaultTarget = data.targets.find((t) => t.isDefault) || data.targets[0];
        targetBadge.textContent = defaultTarget.extensionInstalled ? `v${defaultTarget.extensionVersion}` : 'Not detected';
        targetBadge.className = defaultTarget.extensionInstalled ? 'testlab-info-badge success' : 'testlab-info-badge';
        hostStatus.textContent = 'Host Ready';
      }
    } catch (e) {
      hostStatus.textContent = 'API Error';
    }
  }

  // Load Past Runs
  async function loadRuns() {
    try {
      const res = await fetch('/api/postqode-test/runs');
      const data = await res.json();
      if (!data.runs || data.runs.length === 0) {
        runsTableContainer.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No previous test runs recorded. Click "Run Selected Scenarios" above to start.</div>';
        return;
      }

      let html = `
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border); color: var(--text-3); text-align: left;">
              <th style="padding: 8px 10px;">Run ID</th>
              <th style="padding: 8px 10px;">Timestamp</th>
              <th style="padding: 8px 10px;">Host</th>
              <th style="padding: 8px 10px;">Source</th>
              <th style="padding: 8px 10px;">Mode</th>
              <th style="padding: 8px 10px;">Result</th>
              <th style="padding: 8px 10px;">Duration</th>
              <th style="padding: 8px 10px; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const run of data.runs) {
        const passRate = `${run.summary.passed}/${run.summary.total}`;
        const isPass = run.summary.failed === 0;
        const statusBadge = isPass
          ? `<span class="testlab-info-badge success">Passed (${passRate})</span>`
          : `<span class="testlab-info-badge" style="background: rgba(248, 81, 73, 0.15); color: #f85149;">Failed (${run.summary.failed} errors)</span>`;

        html += `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 10px; font-family: var(--font-mono);">${run.runId}</td>
            <td style="padding: 8px 10px; color: var(--text-2);">${new Date(run.timestamp).toLocaleString()}</td>
            <td style="padding: 8px 10px;">${run.host}</td>
            <td style="padding: 8px 10px;"><span class="testlab-info-badge" style="font-size: 10px;">${run.buildSource || 'installed'}</span></td>
            <td style="padding: 8px 10px;"><code style="font-family: var(--font-mono);">${run.mode}</code></td>
            <td style="padding: 8px 10px;">${statusBadge}</td>
            <td style="padding: 8px 10px; font-family: var(--font-mono);">${(run.summary.durationMs / 1000).toFixed(1)}s</td>
            <td style="padding: 8px 10px; text-align: right; white-space: nowrap;">
              <button class="testlab-btn testlab-btn-secondary view-report-btn" data-run-id="${run.runId}" style="padding: 3px 8px; font-size: 11px;">
                View
              </button>
              <a href="/api/postqode-test/runs/${run.runId}/allure-report" target="_blank" class="testlab-btn testlab-btn-primary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;">
                📊 Allure
              </a>
              <a href="/api/postqode-test/runs/${run.runId}/download-bundle" class="testlab-btn testlab-btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;" title="Download complete zip bundle with screenshots">
                📦 Zip
              </a>
            </td>
          </tr>
        `;
      }

      html += '</tbody></table>';
      runsTableContainer.innerHTML = html;

      runsTableContainer.querySelectorAll('.view-report-btn').forEach((btn) => {
        btn.addEventListener('click', () => loadRunReport(btn.dataset.runId));
      });
    } catch (e) {
      runsTableContainer.innerHTML = `<div style="color: #f85149; font-size: 12px;">Failed to load runs: ${e.message}</div>`;
    }
  }

  refreshRunsBtn.addEventListener('click', loadRuns);

  // Load Report Details
  async function loadRunReport(runId) {
    try {
      const res = await fetch(`/api/postqode-test/runs/${runId}`);
      const report = await res.json();
      displayReport(report);
    } catch (e) {
      alert(`Error loading report: ${e.message}`);
    }
  }

  // Display Comprehensive Release Report
  function displayReport(report) {
    currentReportData = report;
    reportSection.style.display = 'block';
    reportSection.scrollIntoView({ behavior: 'smooth' });

    const isAllPass = report.summary.failed === 0;
    reportBadge.textContent = isAllPass ? 'ALL TESTS PASSED' : `FAILED (${report.summary.failed} ERRORS)`;
    reportBadge.className = isAllPass ? 'testlab-info-badge success' : 'testlab-info-badge';
    if (!isAllPass) {
      reportBadge.style.background = 'rgba(248, 81, 73, 0.15)';
      reportBadge.style.color = '#f85149';
    }

    if (viewAllureBtn) viewAllureBtn.href = `/api/postqode-test/runs/${report.runId}/allure-report`;
    if (downloadAllureBtn) downloadAllureBtn.href = `/api/postqode-test/runs/${report.runId}/allure-report?download=1`;
    if (downloadBundleBtn) downloadBundleBtn.href = `/api/postqode-test/runs/${report.runId}/download-bundle`;
    if (downloadShotsBtn) downloadShotsBtn.href = `/api/postqode-test/runs/${report.runId}/download-screenshots`;
    if (downloadAllShotsLink) downloadAllShotsLink.href = `/api/postqode-test/runs/${report.runId}/download-screenshots`;
    exportHtmlBtn.href = `/api/postqode-test/runs/${report.runId}/export-html`;

    // KPIs
    const passPct = report.summary.total ? Math.round((report.summary.passed / report.summary.total) * 100) : 0;
    kpiPassRate.textContent = `${passPct}%`;
    kpiPassRate.style.color = isAllPass ? '#3fb950' : '#f85149';
    kpiTests.textContent = `${report.summary.passed} / ${report.summary.total}`;
    kpiDuration.textContent = `${((report.summary.durationMs || 0) / 1000).toFixed(1)}s`;
    kpiHost.textContent = `${report.host} (${report.buildSource || 'installed'})`;

    // Release Matrix Table
    matrixTbody.innerHTML = '';
    for (const step of report.steps || []) {
      const isPass = step.status === 'passed';
      const isSkipped = step.status === 'skipped';
      const isStopped = step.status === 'stopped';

      let statusHtml = '';
      if (isPass) {
        statusHtml = '<span class="testlab-info-badge success" style="font-size: 10px;">PASSED</span>';
      } else if (isSkipped) {
        statusHtml = '<span class="testlab-info-badge" style="background: rgba(139, 148, 158, 0.2); color: #8b949e; font-size: 10px;">SKIPPED</span>';
      } else if (isStopped) {
        statusHtml = '<span class="testlab-info-badge" style="background: rgba(240, 136, 62, 0.2); color: #f0883e; font-size: 10px;">STOPPED</span>';
      } else {
        statusHtml = '<span class="testlab-info-badge" style="background: rgba(248, 81, 73, 0.15); color: #f85149; font-size: 10px;">FAILED</span>';
      }

      let evidenceHtml = '';
      if (step.screenshots && step.screenshots.length > 0) {
        for (const shot of step.screenshots) {
          const shotUrl = `/api/postqode-test/runs/${report.runId}/screenshots/${shot}`;
          evidenceHtml += `<img src="${shotUrl}" alt="${shot}" class="testlab-thumb" title="${shot}" data-shot="${shotUrl}" data-caption="${step.title} (${shot})" />`;
        }
      } else {
        evidenceHtml = '<span style="color: var(--text-3); font-size: 10px;">None</span>';
      }

      let assertList = '';
      if (step.assertions && step.assertions.length > 0) {
        assertList = `<ul style="margin: 0; padding-left: 14px; font-size: 11px; color: var(--text-2);">
          ${step.assertions.map((a) => `<li style="color: ${a.passed ? 'var(--text-2)' : '#f85149'};">${a.passed ? '✔' : '✖'} ${a.name}</li>`).join('')}
        </ul>`;
      }
      if (step.error) {
        assertList += `<div style="color: #f85149; font-family: var(--font-mono); font-size: 10px; margin-top: 4px;">${step.error}</div>`;
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-family: var(--font-mono); color: var(--accent); font-weight: 700;">${step.checklistId || step.id}</td>
        <td style="color: var(--text-3); font-size: 11px;">${step.sheetName || step.category || 'Core'}</td>
        <td>
          <div style="font-weight: 600; color: var(--text);">${step.title || step.scenario}</div>
          <div style="font-size: 11px; color: var(--text-3); margin-top: 2px; white-space: pre-line;">${step.steps || ''}</div>
        </td>
        <td style="color: var(--text-2); font-size: 11px;">${step.expectedResult || 'Verified without error'}</td>
        <td>${assertList || `<span style="color: var(--text-2); font-size: 11px;">${step.actualResult || 'Verified'}</span>`}</td>
        <td style="font-family: var(--font-mono); color: var(--text-3);">${((step.durationMs || 0) / 1000).toFixed(1)}s</td>
        <td>${statusHtml}</td>
        <td><div style="display: flex; gap: 4px;">${evidenceHtml}</div></td>
        <td>
          <button class="testlab-btn ${step.status === 'failed' ? 'testlab-btn-danger' : 'testlab-btn-secondary'} rerun-single-test-btn" 
                  data-id="${step.id}" 
                  data-checklist="${step.checklistId || ''}" 
                  style="padding: 3px 8px; font-size: 10px; white-space: nowrap;" 
                  title="Run only [${step.checklistId || step.id}]">
            ▶ Re-run
          </button>
        </td>
      `;
      matrixTbody.appendChild(row);
    }

    matrixTbody.querySelectorAll('.rerun-single-test-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const testId = btn.dataset.checklist || btn.dataset.id;
        scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.id === btn.dataset.id || sc.checklistId === btn.dataset.checklist;
        });
        renderChecklist(currentCategory);
        startTestRun([testId]);
      });
    });

    if (rerunFailedBtn) {
      if (report.summary.failed > 0) {
        rerunFailedBtn.style.display = 'inline-flex';
        rerunFailedBtn.textContent = `🔄 Re-run ${report.summary.failed} Failed Test(s)`;
        rerunFailedBtn.onclick = () => {
          const failedSteps = (report.steps || []).filter((s) => s.status === 'failed');
          const failedIds = failedSteps.map((s) => s.checklistId || s.id);
          scenariosData.forEach((sc) => {
            sc.defaultChecked = failedIds.includes(sc.checklistId) || failedIds.includes(sc.id);
          });
          renderChecklist(currentCategory);
          startTestRun(failedIds);
        };
      } else {
        rerunFailedBtn.style.display = 'none';
      }
    }

    matrixTbody.querySelectorAll('.testlab-thumb').forEach((img) => {
      img.addEventListener('click', () => {
        modalImg.src = img.dataset.shot;
        modalCaption.textContent = img.dataset.caption;
        if (modalDownloadBtn) {
          modalDownloadBtn.href = img.dataset.shot;
          modalDownloadBtn.download = img.getAttribute('title') || 'screenshot.png';
        }
        modal.style.display = 'flex';
      });
    });

    // Screenshots Gallery
    screenshotsGrid.innerHTML = '';
    let hasScreenshots = false;
    for (const step of report.steps || []) {
      for (const shot of step.screenshots || []) {
        hasScreenshots = true;
        const shotUrl = `/api/postqode-test/runs/${report.runId}/screenshots/${shot}`;
        const card = document.createElement('div');
        card.className = 'testlab-screenshot-card';
        card.innerHTML = `
          <img src="${shotUrl}" alt="${shot}" loading="lazy" />
          <div class="testlab-screenshot-title" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="overflow: hidden;">
              <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${step.checklistId ? `[${step.checklistId}] ` : ''}${step.title}</span>
              <span style="font-size: 10px; color: var(--text-3); font-family: var(--font-mono);">${shot}</span>
            </div>
            <a href="${shotUrl}" download="${shot}" class="testlab-btn testlab-btn-secondary" style="padding: 2px 8px; font-size: 10px; text-decoration: none; flex-shrink: 0;" onclick="event.stopPropagation();">
              ⬇ Download
            </a>
          </div>
        `;
        card.addEventListener('click', () => {
          modalImg.src = shotUrl;
          modalCaption.textContent = `${step.title} (${shot})`;
          if (modalDownloadBtn) {
            modalDownloadBtn.href = shotUrl;
            modalDownloadBtn.download = shot;
          }
          modal.style.display = 'flex';
        });
        screenshotsGrid.appendChild(card);
      }
    }
    if (!hasScreenshots) {
      screenshotsGrid.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No screenshots captured for this run.</div>';
    }

    // Preserved Workspace Artifacts
    artifactsContainer.innerHTML = '';
    const artifacts = report.artifacts || [];
    artifactsBadge.textContent = `${artifacts.length} files`;
    if (artifacts.length === 0) {
      artifactsContainer.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No modified workspace files preserved.</div>';
    } else {
      for (const file of artifacts) {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-3)';
        item.style.padding = '8px 12px';
        item.style.borderRadius = 'var(--radius-sm)';
        item.style.border = '1px solid var(--border)';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.innerHTML = `
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--text);">${file}</div>
          <a href="/api/postqode-test/runs/${report.runId}/artifacts/${file}" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding: 2px 8px; font-size: 11px;">
            Inspect File
          </a>
        `;
        artifactsContainer.appendChild(item);
      }
    }

    // Intercepted Evidence
    evidenceDetails.innerHTML = '';
    if (!report.evidence || report.evidence.length === 0) {
      evidenceDetails.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No network calls intercepted or recorded.</div>';
    } else {
      for (const ev of report.evidence) {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-3)';
        item.style.padding = '12px';
        item.style.borderRadius = 'var(--radius-sm)';
        item.style.border = '1px solid var(--border)';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
            <strong style="color: var(--text);">${ev.method} ${ev.url}</strong>
            <span class="testlab-info-badge success">${ev.isMocked ? 'Mocked SSE' : 'Live'} (${ev.duration}ms)</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-2); margin-bottom: 6px;">
            Scenario: <code>${ev.scenario}</code> | Timestamp: ${ev.timestamp}
          </div>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text); background: var(--bg-2); padding: 8px; border-radius: 4px; max-height: 120px; overflow-y: auto; white-space: pre-wrap;">${ev.responseBodyPreview || 'No response body preview'}</div>
        `;
        evidenceDetails.appendChild(item);
      }
    }
  }

  // Connect SSE Stream
  function connectStream() {
    if (activeEventSource) activeEventSource.close();
    activeEventSource = new EventSource('/api/postqode-test/stream');

    activeEventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = data.message;
      terminalLogs.appendChild(div);
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
      logCount.textContent = `${terminalLogs.children.length} lines`;
    });

    activeEventSource.addEventListener('step', (e) => {
      const data = JSON.parse(e.data);
      updateStepCard(data.step);
    });

    activeEventSource.addEventListener('stateChange', (e) => {
      const data = JSON.parse(e.data);
      updateExecutionState(data.state);
    });

    activeEventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      updateExecutionState('completed');
      executionStatus.textContent = data.report.summary.failed === 0 ? 'Passed' : 'Failed';
      executionStatus.className = data.report.summary.failed === 0 ? 'testlab-info-badge success' : 'testlab-info-badge';
      displayReport(data.report);
      loadRuns();
    });
  }

  function updateExecutionState(state) {
    executionState = state;
    if (state === 'running') {
      runBtn.disabled = true;
      runBtn.innerHTML = '<span class="testlab-step-icon" style="display:inline-block;width:14px;height:14px;animation:spin 1s linear infinite;">⏳</span> Running...';
      pauseBtn.style.display = 'inline-flex';
      pauseBtn.innerHTML = '<span>⏸</span> Pause';
      pauseBtn.className = 'testlab-btn testlab-btn-warning';
      stopBtn.style.display = 'inline-flex';
      execPauseBtn.innerHTML = '<span>⏸</span> Pause';
      execPauseBtn.className = 'testlab-btn testlab-btn-warning';
      execStopBtn.style.display = 'inline-flex';
      executionStatus.textContent = 'Running';
      executionStatus.className = 'testlab-info-badge';
    } else if (state === 'paused') {
      pauseBtn.innerHTML = '<span>▶</span> Resume';
      pauseBtn.className = 'testlab-btn testlab-btn-primary';
      execPauseBtn.innerHTML = '<span>▶</span> Resume';
      execPauseBtn.className = 'testlab-btn testlab-btn-primary';
      executionStatus.textContent = 'Paused (Sandbox Kept Alive)';
      executionStatus.className = 'testlab-info-badge';
    } else if (state === 'stopped') {
      runBtn.disabled = false;
      runBtn.innerHTML = '<span>▶</span> Run Selected Scenarios';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      execPauseBtn.style.display = 'none';
      execStopBtn.style.display = 'none';
      executionStatus.textContent = 'Stopped (Sandboxes Torn Down)';
      executionStatus.className = 'testlab-info-badge';
    } else if (state === 'completed') {
      runBtn.disabled = false;
      runBtn.innerHTML = '<span>▶</span> Run Selected Scenarios';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      execPauseBtn.style.display = 'none';
      execStopBtn.style.display = 'none';
    }
  }

  function updateStepCard(step) {
    let card = document.getElementById(`step-card-${step.id}`);
    if (!card) {
      card = document.createElement('div');
      card.id = `step-card-${step.id}`;
      card.className = `testlab-step-card ${step.status}`;
      const icon = step.status === 'running' ? '⏳' : step.status === 'passed' ? '✔' : step.status === 'skipped' ? '↷' : step.status === 'stopped' ? '⏹' : '✖';
      card.innerHTML = `
        <div class="testlab-step-left">
          <div class="testlab-step-icon">${icon}</div>
          <div class="testlab-step-info">
            <h4>${step.checklistId ? `[${step.checklistId}] ` : ''}${step.title}</h4>
            <span id="step-assertions-${step.id}">${step.status === 'skipped' ? step.actualResult : 'Starting scenario...'}</span>
          </div>
        </div>
        <div class="testlab-step-duration" id="step-duration-${step.id}">
          ${step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''}
        </div>
      `;
      stepsContainer.appendChild(card);
    } else {
      card.className = `testlab-step-card ${step.status}`;
      const icon = card.querySelector('.testlab-step-icon');
      if (icon) {
        icon.textContent = step.status === 'running' ? '⏳' : step.status === 'passed' ? '✔' : step.status === 'skipped' ? '↷' : step.status === 'stopped' ? '⏹' : '✖';
      }
      const durationEl = document.getElementById(`step-duration-${step.id}`);
      if (durationEl && step.durationMs) {
        durationEl.textContent = `${(step.durationMs / 1000).toFixed(1)}s`;
      }
      if (step.status === 'failed' && durationEl && !durationEl.querySelector('.live-step-rerun-btn')) {
        const rerunBtn = document.createElement('button');
        rerunBtn.className = 'testlab-btn testlab-btn-danger live-step-rerun-btn';
        rerunBtn.style.padding = '2px 8px';
        rerunBtn.style.fontSize = '10px';
        rerunBtn.style.marginLeft = '8px';
        rerunBtn.textContent = '▶ Re-run';
        rerunBtn.onclick = (e) => {
          e.stopPropagation();
          startTestRun([step.checklistId || step.id]);
        };
        durationEl.appendChild(rerunBtn);
      }
      const assertionsEl = document.getElementById(`step-assertions-${step.id}`);
      if (assertionsEl) {
        if (step.status === 'skipped') {
          assertionsEl.textContent = step.actualResult || 'Skipped';
        } else if (step.status === 'stopped') {
          assertionsEl.textContent = 'Stopped by user';
        } else if (step.assertions && step.assertions.length > 0) {
          const passedCount = step.assertions.filter((a) => a.passed).length;
          assertionsEl.textContent = `${passedCount}/${step.assertions.length} assertions passed`;
        }
      }
    }
  }

  // Pause / Resume Action
  async function togglePause() {
    if (executionState === 'running') {
      try {
        const res = await fetch('/api/postqode-test/pause', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          updateExecutionState('paused');
        }
      } catch (e) {
        alert(`Error pausing test: ${e.message}`);
      }
    } else if (executionState === 'paused') {
      try {
        const res = await fetch('/api/postqode-test/resume', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          updateExecutionState('running');
        }
      } catch (e) {
        alert(`Error resuming test: ${e.message}`);
      }
    }
  }

  pauseBtn.addEventListener('click', togglePause);
  execPauseBtn.addEventListener('click', togglePause);

  // Stop Action
  async function handleStop() {
    if (!confirm('Are you sure you want to STOP the test execution? Standalone IDE and sandboxes will be torn down immediately.')) {
      return;
    }

    try {
      execStopBtn.disabled = true;
      stopBtn.disabled = true;
      execStopBtn.innerHTML = 'Stopping...';
      const res = await fetch('/api/postqode-test/stop', { method: 'POST' });
      const data = await res.json();
      execStopBtn.disabled = false;
      stopBtn.disabled = false;
      updateExecutionState('stopped');
      loadRuns();
    } catch (e) {
      alert(`Error stopping test: ${e.message}`);
    }
  }

  stopBtn.addEventListener('click', handleStop);
  execStopBtn.addEventListener('click', handleStop);

  // Start Test Run (Supports Full Suite, Sheet Only, or Individual Scenarios)
  async function startTestRun(explicitScenarios = null) {
    let selectedScenarios = explicitScenarios;
    if (!selectedScenarios || selectedScenarios.length === 0) {
      selectedScenarios = Array.from(
        checklist.querySelectorAll('input[type="checkbox"]:checked')
      ).map((cb) => cb.value);
    }

    if (!selectedScenarios || selectedScenarios.length === 0) {
      alert('Please select at least one test scenario to execute.');
      return;
    }

    // Collect provider API keys if provided
    const providerApiKeys = {};
    const anthropicKey = document.getElementById('key-input-prov-04')?.value.trim();
    const openrouterKey = document.getElementById('key-input-prov-05')?.value.trim();
    if (anthropicKey) providerApiKeys.anthropic = anthropicKey;
    if (openrouterKey) providerApiKeys.openrouter = openrouterKey;

    updateExecutionState('running');

    executionSection.style.display = 'block';
    reportSection.style.display = 'none';
    stepsContainer.innerHTML = '';
    terminalLogs.innerHTML = '';
    logCount.textContent = '0 lines';
    executionStatus.textContent = 'Running';
    executionStatus.className = 'testlab-info-badge';
    executionTitle.textContent = `Running ${selectedScenarios.length} Scenario(s) on ${targetSelect.value}...`;
    executionSection.scrollIntoView({ behavior: 'smooth' });

    connectStream();

    try {
      const res = await fetch('/api/postqode-test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: targetSelect.value,
          mode: currentMode,
          buildSource: buildSelect.value,
          localBuildPath: localPathInput.value.trim() || null,
          liveModel: liveModelSelect.value || 'moonshotai/kimi-k3',
          providerApiKeys,
          scenarios: selectedScenarios,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start test run.');
        updateExecutionState('idle');
      } else {
        activeRunId = data.runId;
      }
    } catch (e) {
      alert(`Network error starting test: ${e.message}`);
      updateExecutionState('idle');
    }
  }

  // Run Button Click Handler
  runBtn.addEventListener('click', () => startTestRun());

  // Initial renders
  renderChecklist('all');
  await loadTargets();
  await loadRuns();

  // Check URL hash for direct rerun request (e.g. from Allure report link)
  const currentHash = window.location.hash || '';
  if (currentHash.includes('rerun=')) {
    const match = currentHash.match(/rerun=([^&]+)/);
    if (match && match[1]) {
      const rerunId = decodeURIComponent(match[1]);
      setTimeout(() => {
        scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.id === rerunId || sc.checklistId === rerunId;
        });
        renderChecklist('all');
        startTestRun([rerunId]);
      }, 500);
    }
  }
}
