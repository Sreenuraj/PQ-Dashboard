import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDateTime } from '../utils.js';

export async function renderBaselines(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading baselines...</p></div>`;
  const data = await api.baselines();
  const baselines = data.baselines || [];

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Baselines</h1>
        <p class="view-subtitle">Reference sessions for behavioral testing and model comparison</p>
      </div>
    </div>

    <div class="filters-bar">
      <input id="baseline-search" class="filter-input" placeholder="Search baselines or tags..." />
    </div>

    <div id="baseline-list">
      ${baselines.length ? baselines.map(renderBaselineCard).join('') : emptyState()}
    </div>
  `;

  document.getElementById('baseline-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.baseline-card').forEach(card => {
      card.style.display = card.dataset.search.includes(q) ? 'block' : 'none';
    });
  });

  document.querySelectorAll('[data-copy-prompt]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.closest('.prompt-card')?.querySelector('pre')?.textContent || '';
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
  });

  document.querySelectorAll('[data-copy-all]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.baseline-card');
      const prompts = [...card.querySelectorAll('.prompt-card pre')].map((p, i) => `${i + 1}. ${p.textContent}`);
      await navigator.clipboard.writeText(prompts.join('\n\n'));
      btn.textContent = 'Copied All';
      setTimeout(() => { btn.textContent = 'Copy All Prompts'; }, 1200);
    });
  });

  document.querySelectorAll('[data-delete-baseline]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this baseline? The source task will remain.')) return;
      await api.deleteBaseline(btn.dataset.deleteBaseline);
      await renderBaselines(container);
    });
  });
}

function renderBaselineCard(b) {
  const metrics = b.reference_metrics || {};
  const search = `${b.name} ${(b.tags || []).join(' ')} ${b.model_id} ${b.activity_category}`.toLowerCase();
  return `
    <div class="panel baseline-card" data-search="${escAttr(search)}">
      <div class="panel-title">
        <span>${escHtml(b.name || b.id)}</span>
        <span class="badge accent">${escHtml(b.activity_category || 'general')}</span>
      </div>
      <div class="panel-body">
        <div class="baseline-meta-grid">
          <div><span>Model</span><strong class="mono">${escHtml(b.model_id || 'Unknown')}</strong></div>
          <div><span>Cost</span><strong>${fmtCost(metrics.cost || 0)}</strong></div>
          <div><span>Duration</span><strong>${fmtDuration(metrics.duration || 0)}</strong></div>
          <div><span>Tools</span><strong>${metrics.tool_calls || 0}</strong></div>
          <div><span>Errors</span><strong>${metrics.error_count || 0}</strong></div>
          <div><span>Created</span><strong>${fmtDateTime(b.created_at)}</strong></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0">
          ${(b.tags || []).map(t => `<span class="badge grey">${escHtml(t)}</span>`).join('') || '<span class="badge grey">No tags</span>'}
        </div>
        <details style="margin-bottom:12px">
          <summary class="details-summary">Benchmark summary</summary>
          <div class="benchmark-summary">
            <div><strong>Expected tools:</strong> ${(b.expected_tools || []).map(escHtml).join(', ') || '-'}</div>
            <div><strong>Contract keywords:</strong> ${(b.behavior_contract?.output_keywords || []).map(escHtml).join(', ') || '-'}</div>
          </div>
        </details>
        <div class="prompt-chain">
          ${(b.prompts || []).map(renderPrompt).join('') || '<div class="panel-empty">No prompt chain extracted.</div>'}
        </div>
        <div class="baseline-actions">
          <button class="action-btn secondary" data-copy-all>Copy All Prompts</button>
          <a class="action-btn secondary" href="#/timeline?task=${encodeURIComponent(b.task_id)}">View Timeline</a>
          <a class="action-btn primary" href="#/test?baseline=${encodeURIComponent(b.id)}">Test Against This</a>
          <a class="action-btn secondary" href="#/deepcompare?baseline=${encodeURIComponent(b.id)}">Compare Models</a>
          <button class="action-btn ghost" data-delete-baseline="${escAttr(b.id)}">Delete Baseline</button>
        </div>
      </div>
    </div>
  `;
}

function renderPrompt(p) {
  return `
    <div class="prompt-card">
      <div class="prompt-card-head">
        <span>Prompt ${p.index + 1}</span>
        <button class="page-btn" data-copy-prompt>Copy</button>
      </div>
      <pre>${escHtml(p.text || '')}</pre>
      <div class="prompt-tools">Agent used: ${summarizeTools(p.tools_after || [])}</div>
    </div>
  `;
}

function summarizeTools(tools) {
  if (!tools.length) return 'no tools';
  const counts = tools.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  return Object.entries(counts).map(([tool, count]) => `${escHtml(tool)} x ${count}`).join(', ');
}

function emptyState() {
  return `<div class="empty-state"><div class="icon">⚑</div><p>No baselines yet. Select a completed session and choose Set as Baseline.</p></div>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAttr(s) {
  return escHtml(s).replace(/`/g, '&#96;');
}
