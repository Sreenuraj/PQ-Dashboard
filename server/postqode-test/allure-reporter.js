const fs = require('fs');
const path = require('path');

/**
 * Generates an interactive, self-contained Allure-style HTML test execution report.
 * Embeds screenshots and artifacts (optionally as base64) so the report is 100% portable
 * and viewable offline or downloadable as a standalone file.
 */
function generateAllureHtml(runDir, reportData, options = {}) {
  const embedBase64 = options.embedBase64 !== false;
  const runId = reportData.runId || path.basename(runDir);
  const timestamp = reportData.timestamp || new Date().toISOString();
  const summary = reportData.summary || { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  const steps = reportData.steps || [];
  const artifacts = reportData.artifacts || [];
  const evidence = reportData.evidence || [];
  const host = reportData.host || 'vscode-insiders';
  const buildSource = reportData.buildSource || 'installed';

  const passRate = summary.total ? Math.round((summary.passed / summary.total) * 100) : 0;
  const isAllPass = summary.failed === 0;

  // Load screenshot files and optionally convert to base64
  const screenshotsDir = path.join(runDir, 'screenshots');
  const screenshotData = {};
  if (fs.existsSync(screenshotsDir)) {
    try {
      const files = fs.readdirSync(screenshotsDir);
      for (const file of files) {
        if (file.endsWith('.png') || file.endsWith('.jpg')) {
          const filePath = path.join(screenshotsDir, file);
          if (embedBase64) {
            const buf = fs.readFileSync(filePath);
            screenshotData[file] = `data:image/png;base64,${buf.toString('base64')}`;
          } else {
            screenshotData[file] = `/api/postqode-test/runs/${runId}/screenshots/${file}`;
          }
        }
      }
    } catch (e) {}
  }

  // Load workspace artifacts
  const artifactsDir = path.join(runDir, 'workspace-artifacts');
  const artifactContents = {};
  if (fs.existsSync(artifactsDir)) {
    try {
      const files = fs.readdirSync(artifactsDir);
      for (const file of files) {
        const filePath = path.join(artifactsDir, file);
        if (fs.statSync(filePath).isFile()) {
          try {
            artifactContents[file] = fs.readFileSync(filePath, 'utf8');
          } catch (e) {
            artifactContents[file] = '[Binary file]';
          }
        }
      }
    } catch (e) {}
  }

  // Group steps by Category / Sheet Name
  const categoriesMap = {};
  for (const step of steps) {
    const cat = step.sheetName || step.category || 'Core Sanity';
    if (!categoriesMap[cat]) categoriesMap[cat] = [];
    categoriesMap[cat].push(step);
  }

  // Calculate SVG donut chart stroke offsets
  const radius = 50;
  const circumference = 2 * Math.PI * radius; // ~314.159
  const passedFraction = summary.total ? (summary.passed / summary.total) : 1;
  const failedFraction = summary.total ? (summary.failed / summary.total) : 0;
  const passedStroke = passedFraction * circumference;
  const failedStroke = failedFraction * circumference;

  // Serialize data for client-side interactivity
  const serializedSteps = JSON.stringify(steps).replace(/</g, '\\u003c');
  const serializedScreenshots = JSON.stringify(screenshotData).replace(/</g, '\\u003c');
  const serializedArtifacts = JSON.stringify(artifactContents).replace(/</g, '\\u003c');
  const serializedEvidence = JSON.stringify(evidence).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Allure Report — ${runId}</title>
  <style>
    :root {
      --bg-body: #0d1117;
      --bg-sidebar: #161b22;
      --bg-card: #21262d;
      --bg-card-hover: #30363d;
      --border: #30363d;
      --border-subtle: #21262d;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --text-dim: #484f58;
      --passed: #238636;
      --passed-bg: rgba(35, 134, 54, 0.15);
      --passed-border: rgba(46, 160, 67, 0.4);
      --failed: #da3633;
      --failed-bg: rgba(218, 54, 51, 0.15);
      --failed-border: rgba(248, 81, 73, 0.4);
      --accent: #58a6ff;
      --accent-bg: rgba(56, 139, 253, 0.15);
      --p0-color: #f85149;
      --p1-color: #d29922;
      --p2-color: #58a6ff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg-body);
      color: var(--text);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Allure Left Icon Sidebar ── */
    .allure-nav {
      width: 64px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
      gap: 12px;
      flex-shrink: 0;
      z-index: 10;
    }

    .allure-logo {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #0066ff, #00ccff);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 18px;
      color: #fff;
      margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0, 102, 255, 0.4);
    }

    .nav-btn {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.15s ease;
    }

    .nav-btn span.label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nav-btn:hover {
      background: var(--bg-card);
      color: var(--text);
    }

    .nav-btn.active {
      background: var(--accent-bg);
      color: var(--accent);
      border-color: rgba(88, 166, 255, 0.3);
    }

    /* ── Main Workspace ── */
    .allure-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header ── */
    .allure-header {
      height: 56px;
      background: var(--bg-sidebar);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      flex-shrink: 0;
    }

    .allure-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .allure-header-left h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }

    .allure-run-pill {
      font-family: ui-monospace, monospace;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-muted);
    }

    .allure-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }

    .btn-primary {
      background: #238636;
      color: #fff;
    }
    .btn-primary:hover { filter: brightness(1.1); }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-secondary:hover { background: var(--bg-card-hover); }

    /* ── Content Viewport ── */
    .allure-viewport {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* ── Overview Dashboard ── */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    .chart-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .chart-svg {
      width: 140px;
      height: 140px;
      transform: rotate(-90deg);
    }

    .chart-center-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }

    .chart-center-rate {
      font-size: 26px;
      font-weight: 700;
      color: ${isAllPass ? '#3fb950' : '#f85149'};
    }

    .chart-center-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chart-legend {
      display: flex;
      gap: 14px;
      margin-top: 14px;
      font-size: 12px;
    }

    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }

    .stats-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .stat-row-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    .stat-box {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
    }
    .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; font-weight: 600; }
    .stat-val { font-size: 22px; font-weight: 700; color: var(--text); }

    .env-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 8px;
    }

    .env-table td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
    }
    .env-table td:first-child { color: var(--text-muted); width: 140px; font-weight: 500; }
    .env-table td:last-child { font-family: ui-monospace, monospace; color: var(--text); }

    /* ── Suites Split View ── */
    .suites-layout {
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 16px;
      height: calc(100vh - 120px);
    }

    .suites-sidebar {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .suites-search {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }

    .suites-search input {
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 12px;
      outline: none;
    }

    .suites-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .suite-group-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 8px 10px 4px;
      display: flex;
      justify-content: space-between;
    }

    .suite-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 3px;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }

    .suite-item:hover { background: var(--bg-card); }
    .suite-item.active {
      background: var(--accent-bg);
      border-color: rgba(88, 166, 255, 0.4);
    }

    .suite-item-left {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
    }

    .status-badge {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 900;
      flex-shrink: 0;
    }
    .status-badge.passed { background: var(--passed); color: #fff; }
    .status-badge.failed { background: var(--failed); color: #fff; }
    .status-badge.skipped { background: #8b949e; color: #fff; }
    .status-badge.stopped { background: #f0883e; color: #fff; }

    .suite-item-text {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .suite-item-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .severity-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .severity-p0 { background: rgba(248, 81, 73, 0.2); color: #f85149; }
    .severity-p1 { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .severity-p2 { background: rgba(88, 166, 255, 0.2); color: #58a6ff; }

    /* ── Test Detail Pane ── */
    .suites-detail {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 24px;
      gap: 20px;
    }

    .detail-header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }

    .detail-top-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .detail-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }

    .detail-meta-row {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .section-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }

    .section-card-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .step-timeline-item {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }

    .step-marker {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--passed);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .step-marker.failed { background: var(--failed); }

    .step-content { flex: 1; font-size: 12px; }
    .step-name { font-weight: 600; color: var(--text); margin-bottom: 2px; }
    .step-desc { color: var(--text-muted); white-space: pre-line; line-height: 1.4; }

    /* ── Attachment Card ── */
    .attachment-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin-top: 10px;
    }

    .attachment-header {
      background: var(--bg-card);
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    }

    .attachment-img-preview {
      max-width: 100%;
      max-height: 400px;
      display: block;
      margin: 0 auto;
      object-fit: contain;
      cursor: pointer;
      padding: 8px;
    }

    /* ── Gallery Tab ── */
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }

    .gallery-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .gallery-card img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }

    .gallery-card-footer {
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }

    /* ── Modal Lightbox ── */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-container {
      max-width: 92vw;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      background: var(--bg-sidebar);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .modal-container img {
      max-width: 100%;
      max-height: calc(92vh - 60px);
      object-fit: contain;
    }

    .modal-bar {
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg-card);
      font-size: 13px;
    }
  </style>
</head>
<body>

  <!-- Left Icon Nav -->
  <nav class="allure-nav">
    <div class="allure-logo">A</div>
    <button class="nav-btn active" data-tab="overview">
      <span>📊</span>
      <span class="label">Stats</span>
    </button>
    <button class="nav-btn" data-tab="suites">
      <span>📁</span>
      <span class="label">Suites</span>
    </button>
    <button class="nav-btn" data-tab="gallery">
      <span>📸</span>
      <span class="label">Screens</span>
    </button>
    <button class="nav-btn" data-tab="artifacts">
      <span>📄</span>
      <span class="label">Files</span>
    </button>
  </nav>

  <!-- Main Area -->
  <div class="allure-main">
    <!-- Header -->
    <header class="allure-header">
      <div class="allure-header-left">
        <h1>PostQode Release Test Report</h1>
        <span class="allure-run-pill">${runId}</span>
        <span style="font-size: 12px; color: ${isAllPass ? '#3fb950' : '#f85149'}; font-weight: 700;">
          ${isAllPass ? '✔ ALL PASSED' : '✖ HAS FAILURES'}
        </span>
      </div>
      <div class="allure-header-actions">
        <button id="btn-download-json" class="btn btn-secondary">📄 Export JSON</button>
        <button id="btn-download-html" class="btn btn-primary">💾 Save Allure HTML</button>
      </div>
    </header>

    <!-- Viewport -->
    <div class="allure-viewport">

      <!-- TAB 1: OVERVIEW -->
      <section id="tab-overview" class="tab-content active">
        <div class="dashboard-grid">
          <!-- Donut Chart -->
          <div class="chart-card">
            <svg class="chart-svg" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#30363d" stroke-width="14" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="#238636" stroke-width="14"
                      stroke-dasharray="${circumference}" stroke-dashoffset="${circumference - passedStroke}" />
              ${summary.failed > 0 ? `
              <circle cx="60" cy="60" r="50" fill="none" stroke="#da3633" stroke-width="14"
                      stroke-dasharray="${circumference}" stroke-dashoffset="${circumference - failedStroke}"
                      stroke-dashoffset="${circumference - passedStroke - failedStroke}" />
              ` : ''}
            </svg>
            <div class="chart-center-text">
              <div class="chart-center-rate">${passRate}%</div>
              <div class="chart-center-label">Pass Rate</div>
            </div>
            <div class="chart-legend">
              <div class="legend-item"><div class="legend-dot" style="background:#238636;"></div> Passed (${summary.passed})</div>
              <div class="legend-item"><div class="legend-dot" style="background:#da3633;"></div> Failed (${summary.failed})</div>
            </div>
          </div>

          <!-- Summary Stats -->
          <div class="stats-card">
            <div class="stat-row-grid">
              <div class="stat-box"><div class="stat-label">Total Test Cases</div><div class="stat-val">${summary.total}</div></div>
              <div class="stat-box"><div class="stat-label">Passed</div><div class="stat-val" style="color:#3fb950;">${summary.passed}</div></div>
              <div class="stat-box"><div class="stat-label">Failed</div><div class="stat-val" style="color:#f85149;">${summary.failed}</div></div>
              <div class="stat-box"><div class="stat-label">Duration</div><div class="stat-val">${((summary.durationMs || 0) / 1000).toFixed(1)}s</div></div>
            </div>

            <div>
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Environment & Execution Properties</div>
              <table class="env-table">
                <tr><td>Target Host</td><td>${host}</td></tr>
                <tr><td>Build Source</td><td>${buildSource}</td></tr>
                <tr><td>Execution Mode</td><td>${reportData.mode || 'mocked'}</td></tr>
                <tr><td>Timestamp</td><td>${timestamp}</td></tr>
                <tr><td>Runner Version</td><td>PQ-Dashboard Allure Reporter v1.0.0</td></tr>
              </table>
            </div>
          </div>
        </div>

        <!-- Quick Summary Table -->
        <div class="section-card">
          <div class="section-card-title">
            <span>Release Checklist Scenarios Overview</span>
            <span>${steps.length} Scenarios</span>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border); color: var(--text-muted); text-align: left;">
                <th style="padding: 8px 10px;">ID</th>
                <th style="padding: 8px 10px;">Category</th>
                <th style="padding: 8px 10px;">Priority</th>
                <th style="padding: 8px 10px;">Scenario</th>
                <th style="padding: 8px 10px;">Duration</th>
                <th style="padding: 8px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${steps.map(s => `
                <tr style="border-bottom: 1px solid var(--border-subtle); cursor: pointer;" onclick="switchToTest('${s.id}')">
                  <td style="padding: 8px 10px; font-family: ui-monospace, monospace; color: var(--accent); font-weight: 700;">${s.checklistId || s.id}</td>
                  <td style="padding: 8px 10px; color: var(--text-muted);">${s.category || 'Core'}</td>
                  <td style="padding: 8px 10px;"><span class="severity-badge severity-${(s.priority || 'P0').toLowerCase()}">${s.priority || 'P0'}</span></td>
                  <td style="padding: 8px 10px; font-weight: 500;">${s.title}</td>
                  <td style="padding: 8px 10px; font-family: ui-monospace, monospace; color: var(--text-muted);">${((s.durationMs || 0)/1000).toFixed(1)}s</td>
                  <td style="padding: 8px 10px;"><span class="status-badge ${s.status}">${s.status === 'passed' ? '✔' : '✖'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- TAB 2: SUITES & TEST DETAILS -->
      <section id="tab-suites" class="tab-content">
        <div class="suites-layout">
          <!-- Left List -->
          <div class="suites-sidebar">
            <div class="suites-search">
              <input type="text" id="suite-search-input" placeholder="Search scenarios or test IDs..." />
            </div>
            <div class="suites-list" id="suites-tree-list"></div>
          </div>

          <!-- Right Detail -->
          <div class="suites-detail" id="suite-detail-view">
            <div style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 40px;">
              Select a test scenario from the left to view detailed trace, assertions, and screenshot attachments.
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 3: SCREENSHOTS GALLERY -->
      <section id="tab-gallery" class="tab-content">
        <div class="gallery-grid" id="gallery-container"></div>
      </section>

      <!-- TAB 4: WORKSPACE ARTIFACTS -->
      <section id="tab-artifacts" class="tab-content">
        <div id="artifacts-view-container" style="display: flex; flex-direction: column; gap: 14px;"></div>
      </section>

    </div>
  </div>

  <!-- Lightbox Modal -->
  <div class="modal-backdrop" id="allure-modal">
    <div class="modal-container">
      <img id="modal-img-src" src="" alt="Screenshot" />
      <div class="modal-bar">
        <span id="modal-img-title" style="font-weight: 600;"></span>
        <div style="display: flex; gap: 10px;">
          <a id="modal-download-btn" href="#" download="" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px;">⬇ Download Image</a>
          <button id="modal-close-btn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;">✕ Close</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const stepsData = ${serializedSteps};
    const screenshotsMap = ${serializedScreenshots};
    const artifactsMap = ${serializedArtifacts};
    const evidenceData = ${serializedEvidence};
    let activeTestId = stepsData[0] ? stepsData[0].id : null;

    // Tab Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById('tab-' + btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });

    // Modal
    const modal = document.getElementById('allure-modal');
    const modalImg = document.getElementById('modal-img-src');
    const modalTitle = document.getElementById('modal-img-title');
    const modalDownload = document.getElementById('modal-download-btn');
    document.getElementById('modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    function openLightbox(src, filename) {
      modalImg.src = src;
      modalTitle.textContent = filename;
      modalDownload.href = src;
      modalDownload.download = filename;
      modal.style.display = 'flex';
    }

    // Render Suites Tree
    function renderSuitesTree(filterText = '') {
      const tree = document.getElementById('suites-tree-list');
      tree.innerHTML = '';

      const categories = {};
      stepsData.forEach(s => {
        if (filterText) {
          const q = filterText.toLowerCase();
          const match = s.title.toLowerCase().includes(q) || (s.checklistId && s.checklistId.toLowerCase().includes(q));
          if (!match) return;
        }
        const cat = s.sheetName || s.category || 'Core Sanity';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(s);
      });

      Object.entries(categories).forEach(([catName, list]) => {
        const catHeader = document.createElement('div');
        catHeader.className = 'suite-group-title';
        catHeader.innerHTML = '<span>' + catName + '</span><span>' + list.length + '</span>';
        tree.appendChild(catHeader);

        list.forEach(s => {
          const item = document.createElement('div');
          item.className = 'suite-item' + (s.id === activeTestId ? ' active' : '');
          item.dataset.id = s.id;
          const icon = s.status === 'passed' ? '✔' : (s.status === 'skipped' ? '↷' : (s.status === 'stopped' ? '⏹' : '✖'));
          item.innerHTML = \`
            <div class="suite-item-left">
              <span class="status-badge \${s.status}">\${icon}</span>
              <span class="suite-item-text">\${s.checklistId ? '[' + s.checklistId + '] ' : ''}\${s.title}</span>
            </div>
            <div class="suite-item-right">
              <span class="severity-badge severity-\${(s.priority || 'P0').toLowerCase()}">\${s.priority || 'P0'}</span>
              <span style="font-family: ui-monospace, monospace; font-size: 10px; color: var(--text-muted);">\${((s.durationMs||0)/1000).toFixed(1)}s</span>
            </div>
          \`;
          item.addEventListener('click', () => {
            document.querySelectorAll('.suite-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            activeTestId = s.id;
            renderDetail(s);
          });
          tree.appendChild(item);
        });
      });
    }

    // Render Test Details
    function renderDetail(step) {
      const container = document.getElementById('suite-detail-view');
      const isPass = step.status === 'passed';
      const statusIcon = step.status === 'passed' ? '✔' : (step.status === 'skipped' ? '↷' : (step.status === 'stopped' ? '⏹' : '✖'));

      let shotsHtml = '';
      if (step.screenshots && step.screenshots.length > 0) {
        step.screenshots.forEach(shot => {
          const src = screenshotsMap[shot] || '';
          shotsHtml += \`
            <div class="attachment-card">
              <div class="attachment-header">
                <span>📸 <strong>\${shot}</strong> (Captured UI state)</span>
                <a href="\${src}" download="\${shot}" class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;">⬇ Download Screenshot</a>
              </div>
              <img src="\${src}" alt="\${shot}" class="attachment-img-preview" onclick="openLightbox('\${src}', '\${shot}')" />
            </div>
          \`;
        });
      }

      let assertHtml = '';
      (step.assertions || []).forEach(a => {
        assertHtml += \`
          <li style="color: \${a.passed ? 'var(--text)' : 'var(--failed)'}; margin-bottom: 4px;">
            \${a.passed ? '✔' : '✖'} \${a.name}
          </li>
        \`;
      });

      container.innerHTML = \`
        <div class="detail-header">
          <div class="detail-top-row" style="display: flex; align-items: center; gap: 8px;">
            <span class="severity-badge severity-\${(step.priority || 'P0').toLowerCase()}" style="font-size: 11px; padding: 2px 8px;">\${step.priority || 'P0'}</span>
            <span class="status-badge \${step.status}">\${statusIcon}</span>
            <h2 style="margin: 0; font-size: 18px; color: var(--text);">\${step.checklistId ? '[' + step.checklistId + '] ' : ''}\${step.title || step.scenario}</h2>
            <a href="/#/postqode-test?rerun=\${encodeURIComponent(step.checklistId || step.id)}" target="_blank" class="btn btn-primary" style="margin-left: auto; padding: 4px 12px; font-size: 11px; text-decoration: none;" title="Re-run this test in PQ Dashboard">▶ Re-run in Dashboard</a>
          </div>
          <div class="detail-meta-row">
            <span>Sheet: <strong>\${step.sheetName || step.category || 'Core'}</strong></span>
            <span>Duration: <strong>\${((step.durationMs || 0)/1000).toFixed(2)}s</strong></span>
            <span>Status: <strong style="color:\${isPass ? '#3fb950' : '#f85149'}">\${step.status.toUpperCase()}</strong></span>
          </div>
        </div>

        <!-- Description & Steps -->
        <div class="section-card">
          <div class="section-card-title">Test Steps & Scenarios</div>
          <div class="step-timeline-item">
            <div class="step-marker \${step.status}">1</div>
            <div class="step-content">
              <div class="step-name">\${step.scenario || step.title}</div>
              <div class="step-desc">\${step.steps || 'Standard verification execution'}</div>
            </div>
          </div>
          <div style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">
            Expected Result: <span style="color: var(--text);">\${step.expectedResult || 'Execution completed without errors'}</span>
          </div>
        </div>

        <!-- Assertions -->
        <div class="section-card">
          <div class="section-card-title">Verification Assertions (\${(step.assertions||[]).length})</div>
          <ul style="padding-left: 18px; font-size: 12px;">\${assertHtml || '<li>Execution verified</li>'}</ul>
          \${step.error ? '<div style="color:var(--failed); margin-top:8px; font-family:ui-monospace, monospace; font-size:11px;">Error: ' + step.error + '</div>' : ''}
        </div>

        <!-- Attachments -->
        <div class="section-card">
          <div class="section-card-title">
            <span>Visual Evidence Attachments (\${(step.screenshots || []).length})</span>
          </div>
          \${shotsHtml || '<div style="color:var(--text-muted); font-size:12px;">No screenshots captured for this step.</div>'}
        </div>
      \`;
    }

    function switchToTest(id) {
      document.querySelector('.nav-btn[data-tab="suites"]').click();
      activeTestId = id;
      renderSuitesTree();
      const st = stepsData.find(s => s.id === id);
      if (st) renderDetail(st);
    }

    // Gallery Render
    function renderGallery() {
      const g = document.getElementById('gallery-container');
      g.innerHTML = '';
      stepsData.forEach(s => {
        (s.screenshots || []).forEach(shot => {
          const src = screenshotsMap[shot] || '';
          const card = document.createElement('div');
          card.className = 'gallery-card';
          card.innerHTML = \`
            <img src="\${src}" alt="\${shot}" onclick="openLightbox('\${src}', '\${shot}')" loading="lazy" />
            <div class="gallery-card-footer">
              <div>
                <strong>\${s.checklistId ? '[' + s.checklistId + '] ' : ''}\${shot}</strong>
                <div style="font-size: 10px; color: var(--text-muted);">\${s.title}</div>
              </div>
              <a href="\${src}" download="\${shot}" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">⬇ Download</a>
            </div>
          \`;
          g.appendChild(card);
        });
      });
      if (g.children.length === 0) {
        g.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No screenshots available.</div>';
      }
    }

    // Artifacts Render
    function renderArtifacts() {
      const container = document.getElementById('artifacts-view-container');
      container.innerHTML = '';
      const keys = Object.keys(artifactsMap);
      if (keys.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No workspace artifacts modified or preserved.</div>';
        return;
      }
      keys.forEach(file => {
        const content = artifactsMap[file];
        const card = document.createElement('div');
        card.className = 'section-card';
        card.innerHTML = \`
          <div class="section-card-title">
            <span>📄 \${file}</span>
            <a href="data:text/plain;charset=utf-8,\${encodeURIComponent(content)}" download="\${file}" class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;">⬇ Download File</a>
          </div>
          <pre style="background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 4px; padding: 10px; font-family: ui-monospace, monospace; font-size: 11px; overflow-x: auto; color: var(--text);">\${content}</pre>
        \`;
        container.appendChild(card);
      });
    }

    // Search filter
    document.getElementById('suite-search-input').addEventListener('input', (e) => {
      renderSuitesTree(e.target.value);
    });

    // Export JSON
    document.getElementById('btn-download-json').addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({
        runId: "${runId}",
        timestamp: "${timestamp}",
        summary: ${JSON.stringify(summary)},
        steps: stepsData,
        artifacts: artifactsMap,
        evidence: evidenceData
      }, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = 'postqode-test-run-${runId}.json';
      a.click();
    });

    // Save Allure HTML
    document.getElementById('btn-download-html').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = window.location.href + (window.location.search ? '&' : '?') + 'download=1';
      a.download = 'allure-report-${runId}.html';
      a.click();
    });

    // Init
    renderSuitesTree();
    if (stepsData.length > 0) renderDetail(stepsData[0]);
    renderGallery();
    renderArtifacts();
  </script>
</body>
</html>`;
}

module.exports = { generateAllureHtml };
