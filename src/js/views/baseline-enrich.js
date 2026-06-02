import { api } from '../api.js';
import { fmtDuration, fmtCost } from '../utils.js';

export async function renderBaselineEnrich(container, id) {
  if (!id) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><p>No baseline ID provided.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading baseline and sessions...</p></div>`;

  let baseline, tasksData;
  try {
    [baseline, tasksData] = await Promise.all([
      api.baseline(id),
      api.tasks({ limit: 100 })
    ]);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><p>Error loading baseline or sessions: ${e.message}</p></div>`;
    return;
  }

  const tasks = tasksData.tasks || [];
  let selectedSessionId = '';
  let diffData = null;

  // Local state for checkboxes
  const mergeState = {
    toolsToAdd: new Set(),
    toolsToExclude: new Set(),
    keywordsToAdd: new Set(),
    keywordsToExclude: new Set(),
  };

  function render() {
    container.innerHTML = `
      <div class="view-header">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="#/baselines" style="color:var(--text-3);text-decoration:none;font-size:13px">← Baselines</a>
          <h1 class="view-title" style="margin:0">Enrich from Session</h1>
        </div>
        <p class="view-subtitle">Select a session to analyze behavioral diffs and merge them into baseline <strong style="color:var(--accent)">${escHtml(baseline.name || baseline.id)}</strong>.</p>
      </div>

      <div class="panel">
        <div class="panel-title">Step 1: Choose Session to Analyze</div>
        <div class="panel-body">
          <div style="display:flex;gap:12px;align-items:center">
            <select id="session-select" class="filter-input" style="flex:1;min-height:36px;font-family:var(--font-sans)">
              <option value="">-- Select a session from history --</option>
              ${tasks.map(t => `
                <option value="${escAttr(t.id)}" ${t.id === selectedSessionId ? 'selected' : ''}>
                  ${escHtml(t.models?.[0]?.model_id || 'Unknown')} - ${escHtml(t.id.slice(0, 12))}... (${t.status}) - "${escHtml(t.first_message || '').substring(0, 50)}..."
                </option>
              `).join('')}
            </select>
            <button id="analyze-btn" class="action-btn primary" ${!selectedSessionId ? 'disabled' : ''}>Analyze Session Diffs</button>
          </div>
        </div>
      </div>

      <div id="diff-results-container"></div>
    `;

    bindInitialEvents();

    if (diffData) {
      renderDiffResults();
    }
  }

  function bindInitialEvents() {
    const select = document.getElementById('session-select');
    const analyzeBtn = document.getElementById('analyze-btn');

    select.addEventListener('change', () => {
      selectedSessionId = select.value;
      analyzeBtn.disabled = !selectedSessionId;
    });

    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.textContent = 'Analyzing...';
      analyzeBtn.disabled = true;
      try {
        diffData = await api.enrichBaseline(id, { session_id: selectedSessionId });
        // Reset selections
        mergeState.toolsToAdd.clear();
        mergeState.toolsToExclude.clear();
        mergeState.keywordsToAdd.clear();
        mergeState.keywordsToExclude.clear();
        render();
      } catch (err) {
        alert('Analysis failed: ' + err.message);
        analyzeBtn.textContent = 'Analyze Session Diffs';
        analyzeBtn.disabled = false;
      }
    });
  }

  function renderDiffResults() {
    const resultContainer = document.getElementById('diff-results-container');
    if (!diffData) return;

    const { new_tools = [], new_keywords = [], failed_tools = [] } = diffData;

    resultContainer.innerHTML = `
      <!-- Session Details Panel -->
      <div class="panel" style="margin-top:20px">
        <div class="panel-title">Session Summary</div>
        <div class="panel-body">
          <div class="baseline-meta-grid">
            <div><span>Model ID</span><strong class="mono">${escHtml(diffData.session_model || 'Unknown')}</strong></div>
            <div><span>Duration</span><strong>${fmtDuration(diffData.session_duration || 0)}</strong></div>
            <div><span>New Tools</span><strong>${new_tools.length} detected</strong></div>
            <div><span>New Keywords</span><strong>${new_keywords.length} detected</strong></div>
          </div>
        </div>
      </div>

      <div class="enrich-grid" style="margin-top:20px">
        <!-- New Tools Panel -->
        <div class="diff-card">
          <div class="diff-card-header">
            <span>New Tool Calls (${new_tools.length})</span>
            <span style="font-size:11px;font-weight:normal;color:var(--text-3)">Check to add/exclude</span>
          </div>
          <div class="diff-card-body" style="padding:0">
            ${new_tools.length === 0 ? `
              <div class="panel-empty" style="padding:20px;text-align:center;color:var(--text-3)">No new tools detected compared to baseline.</div>
            ` : `
              <table class="data-table" style="width:100%">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Count</th>
                    <th style="text-align:center">Add Expected</th>
                    <th style="text-align:center">Add Excluded</th>
                  </tr>
                </thead>
                <tbody>
                  ${new_tools.map((t, idx) => {
                    const isAdded = mergeState.toolsToAdd.has(t.tool_name);
                    const isExcluded = mergeState.toolsToExclude.has(t.tool_name);
                    return `
                      <tr>
                        <td class="mono">${escHtml(t.tool_name)}</td>
                        <td>${t.count}x</td>
                        <td style="text-align:center">
                          <input type="checkbox" class="tool-add-cb" data-tool="${escAttr(t.tool_name)}" ${isAdded ? 'checked' : ''} />
                        </td>
                        <td style="text-align:center">
                          <input type="checkbox" class="tool-exclude-cb" data-tool="${escAttr(t.tool_name)}" ${isExcluded ? 'checked' : ''} />
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <!-- New Keywords Panel -->
        <div class="diff-card">
          <div class="diff-card-header">
            <span>New Output Keywords (${new_keywords.length})</span>
            <span style="font-size:11px;font-weight:normal;color:var(--text-3)">Check to add/exclude</span>
          </div>
          <div class="diff-card-body" style="padding:0">
            ${new_keywords.length === 0 ? `
              <div class="panel-empty" style="padding:20px;text-align:center;color:var(--text-3)">No new keywords detected.</div>
            ` : `
              <table class="data-table" style="width:100%">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Count</th>
                    <th style="text-align:center">Add Required</th>
                    <th style="text-align:center">Add Excluded</th>
                  </tr>
                </thead>
                <tbody>
                  ${new_keywords.map((k, idx) => {
                    const isAdded = mergeState.keywordsToAdd.has(k.keyword);
                    const isExcluded = mergeState.keywordsToExclude.has(k.keyword);
                    return `
                      <tr>
                        <td>"${escHtml(k.keyword)}"</td>
                        <td>${k.count}x</td>
                        <td style="text-align:center">
                          <input type="checkbox" class="kw-add-cb" data-kw="${escAttr(k.keyword)}" ${isAdded ? 'checked' : ''} />
                        </td>
                        <td style="text-align:center">
                          <input type="checkbox" class="kw-exclude-cb" data-kw="${escAttr(k.keyword)}" ${isExcluded ? 'checked' : ''} />
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      </div>

      <!-- Failed Tools Panel -->
      ${failed_tools.length === 0 ? '' : `
        <div class="panel" style="margin-top:20px">
          <div class="panel-title" style="color:var(--red)">Failed Tool Executions (${failed_tools.length})</div>
          <div class="panel-body" style="padding:0">
            <table class="data-table" style="width:100%">
              <thead>
                <tr>
                  <th>Tool Name</th>
                  <th>Failure Category</th>
                  <th>Error Message</th>
                  <th style="text-align:center;width:120px">Add Excluded</th>
                </tr>
              </thead>
              <tbody>
                ${failed_tools.map(ft => {
                  const isExcluded = mergeState.toolsToExclude.has(ft.tool_name);
                  return `
                    <tr>
                      <td class="mono" style="color:var(--red)">${escHtml(ft.tool_name)}</td>
                      <td><span class="badge red">${escHtml(ft.error_category)}</span></td>
                      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(ft.error_message)}">
                        ${escHtml(ft.error_message)} ${ft.count > 1 ? `<span style="font-weight:600">(${ft.count}x)</span>` : ''}
                      </td>
                      <td style="text-align:center">
                        <input type="checkbox" class="tool-exclude-cb" data-tool="${escAttr(ft.tool_name)}" ${isExcluded ? 'checked' : ''} />
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}

      <!-- Merge Action -->
      <div style="margin-top:20px;display:flex;gap:12px;align-items:center">
        <button id="merge-btn" class="action-btn primary" style="min-width:160px">Merge Selected Changes</button>
        <span style="font-size:12px;color:var(--text-3)">This will update the baseline behavior parameters and log the session as a contributor.</span>
      </div>
    `;

    bindDiffEvents();
  }

  function bindDiffEvents() {
    // Checkbox toggles
    document.querySelectorAll('.tool-add-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const tool = cb.dataset.tool;
        if (cb.checked) {
          mergeState.toolsToAdd.add(tool);
          // Turn off exclude checkbox for this tool
          mergeState.toolsToExclude.delete(tool);
        } else {
          mergeState.toolsToAdd.delete(tool);
        }
        renderDiffResults();
      });
    });

    document.querySelectorAll('.tool-exclude-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const tool = cb.dataset.tool;
        if (cb.checked) {
          mergeState.toolsToExclude.add(tool);
          // Turn off add checkbox for this tool
          mergeState.toolsToAdd.delete(tool);
        } else {
          mergeState.toolsToExclude.delete(tool);
        }
        renderDiffResults();
      });
    });

    document.querySelectorAll('.kw-add-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const kw = cb.dataset.kw;
        if (cb.checked) {
          mergeState.keywordsToAdd.add(kw);
          // Turn off exclude checkbox for this keyword
          mergeState.keywordsToExclude.delete(kw);
        } else {
          mergeState.keywordsToAdd.delete(kw);
        }
        renderDiffResults();
      });
    });

    document.querySelectorAll('.kw-exclude-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const kw = cb.dataset.kw;
        if (cb.checked) {
          mergeState.keywordsToExclude.add(kw);
          // Turn off add checkbox for this keyword
          mergeState.keywordsToAdd.delete(kw);
        } else {
          mergeState.keywordsToExclude.delete(kw);
        }
        renderDiffResults();
      });
    });

    // Merge Button
    const mergeBtn = document.getElementById('merge-btn');
    mergeBtn.addEventListener('click', async () => {
      mergeBtn.textContent = 'Merging...';
      mergeBtn.disabled = true;
      try {
        const payload = {
          session_id: selectedSessionId,
          tools_to_add: [...mergeState.toolsToAdd],
          tools_to_exclude: [...mergeState.toolsToExclude],
          keywords_to_add: [...mergeState.keywordsToAdd],
          keywords_to_exclude: [...mergeState.keywordsToExclude],
        };
        await api.mergeEnrichment(id, payload);
        window.location.hash = '#/baselines';
      } catch (err) {
        alert('Merge failed: ' + err.message);
        mergeBtn.textContent = 'Merge Selected Changes';
        mergeBtn.disabled = false;
      }
    });
  }

  render();
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAttr(s) {
  return escHtml(s).replace(/`/g, '&#96;');
}
