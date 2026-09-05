/**
 * report.js — Report rendering, run history, and screenshot gallery.
 *
 * Manages:
 *  - loadRuns() — fetches and renders the past runs table
 *  - loadRunReport(runId) — fetches a specific run's JSON
 *  - displayReport(report) — populates KPIs, matrix table, gallery, artifacts, evidence
 *  - Export JSON button
 *  - Lightbox modal wiring
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initReport(state, renderChecklist, startTestRun) {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const reportSection      = document.getElementById('testlab-report-section');
  const reportBadge        = document.getElementById('testlab-report-badge');
  const rerunFailedBtn     = document.getElementById('testlab-rerun-failed-btn');
  const viewAllureBtn      = document.getElementById('testlab-view-allure-btn');
  const downloadAllureBtn  = document.getElementById('testlab-download-allure-btn');
  const downloadBundleBtn  = document.getElementById('testlab-download-bundle-btn');
  const downloadShotsBtn   = document.getElementById('testlab-download-shots-btn');
  const downloadAllShotsLink = document.getElementById('testlab-download-all-shots-link');
  const exportHtmlBtn      = document.getElementById('testlab-export-html-btn');
  const exportJsonBtn      = document.getElementById('testlab-export-json-btn');

  const kpiPassRate   = document.getElementById('testlab-kpi-passrate');
  const kpiTests      = document.getElementById('testlab-kpi-tests');
  const kpiDuration   = document.getElementById('testlab-kpi-duration');
  const kpiHost       = document.getElementById('testlab-kpi-host');
  const kpiVersion    = document.getElementById('testlab-kpi-version');
  const kpiOs         = document.getElementById('testlab-kpi-os');
  const kpiModel      = document.getElementById('testlab-kpi-model');
  const matrixTbody   = document.getElementById('testlab-report-matrix-tbody');
  const screenshotsGrid   = document.getElementById('testlab-screenshots-grid');
  const artifactsContainer = document.getElementById('testlab-artifacts-container');
  const artifactsBadge    = document.getElementById('testlab-artifacts-badge');
  const evidenceDetails   = document.getElementById('testlab-evidence-details');

  const runsTableContainer = document.getElementById('testlab-runs-table-container');
  const refreshRunsBtn     = document.getElementById('testlab-refresh-runs-btn');

  const modal           = document.getElementById('testlab-modal');
  const modalImg        = document.getElementById('testlab-modal-img');
  const modalCaption    = document.getElementById('testlab-modal-caption');
  const modalDownloadBtn = document.getElementById('testlab-modal-download-btn');
  const modalCloseBtn   = document.getElementById('testlab-modal-close-btn');

  // ── Lightbox ──────────────────────────────────────────────────────────────
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => (modal.style.display = 'none'));
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  // ── Export JSON ───────────────────────────────────────────────────────────
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      if (!state.currentReportData) return;
      const blob = new Blob([JSON.stringify(state.currentReportData, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `postqode-report-${state.currentReportData.runId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── Load past runs ────────────────────────────────────────────────────────
  async function loadRuns() {
    try {
      const res  = await fetch('/api/postqode-test/runs');
      const data = await res.json();
      if (!data.runs || data.runs.length === 0) {
        runsTableContainer.innerHTML =
          '<div style="color: var(--text-3); font-size: 12px;">No previous test runs recorded. Click "Run Selected Scenarios" above to start.</div>';
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
          <tbody>`;

      for (const run of data.runs) {
        const passRate    = `${run.summary.passed}/${run.summary.total}`;
        const isPass      = run.summary.failed === 0;
        const statusBadge = isPass
          ? `<span class="testlab-info-badge success">Passed (${passRate})</span>`
          : `<span class="testlab-info-badge" style="background: rgba(248,81,73,0.15); color: #f85149;">Failed (${run.summary.failed} errors)</span>`;

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
              <button class="testlab-btn testlab-btn-secondary view-report-btn" data-run-id="${run.runId}" style="padding: 3px 8px; font-size: 11px;">View</button>
              <a href="/api/postqode-test/runs/${run.runId}/allure-report" target="_blank" class="testlab-btn testlab-btn-primary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;">📊 Allure</a>
              <a href="/api/postqode-test/runs/${run.runId}/download-bundle" class="testlab-btn testlab-btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;" title="Download zip bundle">📦 Zip</a>
            </td>
          </tr>`;
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

  if (refreshRunsBtn) refreshRunsBtn.addEventListener('click', loadRuns);

  // ── Load individual report ────────────────────────────────────────────────
  async function loadRunReport(runId) {
    try {
      const res    = await fetch(`/api/postqode-test/runs/${runId}`);
      const report = await res.json();
      displayReport(report);
    } catch (e) {
      alert(`Error loading report: ${e.message}`);
    }
  }

  // ── displayReport ─────────────────────────────────────────────────────────
  function displayReport(report) {
    state.currentReportData = report;
    reportSection.style.display = 'block';
    reportSection.scrollIntoView({ behavior: 'smooth' });

    const isAllPass = report.summary.failed === 0;
    reportBadge.textContent = isAllPass ? 'ALL TESTS PASSED' : `FAILED (${report.summary.failed} ERRORS)`;
    reportBadge.className   = isAllPass ? 'testlab-info-badge success' : 'testlab-info-badge';
    if (!isAllPass) {
      reportBadge.style.background = 'rgba(248,81,73,0.15)';
      reportBadge.style.color      = '#f85149';
    } else {
      reportBadge.style.background = '';
      reportBadge.style.color      = '';
    }

    // Link buttons
    if (viewAllureBtn)       viewAllureBtn.href      = `/api/postqode-test/runs/${report.runId}/allure-report`;
    if (downloadAllureBtn)   downloadAllureBtn.href  = `/api/postqode-test/runs/${report.runId}/allure-report?download=1`;
    if (downloadBundleBtn)   downloadBundleBtn.href  = `/api/postqode-test/runs/${report.runId}/download-bundle`;
    if (downloadShotsBtn)    downloadShotsBtn.href   = `/api/postqode-test/runs/${report.runId}/download-screenshots`;
    if (downloadAllShotsLink) downloadAllShotsLink.href = `/api/postqode-test/runs/${report.runId}/download-screenshots`;
    if (exportHtmlBtn)       exportHtmlBtn.href      = `/api/postqode-test/runs/${report.runId}/export-html`;

    // KPI cards
    const passPct = report.summary.total
      ? Math.round((report.summary.passed / report.summary.total) * 100) : 0;
    kpiPassRate.textContent = `${passPct}%`;
    kpiPassRate.style.color  = isAllPass ? '#3fb950' : '#f85149';
    kpiTests.textContent     = `${report.summary.passed} / ${report.summary.total}`;
    kpiDuration.textContent  = `${((report.summary.durationMs || 0) / 1000).toFixed(1)}s`;
    kpiHost.textContent      = `${report.host} (${report.buildSource || 'installed'})`;
    if (kpiVersion) kpiVersion.textContent = (report.environment?.postqodeVersion) || report.postqodeVersion || 'v3.0.26-beta.2';
    if (kpiOs)      kpiOs.textContent      = (report.environment?.os) || report.os || 'macOS';
    if (kpiModel)   kpiModel.textContent   = (report.environment?.defaultModel) || report.liveModel || (report.mode === 'live' ? 'kimi-k3' : 'Mock Engine');

    // ── Matrix table ──────────────────────────────────────────────────────
    matrixTbody.innerHTML = '';
    for (const step of report.steps || []) {
      const isPass    = step.status === 'passed';
      const isSkipped = step.status === 'skipped';
      const isStopped = step.status === 'stopped';

      let statusHtml = '';
      if (isPass)         statusHtml = '<span class="testlab-info-badge success" style="font-size: 10px;">PASSED</span>';
      else if (isSkipped) statusHtml = '<span class="testlab-info-badge" style="background: rgba(139,148,158,0.2); color: #8b949e; font-size: 10px;">SKIPPED</span>';
      else if (isStopped) statusHtml = '<span class="testlab-info-badge" style="background: rgba(240,136,62,0.2); color: #f0883e; font-size: 10px;">STOPPED</span>';
      else                statusHtml = '<span class="testlab-info-badge" style="background: rgba(248,81,73,0.15); color: #f85149; font-size: 10px;">FAILED</span>';

      let evidenceHtml = '';
      if (step.screenshots?.length > 0) {
        for (const shot of step.screenshots) {
          const shotUrl = `/api/postqode-test/runs/${report.runId}/screenshots/${shot}`;
          evidenceHtml += `<img src="${shotUrl}" alt="${shot}" class="testlab-thumb" title="${shot}" data-shot="${shotUrl}" data-caption="${step.title} (${shot})" />`;
        }
      } else {
        evidenceHtml = '<span style="color: var(--text-3); font-size: 10px;">None</span>';
      }

      let assertList = '';
      if (step.assertions?.length > 0) {
        assertList = `<ul style="margin: 0; padding-left: 14px; font-size: 11px; color: var(--text-2);">
          ${step.assertions.map((a) => `<li style="color: ${a.passed ? 'var(--text-2)' : '#f85149'};">${a.passed ? '✔' : '✖'} ${a.name}</li>`).join('')}
        </ul>`;
      }
      if (step.error) {
        assertList += `<div style="color: #f85149; font-family: var(--font-mono); font-size: 10px; margin-top: 4px;">${step.error}</div>`;
      }

      const modelVal   = step.model || (report.mode === 'live' ? (report.liveModel || 'kimi-k3') : 'Mock SSE');
      let modelClass   = 'testlab-badge-live';
      if (modelVal.includes('UI / DOM') || modelVal.includes('VSIX') || modelVal.includes('Host') || modelVal.includes('Settings')) {
        modelClass = 'testlab-badge-dom';
      } else if (modelVal.includes('Mock') || modelVal.includes('Fault')) {
        modelClass = 'testlab-badge-mock';
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-family: var(--font-mono); color: var(--accent); font-weight: 700;">${step.checklistId || step.id}</td>
        <td style="color: var(--text-3); font-size: 11px;">${step.sheetName || step.category || 'Core'}</td>
        <td>
          <div style="font-weight: 600; color: var(--text);">${step.title || step.scenario}</div>
          <div style="font-size: 11px; color: var(--text-3); margin-top: 2px; white-space: pre-line;">${step.steps || ''}</div>
        </td>
        <td>
          <span class="testlab-model-pill ${modelClass}" title="${escapeHtml(modelVal)}">${escapeHtml(modelVal)}</span>
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
        </td>`;
      matrixTbody.appendChild(row);
    }

    // Re-run single test
    matrixTbody.querySelectorAll('.rerun-single-test-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const testId = btn.dataset.checklist || btn.dataset.id;
        state.scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.id === btn.dataset.id || sc.checklistId === btn.dataset.checklist;
        });
        renderChecklist(state.currentCategory);
        startTestRun([testId]);
      });
    });

    // Re-run all failed
    if (rerunFailedBtn) {
      if (report.summary.failed > 0) {
        rerunFailedBtn.style.display = 'inline-flex';
        rerunFailedBtn.textContent   = `🔄 Re-run ${report.summary.failed} Failed Test(s)`;
        rerunFailedBtn.onclick = () => {
          const failedIds = (report.steps || [])
            .filter((s) => s.status === 'failed')
            .map((s) => s.checklistId || s.id);
          state.scenariosData.forEach((sc) => {
            sc.defaultChecked = failedIds.includes(sc.checklistId) || failedIds.includes(sc.id);
          });
          renderChecklist(state.currentCategory);
          startTestRun(failedIds);
        };
      } else {
        rerunFailedBtn.style.display = 'none';
      }
    }

    // Matrix thumbnail click → lightbox
    matrixTbody.querySelectorAll('.testlab-thumb').forEach((img) => {
      img.addEventListener('click', () => {
        modalImg.src              = img.dataset.shot;
        modalCaption.textContent  = img.dataset.caption;
        if (modalDownloadBtn) { modalDownloadBtn.href = img.dataset.shot; modalDownloadBtn.download = img.getAttribute('title') || 'screenshot.png'; }
        modal.style.display = 'flex';
      });
    });

    // ── Screenshots gallery ───────────────────────────────────────────────
    screenshotsGrid.innerHTML = '';
    let hasScreenshots = false;
    for (const step of report.steps || []) {
      for (const shot of step.screenshots || []) {
        hasScreenshots = true;
        const shotUrl  = `/api/postqode-test/runs/${report.runId}/screenshots/${shot}`;
        const card     = document.createElement('div');
        card.className = 'testlab-screenshot-card';
        card.innerHTML = `
          <img src="${shotUrl}" alt="${shot}" loading="lazy" />
          <div class="testlab-screenshot-title" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="overflow: hidden;">
              <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${step.checklistId ? `[${step.checklistId}] ` : ''}${step.title}</span>
              <span style="font-size: 10px; color: var(--text-3); font-family: var(--font-mono);">${shot}</span>
            </div>
            <a href="${shotUrl}" download="${shot}" class="testlab-btn testlab-btn-secondary"
               style="padding: 2px 8px; font-size: 10px; text-decoration: none; flex-shrink: 0;"
               onclick="event.stopPropagation();">⬇ Download</a>
          </div>`;
        card.addEventListener('click', () => {
          modalImg.src             = shotUrl;
          modalCaption.textContent = `${step.title} (${shot})`;
          if (modalDownloadBtn) { modalDownloadBtn.href = shotUrl; modalDownloadBtn.download = shot; }
          modal.style.display = 'flex';
        });
        screenshotsGrid.appendChild(card);
      }
    }
    if (!hasScreenshots) {
      screenshotsGrid.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No screenshots captured for this run.</div>';
    }

    // ── Preserved artifacts ───────────────────────────────────────────────
    artifactsContainer.innerHTML = '';
    const artifacts = report.artifacts || [];
    if (artifactsBadge) artifactsBadge.textContent = `${artifacts.length} files`;
    if (artifacts.length === 0) {
      artifactsContainer.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No modified workspace files preserved.</div>';
    } else {
      for (const file of artifacts) {
        const item = document.createElement('div');
        Object.assign(item.style, { background: 'var(--bg-3)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        item.innerHTML = `
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--text);">${file}</div>
          <a href="/api/postqode-test/runs/${report.runId}/artifacts/${file}" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding: 2px 8px; font-size: 11px;">Inspect File</a>`;
        artifactsContainer.appendChild(item);
      }
    }

    // ── Intercepted evidence ──────────────────────────────────────────────
    evidenceDetails.innerHTML = '';
    if (!report.evidence?.length) {
      evidenceDetails.innerHTML = '<div style="color: var(--text-3); font-size: 12px;">No network calls intercepted or recorded.</div>';
    } else {
      for (const ev of report.evidence) {
        const item = document.createElement('div');
        Object.assign(item.style, { background: 'var(--bg-3)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' });
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
            <strong style="color: var(--text);">${ev.method} ${ev.url}</strong>
            <span class="testlab-info-badge success">${ev.isMocked ? 'Mocked SSE' : 'Live'} (${ev.duration}ms)</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-2); margin-bottom: 6px;">
            Scenario: <code>${ev.scenario}</code> | Timestamp: ${ev.timestamp}
          </div>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text); background: var(--bg-2); padding: 8px; border-radius: 4px; max-height: 120px; overflow-y: auto; white-space: pre-wrap;">${ev.responseBodyPreview || 'No response body preview'}</div>`;
        evidenceDetails.appendChild(item);
      }
    }
  }

  // Kick off initial run history load
  loadRuns();

  return { loadRuns, loadRunReport, displayReport };
}
