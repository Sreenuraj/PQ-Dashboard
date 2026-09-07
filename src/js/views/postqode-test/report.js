/**
 * report.js — Report rendering, run history, and screenshot gallery.
 *
 * Manages:
 *  - loadRuns() — fetches and renders the past runs table (5/page, paginated)
 *  - loadRunReport(runId) — fetches a specific run's JSON
 *  - displayReport(report) — populates KPIs, matrix table, gallery, artifacts, evidence
 *  - Feature Area filter dropdown (client-side filtering of matrix rows)
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

const PAGE_SIZE = 5;

export function initReport(state, renderChecklist, startTestRun) {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const reportSection      = document.getElementById('testlab-report-section');
  const reportBadge        = document.getElementById('testlab-report-badge');
  const closeReportBtn     = document.getElementById('testlab-close-report-btn');
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
  const screenshotsGrid    = document.getElementById('testlab-screenshots-grid');
  const artifactsContainer = document.getElementById('testlab-artifacts-container');
  const artifactsBadge     = document.getElementById('testlab-artifacts-badge');
  const evidenceDetails    = document.getElementById('testlab-evidence-details');
  const areaFilter         = document.getElementById('testlab-area-filter');
  const areaFilterCount    = document.getElementById('testlab-area-filter-count');

  const runsTableContainer = document.getElementById('testlab-runs-table-container');
  const refreshRunsBtn     = document.getElementById('testlab-refresh-runs-btn');
  const runsPrevBtn        = document.getElementById('testlab-runs-prev-btn');
  const runsNextBtn        = document.getElementById('testlab-runs-next-btn');
  const runsPaginationInfo = document.getElementById('testlab-runs-pagination-info');

  const modal            = document.getElementById('testlab-modal');
  const modalImg         = document.getElementById('testlab-modal-img');
  const modalCaption     = document.getElementById('testlab-modal-caption');
  const modalDownloadBtn = document.getElementById('testlab-modal-download-btn');
  const modalCloseBtn    = document.getElementById('testlab-modal-close-btn');

  const livePromoBanner   = document.getElementById('testlab-live-promo-banner');
  const livePromoCount    = document.getElementById('testlab-live-promo-count');
  const livePromoDesc     = document.getElementById('testlab-live-promo-desc');
  const promoteAllBtn     = document.getElementById('testlab-promote-all-btn');

  function showToast(msg, type = 'success') {
    let toast = document.getElementById('testlab-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'testlab-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        background: #161b22;
        color: #f0f6fc;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 12px 18px;
        font-size: 12px;
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.25s ease, transform 0.25s ease;
        transform: translateY(10px);
        opacity: 0;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    const icon = type === 'success' ? '✔' : (type === 'error' ? '✖' : '⚡');
    const color = type === 'success' ? '#3fb950' : (type === 'error' ? '#f85149' : '#58a6ff');
    toast.innerHTML = `<span style="color:${color};font-weight:bold;font-size:14px;">${icon}</span> <span style="line-height:1.4;">${msg}</span>`;
    toast.style.display = 'flex';
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => { toast.style.display = 'none'; }, 250);
    }, 4000);
  }

  // Pagination state
  let allRuns     = [];
  let currentPage = 0;

  // ── Close report ──────────────────────────────────────────────────────────
  if (closeReportBtn) {
    closeReportBtn.addEventListener('click', () => {
      reportSection.style.display = 'none';
    });
  }

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

  // ── Feature Area filter ───────────────────────────────────────────────────
  function wireAreaFilter() {
    if (!areaFilter) return;
    areaFilter.addEventListener('change', () => applyAreaFilter());
  }

  function applyAreaFilter() {
    if (!areaFilter) return;
    const selected = areaFilter.value;
    const rows     = matrixTbody.querySelectorAll('tr');
    let visible    = 0;
    rows.forEach((row) => {
      const area = row.dataset.area || '';
      if (!selected || area === selected) {
        row.style.display = '';
        visible++;
      } else {
        row.style.display = 'none';
      }
    });
    if (areaFilterCount) {
      areaFilterCount.textContent = selected
        ? `${visible} test${visible !== 1 ? 's' : ''} in this area`
        : '';
    }
  }

  function populateAreaFilter(steps) {
    if (!areaFilter) return;
    const areas = [...new Set((steps || []).map((s) => s.sheetName || s.category || 'Core').filter(Boolean))];
    areaFilter.innerHTML = '<option value="">All Areas</option>';
    areas.forEach((area) => {
      const opt = document.createElement('option');
      opt.value       = area;
      opt.textContent = area;
      areaFilter.appendChild(opt);
    });
  }

  wireAreaFilter();

  // ── Render one page of runs ───────────────────────────────────────────────
  function renderRunsPage(page) {
    currentPage = page;
    const total     = allRuns.length;
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const start     = page * PAGE_SIZE;
    const end       = Math.min(start + PAGE_SIZE, total);
    const pageRuns  = allRuns.slice(start, end);

    if (runsPaginationInfo) {
      runsPaginationInfo.textContent = total > PAGE_SIZE
        ? `${start + 1}–${end} of ${total}`
        : `${total} run${total !== 1 ? 's' : ''}`;
    }
    if (runsPrevBtn) runsPrevBtn.disabled = page === 0;
    if (runsNextBtn) runsNextBtn.disabled = page >= pageCount - 1;

    if (pageRuns.length === 0) {
      runsTableContainer.innerHTML =
        '<div style="color: var(--text-3); font-size: 12px;">No previous test runs. Click "Run Selected Scenarios" above to start.</div>';
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
            <th style="padding: 8px 10px;">Version</th>
            <th style="padding: 8px 10px;">OS</th>
            <th style="padding: 8px 10px;">Result</th>
            <th style="padding: 8px 10px;">Duration</th>
            <th style="padding: 8px 10px; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>`;

    for (const run of pageRuns) {
      const passRate    = `${run.summary.passed}/${run.summary.total}`;
      const isPass      = run.summary.failed === 0;
      const statusBadge = isPass
        ? `<span class="testlab-info-badge success">Passed (${passRate})</span>`
        : `<span class="testlab-info-badge" style="background:rgba(248,81,73,0.15);color:#f85149;">Failed (${run.summary.failed} fail)</span>`;

      const version = (run.environment?.postqodeVersion) || run.postqodeVersion || '—';
      const os      = (run.environment?.os) || run.os || '—';

      const modeBadge = run.mode === 'live'
        ? `<span class="testlab-info-badge" style="background:rgba(56,139,253,0.15);color:#58a6ff;font-size:10px;">Live</span>`
        : `<span class="testlab-info-badge" style="background:rgba(139,148,158,0.15);color:#8b949e;font-size:10px;">Mocked</span>`;

      const recBadge = (run.hasLiveRecordings || (run.capturedScenariosCount || 0) > 0)
        ? `<span class="testlab-info-badge" style="background:rgba(163,113,247,0.15);color:#bc8cff;font-size:9.5px;margin-left:4px;" title="Captured live recordings available to promote">⚡ ${run.capturedScenariosCount || ''} rec</span>`
        : '';

      html += `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 8px 10px; font-family: var(--font-mono); font-size: 10px; color: var(--text-2);">${run.runId}</td>
          <td style="padding: 8px 10px; color: var(--text-2);">${new Date(run.timestamp).toLocaleString()}</td>
          <td style="padding: 8px 10px;">${run.host}</td>
          <td style="padding: 8px 10px;"><span class="testlab-info-badge" style="font-size: 10px;">${run.buildSource || 'installed'}</span></td>
          <td style="padding: 8px 10px;">${modeBadge}${recBadge}</td>
          <td style="padding: 8px 10px; font-family:var(--font-mono); color:var(--accent-cyan,#58a6ff); font-size:11px;">${version}</td>
          <td style="padding: 8px 10px; color: var(--text-3); font-size: 11px;">${os}</td>
          <td style="padding: 8px 10px;">${statusBadge}</td>
          <td style="padding: 8px 10px; font-family:var(--font-mono);">${(run.summary.durationMs / 1000).toFixed(1)}s</td>
          <td style="padding: 8px 10px; text-align: right; white-space: nowrap;">
            <button class="testlab-btn testlab-btn-secondary view-report-btn" data-run-id="${run.runId}" style="padding: 3px 8px; font-size: 11px;">View</button>
            <a href="/api/postqode-test/runs/${run.runId}/allure-report" target="_blank"
               class="testlab-btn testlab-btn-primary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;">📊 Allure</a>
            <a href="/api/postqode-test/runs/${run.runId}/download-bundle"
               class="testlab-btn testlab-btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none; margin-left: 4px;" title="Download zip">📦</a>
          </td>
        </tr>`;
    }

    html += '</tbody></table>';
    runsTableContainer.innerHTML = html;

    runsTableContainer.querySelectorAll('.view-report-btn').forEach((btn) => {
      btn.addEventListener('click', () => loadRunReport(btn.dataset.runId));
    });
  }

  // ── Load past runs ────────────────────────────────────────────────────────
  async function loadRuns() {
    try {
      const res  = await fetch('/api/postqode-test/runs');
      const data = await res.json();
      allRuns = data.runs || [];

      if (allRuns.length === 0) {
        runsTableContainer.innerHTML =
          '<div style="color:var(--text-3);font-size:12px;">No previous test runs. Click "Run Selected Scenarios" above to start.</div>';
        if (runsPaginationInfo) runsPaginationInfo.textContent = '';
        if (runsPrevBtn) runsPrevBtn.disabled = true;
        if (runsNextBtn) runsNextBtn.disabled = true;
        return;
      }
      renderRunsPage(0);
    } catch (e) {
      runsTableContainer.innerHTML = `<div style="color:#f85149;font-size:12px;">Failed to load runs: ${e.message}</div>`;
    }
  }

  if (refreshRunsBtn) refreshRunsBtn.addEventListener('click', loadRuns);
  if (runsPrevBtn) runsPrevBtn.addEventListener('click', () => renderRunsPage(currentPage - 1));
  if (runsNextBtn) runsNextBtn.addEventListener('click', () => renderRunsPage(currentPage + 1));

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
    // Scroll to report section (which is now below the runs table)
    setTimeout(() => reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

    const isAllPass = report.summary.failed === 0;
    reportBadge.textContent = isAllPass ? 'ALL PASSED' : `${report.summary.failed} FAILED`;
    reportBadge.className   = isAllPass ? 'testlab-info-badge success' : 'testlab-info-badge';
    reportBadge.style.background = isAllPass ? '' : 'rgba(248,81,73,0.15)';
    reportBadge.style.color      = isAllPass ? '' : '#f85149';

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
    if (kpiVersion) kpiVersion.textContent = (report.environment?.postqodeVersion) || report.postqodeVersion || '—';
    if (kpiOs)      kpiOs.textContent      = (report.environment?.os) || report.os || '—';
    if (kpiModel) {
      const p = report.environment?.liveProvider || report.liveProvider;
      const m = report.environment?.defaultModel || report.liveModel;
      kpiModel.textContent = p && m && !m.includes(p) ? `${p} / ${m}` : (m || (report.mode === 'live' ? 'kimi-k3' : 'Mock Engine'));
    }

    // Populate area filter dropdown
    populateAreaFilter(report.steps);

    // ── Live Capture & Promotion Banner ──────────────────────────────────
    const capturedSteps = (report.steps || []).filter((s) => s.hasLiveRecording || (s.liveCapture && s.liveCapture.hasRecording));
    const capturedCount = capturedSteps.length || (report.capturedScenarios || []).length;
    const isLiveMode = report.mode === 'live' || !!report.hasLiveRecordings;

    if (livePromoBanner) {
      if (isLiveMode && (capturedCount > 0 || (report.steps && report.steps.length > 0))) {
        livePromoBanner.style.display = 'flex';
        const countToShow = capturedCount || report.steps.length;
        if (livePromoCount) livePromoCount.textContent = `${countToShow} Scenario${countToShow !== 1 ? 's' : ''}`;
        if (livePromoDesc) {
          const modelName = report.liveModel || report.environment?.defaultModel || 'moonshotai/kimi-k3';
          livePromoDesc.innerHTML = `Real model SSE network streams &amp; PostQode task sessions were captured from <code style="color:#a371f7;font-family:var(--font-mono);">${escapeHtml(modelName)}</code>. Would you like to replace the current mock baselines with these live recordings?`;
        }
        if (promoteAllBtn) {
          promoteAllBtn.textContent = `⚡ Replace All Mocks with Live (${countToShow})`;
          promoteAllBtn.disabled = false;
          promoteAllBtn.onclick = async () => {
            promoteAllBtn.disabled = true;
            promoteAllBtn.textContent = '⏳ Promoting to Mock Baselines...';
            try {
              const res = await fetch('/api/postqode-test/promote-recording', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: report.runId, all: true }),
              });
              const json = await res.json();
              if (json.success) {
                showToast(`✔ Successfully replaced ${json.count} mock baseline(s) with live model recordings!`, 'success');
                promoteAllBtn.textContent = '✔ All Mocks Replaced with Live';
                promoteAllBtn.classList.remove('testlab-btn-primary');
                promoteAllBtn.classList.add('testlab-btn-secondary');
                // Update table badges
                matrixTbody.querySelectorAll('.promote-recording-btn').forEach((btn) => {
                  const badge = document.createElement('span');
                  badge.className = 'testlab-info-badge success';
                  badge.style.cssText = 'font-size:9px;padding:2px 6px;white-space:nowrap;';
                  badge.textContent = '✔ Live Mock Active';
                  btn.replaceWith(badge);
                });
              } else {
                showToast(`Error: ${json.error || 'Failed to promote recordings'}`, 'error');
                promoteAllBtn.disabled = false;
                promoteAllBtn.textContent = `⚡ Replace All Mocks with Live (${countToShow})`;
              }
            } catch (err) {
              showToast(`Network error: ${err.message}`, 'error');
              promoteAllBtn.disabled = false;
              promoteAllBtn.textContent = `⚡ Replace All Mocks with Live (${countToShow})`;
            }
          };
        }
      } else {
        livePromoBanner.style.display = 'none';
      }
    }

    // ── Matrix table ──────────────────────────────────────────────────────
    matrixTbody.innerHTML = '';
    for (const step of report.steps || []) {
      const isPass    = step.status === 'passed';
      const isSkipped = step.status === 'skipped';
      const isStopped = step.status === 'stopped';

      let statusHtml = '';
      if (isPass)         statusHtml = '<span class="testlab-info-badge success" style="font-size:10px;">PASSED</span>';
      else if (isSkipped) statusHtml = '<span class="testlab-info-badge" style="background:rgba(139,148,158,0.2);color:#8b949e;font-size:10px;">SKIPPED</span>';
      else if (isStopped) statusHtml = '<span class="testlab-info-badge" style="background:rgba(240,136,62,0.2);color:#f0883e;font-size:10px;">STOPPED</span>';
      else                statusHtml = '<span class="testlab-info-badge" style="background:rgba(248,81,73,0.15);color:#f85149;font-size:10px;">FAILED</span>';

      let evidenceHtml = '';
      if (step.screenshots?.length > 0) {
        for (const shot of step.screenshots) {
          const shotUrl = `/api/postqode-test/runs/${report.runId}/screenshots/${shot}`;
          evidenceHtml += `<img src="${shotUrl}" alt="${shot}" class="testlab-thumb" title="${shot}" data-shot="${shotUrl}" data-caption="${step.title} (${shot})" />`;
        }
      } else {
        evidenceHtml = '<span style="color:var(--text-3);font-size:10px;">None</span>';
      }

      let assertList = '';
      if (step.assertions?.length > 0) {
        assertList = `<ul style="margin:0;padding-left:14px;font-size:11px;color:var(--text-2);">
          ${step.assertions.map((a) => `<li style="color:${a.passed ? 'var(--text-2)' : '#f85149'};">${a.passed ? '✔' : '✖'} ${a.name}</li>`).join('')}
        </ul>`;
      }
      if (step.error) {
        assertList += `<div style="color:#f85149;font-family:var(--font-mono);font-size:10px;margin-top:4px;">${step.error}</div>`;
      }

      const modelVal   = step.model || (report.mode === 'live' ? (report.liveModel || 'kimi-k3') : 'Mock SSE');
      let modelClass   = 'testlab-badge-live';
      if (modelVal.includes('UI / DOM') || modelVal.includes('VSIX') || modelVal.includes('Host') || modelVal.includes('Settings')) {
        modelClass = 'testlab-badge-dom';
      } else if (modelVal.includes('Mock') || modelVal.includes('Fault')) {
        modelClass = 'testlab-badge-mock';
      }

      const area = step.sheetName || step.category || 'Core';
      const row  = document.createElement('tr');
      row.dataset.area = area;  // used for client-side filter

      const pipelineHtml = step.pipeline ? `
        <details style="margin-top:6px;font-size:10px;color:var(--text-3);">
          <summary style="cursor:pointer;color:var(--accent);font-weight:600;display:inline-flex;align-items:center;gap:4px;">
            <span>🔍 4-Phase Contract</span>
          </summary>
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:6px 8px;margin-top:4px;line-height:1.5;">
            <div><strong style="color:var(--text-2);">1. Request:</strong> ${escapeHtml(step.pipeline.request || 'Dispatched')}</div>
            <div><strong style="color:var(--text-2);">2. Tools:</strong> <code style="font-family:var(--font-mono);color:#79c0ff;">${escapeHtml(step.pipeline.tools || 'None')}</code></div>
            <div><strong style="color:var(--text-2);">3. Response:</strong> ${escapeHtml(step.pipeline.response || 'Streaming handled')}</div>
            <div><strong style="color:var(--text-2);">4. UI & Side Effects:</strong> <span style="color:#7ee787;">${escapeHtml(step.pipeline.uiAndSideEffects || 'State verified')}</span></div>
          </div>
        </details>` : '';

      const meaningHtml = step.meaning ? `
        <div style="font-size:11px;color:#58a6ff;background:rgba(56,139,253,0.08);border-left:3px solid #388bfd;padding:4px 8px;border-radius:4px;margin-top:4px;">
          <strong>Purpose:</strong> ${escapeHtml(step.meaning)}
        </div>` : '';

      const sideEffectsBadge = step.sideEffects ? `
        <span class="testlab-info-badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;font-size:9px;font-weight:600;margin-left:6px;vertical-align:middle;">${escapeHtml(step.sideEffects)}</span>` : '';

      // Live Promotion button / badge
      let promoteBtnHtml = '';
      const isPromoted = step.isPromoted || (step.baselineMeta && step.baselineMeta.activeAsMock !== false && step.baselineMeta.sourceRunId === report.runId);
      const isBaselineActive = step.baselineMeta && step.baselineMeta.activeAsMock !== false;

      if (isPromoted) {
        promoteBtnHtml = `
          <span class="testlab-info-badge success" style="font-size:9px;padding:2px 6px;white-space:nowrap;" title="Live recording active as mock baseline (${step.baselineMeta?.chunksCount || 0} chunks)">
            ✔ Live Mock Active
          </span>`;
      } else if (step.hasLiveRecording || (step.liveCapture && step.liveCapture.hasRecording) || report.mode === 'live') {
        const chunksLabel = step.liveCapture?.chunksCount ? ` (${step.liveCapture.chunksCount} chunks)` : '';
        promoteBtnHtml = `
          <button class="testlab-btn testlab-btn-secondary promote-recording-btn"
                  data-id="${step.id}"
                  style="padding:2px 8px;font-size:9.5px;white-space:nowrap;color:#58a6ff;border-color:rgba(56,139,253,0.4);"
                  title="Replace mock baseline with this live recording${chunksLabel}">
            ⚡ Replace Mock
          </button>`;
      } else if (isBaselineActive) {
        promoteBtnHtml = `
          <span class="testlab-info-badge success" style="font-size:9px;padding:2px 6px;white-space:nowrap;" title="Replaying promoted live baseline from ${step.baselineMeta?.model || 'live model'}">
            ⚡ Promoted Live
          </span>`;
      }

      row.innerHTML = `
        <td style="font-family:var(--font-mono);color:var(--accent);font-weight:700;">${step.checklistId || step.id}</td>
        <td style="color:var(--text-3);font-size:11px;">${area}</td>
        <td>
          <div style="font-weight:600;color:var(--text);">
            ${step.title || step.scenario}
            ${sideEffectsBadge}
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px;white-space:pre-line;">${step.steps || ''}</div>
          ${meaningHtml}
          ${pipelineHtml}
        </td>
        <td>
          <span class="testlab-model-pill ${modelClass}" title="${escapeHtml(modelVal)}">${escapeHtml(modelVal)}</span>
        </td>
        <td style="color:var(--text-2);font-size:11px;">${step.expectedResult || 'Verified without error'}</td>
        <td>${assertList || `<span style="color:var(--text-2);font-size:11px;">${step.actualResult || 'Verified'}</span>`}</td>
        <td style="font-family:var(--font-mono);color:var(--text-3);">${((step.durationMs || 0) / 1000).toFixed(1)}s</td>
        <td>${statusHtml}</td>
        <td><div style="display:flex;gap:4px;">${evidenceHtml}</div></td>
        <td>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
            <button class="testlab-btn ${step.status === 'failed' ? 'testlab-btn-danger' : 'testlab-btn-secondary'} rerun-single-test-btn"
                    data-id="${step.id}" data-checklist="${step.checklistId || ''}"
                    style="padding:3px 8px;font-size:10px;white-space:nowrap;"
                    title="Run only [${step.checklistId || step.id}]">
              ▶ Re-run
            </button>
            ${promoteBtnHtml}
          </div>
        </td>`;
      matrixTbody.appendChild(row);
    }

    // Individual Replace Mock button clicks
    matrixTbody.querySelectorAll('.promote-recording-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const scenarioId = btn.dataset.id;
        btn.disabled = true;
        btn.textContent = '⏳ Replacing...';
        try {
          const res = await fetch('/api/postqode-test/promote-recording', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: report.runId, scenarioId }),
          });
          const json = await res.json();
          if (json.success) {
            showToast(`✔ Replaced mock baseline for ${scenarioId} with live model recording!`, 'success');
            const badge = document.createElement('span');
            badge.className = 'testlab-info-badge success';
            badge.style.cssText = 'font-size:9px;padding:2px 6px;white-space:nowrap;';
            badge.textContent = '✔ Live Mock Active';
            badge.title = 'Live recording is active as mock baseline';
            btn.replaceWith(badge);
          } else {
            showToast(`Failed to promote ${scenarioId}: ${json.error}`, 'error');
            btn.disabled = false;
            btn.textContent = '⚡ Replace Mock';
          }
        } catch (err) {
          showToast(`Network error: ${err.message}`, 'error');
          btn.disabled = false;
          btn.textContent = '⚡ Replace Mock';
        }
      });
    });

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
        rerunFailedBtn.textContent   = `🔄 Re-run ${report.summary.failed} Failed`;
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

    // Apply default area filter (All Areas)
    applyAreaFilter();

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
          <div class="testlab-screenshot-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="overflow:hidden;">
              <span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${step.checklistId ? `[${step.checklistId}] ` : ''}${step.title}</span>
              <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);">${shot}</span>
            </div>
            <a href="${shotUrl}" download="${shot}" class="testlab-btn testlab-btn-secondary"
               style="padding:2px 8px;font-size:10px;text-decoration:none;flex-shrink:0;"
               onclick="event.stopPropagation();">⬇</a>
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
      screenshotsGrid.innerHTML = '<div style="color:var(--text-3);font-size:12px;">No screenshots captured for this run.</div>';
    }

    // ── Preserved artifacts ───────────────────────────────────────────────
    artifactsContainer.innerHTML = '';
    const artifacts = report.artifacts || [];
    if (artifactsBadge) artifactsBadge.textContent = `${artifacts.length} file${artifacts.length !== 1 ? 's' : ''}`;
    if (artifacts.length === 0) {
      artifactsContainer.innerHTML = '<div style="color:var(--text-3);font-size:12px;">No modified workspace files preserved.</div>';
    } else {
      for (const file of artifacts) {
        const item = document.createElement('div');
        Object.assign(item.style, { background: 'var(--bg-3)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        item.innerHTML = `
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--text);">${file}</div>
          <a href="/api/postqode-test/runs/${report.runId}/artifacts/${file}" target="_blank" class="testlab-btn testlab-btn-secondary" style="padding:2px 8px;font-size:11px;">Inspect</a>`;
        artifactsContainer.appendChild(item);
      }
    }

    // ── Intercepted evidence ──────────────────────────────────────────────
    evidenceDetails.innerHTML = '';
    if (!report.evidence?.length) {
      evidenceDetails.innerHTML = '<div style="color:var(--text-3);font-size:12px;">No network calls intercepted or recorded.</div>';
    } else {
      for (const ev of report.evidence) {
        const item = document.createElement('div');
        Object.assign(item.style, { background: 'var(--bg-3)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' });
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
            <strong style="color:var(--text);">${ev.method} ${ev.url}</strong>
            <span class="testlab-info-badge success">${ev.isMocked ? 'Mocked SSE' : 'Live'} (${ev.duration}ms)</span>
          </div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-2);margin-bottom:6px;">
            Scenario: <code>${ev.scenario}</code> | ${ev.timestamp}
          </div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text);background:var(--bg-2);padding:8px;border-radius:4px;max-height:120px;overflow-y:auto;white-space:pre-wrap;">${ev.responseBodyPreview || 'No preview'}</div>`;
        evidenceDetails.appendChild(item);
      }
    }
  }

  // Initial load
  loadRuns();

  return { loadRuns, loadRunReport, displayReport };
}
