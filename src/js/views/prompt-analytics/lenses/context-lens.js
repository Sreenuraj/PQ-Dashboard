import { escHtml, fmtBytes } from '../helpers.js';

/**
 * Renders the Context Window & Memory Hygiene Analytical Lens
 * Applying taste-skill anti-slop rules:
 * - Two levels, never three
 * - Strict Obsidian surface cards with hairline borders
 * - Clean tabular lists of truncated resources
 */
export function renderContextLens(data) {
  const calls = data.apiCalls || [];
  const cats = data.reductionCategories || {};
  const events = data.reductionEvents || [];

  const fileSaved = (cats.truncatedFiles || []).reduce((s, f) => s + f.bytesSaved, 0);
  const cmdSaved = (cats.truncatedCommands || []).reduce((s, c) => s + c.bytesSaved, 0);
  const envSaved = cats.environmentSnapshots?.bytesSaved || 0;

  const scratchSum = data.scratchSummary || { count: 0, totalSavedBytes: 0 };
  const scratchSaved = scratchSum.totalSavedBytes || 0;
  const failedCalls = calls.filter(c => c.hasError);

  return `
    <div class="pa-context-container">
      <div style="font-weight:600;font-size:12.5px;color:var(--text);margin-bottom:12px;display:flex;align-items:center;gap:6px">
        <span>🛡️</span> <span>Context Window Protection & Memory Hygiene Summary</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:10px;margin-bottom:14px">
        <!-- 1. Files Truncated Card -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:11.5px;color:var(--green)">📁 File Read Truncations</span>
            <span class="mono" style="font-size:11px;font-weight:700;color:var(--green)">-${fmtBytes(fileSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${(cats.truncatedFiles || []).length} unique files truncated in context:
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto">
            ${(cats.truncatedFiles || []).map(f => `
              <div class="pa-summary-row" title="Full File Path: ${escHtml(f.path)} &#10;Total Pruned: ${fmtBytes(f.bytesSaved)} (${f.count} times)" data-target="${escHtml(f.path)}" style="display:flex;justify-content:space-between;font-size:10px;background:var(--surface-sub);padding:4px 8px;border-radius:3px;cursor:pointer">
                <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;font-family:monospace" title="${escHtml(f.path)}">${escHtml(f.path)}</span>
                <span class="mono" style="color:var(--green);font-weight:600;margin-left:6px">-${fmtBytes(f.bytesSaved)} (${f.count}x)</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 2. Terminal Output Card -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:11.5px;color:#38bdf8">💻 Command Output Truncations</span>
            <span class="mono" style="font-size:11px;font-weight:700;color:#38bdf8">-${fmtBytes(cmdSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${(cats.truncatedCommands || []).length} command outputs capped:
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto">
            ${(cats.truncatedCommands || []).map(c => `
              <div class="pa-summary-row" title="Full Command: ${escHtml(c.command)} &#10;Total Pruned: ${fmtBytes(c.bytesSaved)}" data-target="${escHtml(c.command)}" style="display:flex;justify-content:space-between;font-size:10px;background:var(--surface-sub);padding:4px 8px;border-radius:3px;cursor:pointer">
                <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;font-family:monospace" title="${escHtml(c.command)}">${escHtml(c.command)}</span>
                <span class="mono" style="color:#38bdf8;font-weight:600;margin-left:6px">-${fmtBytes(c.bytesSaved)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 3. Environment Details Card -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:11.5px;color:#f59e0b">🌲 Environment Snapshots</span>
            <span class="mono" style="font-size:11px;font-weight:700;color:#f59e0b">-${fmtBytes(envSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${cats.environmentSnapshots?.count || 0} stale workspace snapshots purged.
          </div>
          <div style="font-size:10.5px;color:var(--text-2);background:var(--surface-sub);padding:8px;border-radius:3px;margin-top:8px">
            ✓ Preserves latest workspace state while removing obsolete historical duplicates.
          </div>
        </div>

        <!-- 4. Immediate Scratch Offloads Card -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:11.5px;color:#e879f9">⚡ Immediate Scratch Offloads</span>
            <span class="mono" style="font-size:11px;font-weight:700;color:#e879f9">-${fmtBytes(scratchSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${scratchSum.count || 0} tool outputs offloaded to scratch/ storage:
          </div>
          <div style="font-size:10.5px;color:var(--text-2);background:var(--surface-sub);padding:8px;border-radius:3px;margin-top:8px">
            ✓ Offloads raw bulk logs to disk at write-time, keeping only compact Head+Tail snippets in prompt.
          </div>
        </div>

        <!-- 5. Tool Errors & Retries Card -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:11.5px;color:${failedCalls.length > 0 ? '#f43f5e' : 'var(--text-3)'}">⚠️ Tool Failures & Retries</span>
            <span class="mono" style="font-size:11px;font-weight:700;color:${failedCalls.length > 0 ? '#f43f5e' : 'var(--text-3)'}">${failedCalls.length} calls</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${failedCalls.length > 0 ? `${failedCalls.length} tool operations failed or triggered retries:` : 'Clean execution — 0 tool errors encountered.'}
          </div>
          ${failedCalls.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto">
              ${failedCalls.slice(0, 10).map(c => `
                <div class="pa-summary-row" title="Call #${c.index + 1}: ${escHtml(c.errorDetails?.message || 'Error')}" data-call-index="${c.index}" style="display:flex;justify-content:space-between;font-size:10px;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);padding:4px 8px;border-radius:3px;cursor:pointer">
                  <span style="color:#f87171;font-weight:600">#${c.index + 1} (${escHtml(c.errorDetails?.tool || 'tool')})</span>
                  <span style="color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${escHtml(c.errorDetails?.message || '')}</span>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="font-size:10.5px;color:var(--green);background:var(--surface-sub);padding:8px;border-radius:3px;margin-top:8px">
              ✓ All tool executions succeeded without any failure errors.
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}
