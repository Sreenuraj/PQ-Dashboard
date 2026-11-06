import { escHtml, fmtBytes, fmtTokens, fmtCost, fmtTime, fmtDuration, fmtRate } from '../helpers.js';

/**
 * Renders the Subagents & Concurrency Analytical Lens
 * Applying taste-skill anti-slop rules:
 * - Two levels, never three (no nested boxes inside nested boxes)
 * - Strict Obsidian surface cards with hairline borders
 * - Grounded metrics, tabular numbers, zero visual noise
 */
export function renderSubagentsLens(data) {
  const s = data.subagentSummary;
  const hasSub = !!(s && s.hasSubagents && s.roiAnalysis);

  if (!hasSub) {
    return `
      <div class="pa-lens-surface" style="padding:32px 24px;text-align:center;background:var(--surface-card);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:28px;margin-bottom:8px">🤖</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">Single-Agent Thread (No Subagents Delegated)</div>
        <div style="font-size:12px;color:var(--text-3);max-width:520px;margin:0 auto;line-height:1.5">
          This task ran exclusively in the primary agent thread. Subagent parallel partitioning, model arbitrage, and concurrency speedups are tracked when subagents are launched via <code>use_subagents</code>.
        </div>
      </div>
    `;
  }

  const roi = s.roiAnalysis;
  const actualCost = roi.actualCost || s.totalCost || 0;
  const grounded = roi.groundedSingleAgent || roi.realisticFocused || { cost: actualCost, turns: s.totalTurns || 1, outputTokens: s.totalOutputTokens || 0, explorationPremium: 0, explorationPremiumPct: 0 };
  const exh = roi.exhaustiveMonolithic || { cost: actualCost, turns: s.totalTurns || 1, sameModelCost: actualCost, arbitrageSavings: 0 };
  const modes = roi.modes || {};
  const wall = roi.wallClock || { actualSec: 0, sequentialSec: 0, savedSec: 0, speedupFactor: 1 };
  const friction = roi.scratchFriction || { redundantCost: roi.redundantWorkCost || 0, redundantTurns: 0, scratchBytes: 0 };
  const scope = roi.scopeAnalysis || { runs: [], summary: {} };

  const mainModelShort = (modes.arbitrage?.mainModel || roi.modelArbitrage?.mainModel || 'opus').split('/').pop().replace('claude-', '').replace('latest', '');
  const subModelShort = (modes.arbitrage?.subagentModel || roi.modelArbitrage?.subagentModel || 'sonnet').split('/').pop().replace('claude-', '').replace('latest', '');
  const isArbitrage = modes.arbitrage?.isActive !== false;
  const isBackground = modes.concurrency?.isBackground || false;
  const isFork = modes.context?.isFork || false;

  return `
    <div class="pa-subagents-container">
      <!-- Lens Header Status Bar -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:13px;color:var(--text);display:flex;align-items:center;gap:6px">
            <span>🤖</span> <span>Subagents Economics & Empirical Scope Analysis</span>
          </span>
          <span class="mono" style="background:var(--surface-sub);border:1px solid var(--border);color:var(--text-2);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500">
            ${s.totalRuns} Run${s.totalRuns === 1 ? '' : 's'} · ${s.totalWorkers} Worker${s.totalWorkers === 1 ? '' : 's'} · ${s.totalTurns} Turn${s.totalTurns === 1 ? '' : 's'}
          </span>
          <!-- Setting 1: Arbitrage -->
          <span class="mono" style="background:${isArbitrage ? 'rgba(2,132,199,0.12)' : 'var(--surface-sub)'};border:1px solid ${isArbitrage ? 'rgba(2,132,199,0.3)' : 'var(--border)'};color:${isArbitrage ? '#38bdf8' : 'var(--text-3)'};padding:2px 8px;border-radius:10px;font-size:10.5px">
            ${isArbitrage ? `Arbitrage: ${escHtml(subModelShort)} (Sub) vs ${escHtml(mainModelShort)} (Main)` : `Model: ${escHtml(mainModelShort)}`}
          </span>
          <!-- Setting 2: Background -->
          <span class="mono" style="background:${isBackground ? 'rgba(16,185,129,0.12)' : 'var(--surface-sub)'};border:1px solid ${isBackground ? 'rgba(16,185,129,0.3)' : 'var(--border)'};color:${isBackground ? '#34d399' : 'var(--text-3)'};padding:2px 8px;border-radius:10px;font-size:10.5px">
            ${isBackground ? '⚡ Async Background' : '⏱ Sync Foreground'}
          </span>
          <!-- Setting 3: Fork -->
          <span class="mono" style="background:${isFork ? 'rgba(245,158,11,0.12)' : 'var(--surface-sub)'};border:1px solid ${isFork ? 'rgba(245,158,11,0.3)' : 'var(--border)'};color:${isFork ? '#fbbf24' : 'var(--text-3)'};padding:2px 8px;border-radius:10px;font-size:10.5px">
            ${isFork ? '🔀 Forked Context' : '🛡️ Fresh Isolated'}
          </span>
        </div>
        <div style="font-size:11px;color:var(--text-3)">
          <span>⏱ <strong>${escHtml(roi.ttlMode || 'Prompt Cache Active')}</strong></span>
        </div>
      </div>

      <!-- 4-Column Balanced Trade-Off Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px;margin-bottom:14px">
        <!-- 1. Actual Subagents Run -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500">With Subagents (Actual Spend)</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:#a5b4fc">${fmtCost(actualCost)}</div>
          <div style="font-size:10.5px;color:var(--text-2);margin-top:6px;display:flex;flex-direction:column;gap:3px">
            <span>• <strong>${s.totalTurns}</strong> turn${s.totalTurns === 1 ? '' : 's'} across ${s.totalWorkers} parallel worker${s.totalWorkers === 1 ? '' : 's'}</span>
            <span>• <strong>${fmtTokens(roi.totalOutputTokens || s.totalOutputTokens)}</strong> output tokens (${s.totalWorkers} reports)</span>
            <span>• <strong>${fmtTokens(s.totalCacheReads)}</strong> cache reads (${(s.cacheHitPct || 0).toFixed(1)}% hit)</span>
          </div>
        </div>

        <!-- 2. Data-Grounded Single Agent Baseline -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500">Single Agent Baseline (${grounded.novelFilesCount != null ? grounded.novelFilesCount : 0} Novel Files)</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:#38bdf8">${fmtCost(grounded.cost)}</div>
          <div style="font-size:10.5px;color:var(--text-2);margin-top:6px;display:flex;flex-direction:column;gap:3px">
            <span>• <strong>${grounded.novelFilesCount != null ? grounded.novelFilesCount : 0}</strong> unread file${grounded.novelFilesCount === 1 ? '' : 's'} required opening</span>
            <span>• Min <strong>${grounded.turns || 1}</strong> sequential turn${(grounded.turns || 1) === 1 ? '' : 's'} (${fmtTokens(grounded.outputTokens || 0)} notes)</span>
            <span>• Subagents carried <strong style="color:${(grounded.explorationPremium || 0) >= 0 ? '#fb7185' : '#34d399'}">${(grounded.explorationPremium || 0) >= 0 ? '+' : ''}${fmtCost(grounded.explorationPremium || grounded.explorationOverhead || 0)}</strong> report delta</span>
          </div>
        </div>

        <!-- 3. Concurrency Wall-Clock Savings -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500">Measured Concurrency Speedup</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:#34d399">-${(wall.savedSec / 60).toFixed(1)} min saved</div>
          <div style="font-size:10.5px;color:var(--text-2);margin-top:6px;display:flex;flex-direction:column;gap:3px">
            <span>• <strong>${(wall.actualSec / 60).toFixed(1)} min</strong> concurrent vs <strong>${(wall.sequentialSec / 60).toFixed(1)} min</strong> sequential</span>
            <span>• <strong>${(wall.speedupFactor || 1).toFixed(2)}x</strong> parallel speedup factor</span>
            <span>• Grounded in exact worker timestamps</span>
          </div>
        </div>

        <!-- 4. Scratch Amnesia & Redundant Work Overhead -->
        <div style="background:var(--surface-card);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:3px;font-weight:500">Scratch Friction & Retries</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:${friction.redundantCost > 0 ? '#fbbf24' : 'var(--text-3)'}">
            ${friction.redundantCost > 0 ? `+${fmtCost(friction.redundantCost)}` : '$0.00'}
          </div>
          <div style="font-size:10.5px;color:var(--text-2);margin-top:6px;display:flex;flex-direction:column;gap:3px">
            <span>• <strong>${friction.redundantTurns || 0}</strong> extra main agent turn${friction.redundantTurns === 1 ? '' : 's'} triggered</span>
            <span>• <strong>${fmtBytes(friction.scratchBytes || 0)}</strong> findings offloaded to scratch</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(friction.description || '')}">• ${escHtml(friction.description || 'No redundant scratch re-reads detected.')}</span>
          </div>
        </div>
      </div>

      <!-- Scope Independence & Context Overlap Matrix -->
      ${(scope.runs && scope.runs.length > 0) ? `
        <div style="margin-bottom:14px;background:var(--surface-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:600;font-size:12px;color:var(--text)">🎯 Subagent Task Independence & Overlap Matrix</span>
              <span class="mono" style="background:var(--surface-sub);border:1px solid var(--border);color:var(--text-2);padding:1px 6px;border-radius:8px;font-size:10px;font-weight:500">
                ${scope.summary.totalDistinctNovelFiles || 0} Total Novel Files Unseen by Main Agent
              </span>
            </div>
            <div style="font-size:10.5px;color:var(--text-3)">
              Programmatic verification of prior main context vs worker scopes
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px">
            ${scope.runs.map(r => `
              <div style="background:var(--surface-sub);border:1px solid var(--border);border-radius:var(--radius-xs);padding:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <strong style="font-size:11.5px;color:var(--text)">Run #${r.runIndex} (Call #${r.callIndex}): ${r.workerCount} Worker${r.workerCount === 1 ? '' : 's'}</strong>
                    <span class="mono" style="background:${r.overallNoveltyPct >= 75 ? 'rgba(16,185,129,0.12)' : 'rgba(2,132,199,0.12)'};color:${r.overallNoveltyPct >= 75 ? '#34d399' : '#38bdf8'};padding:1px 6px;border-radius:6px;font-size:10px;font-weight:500">
                      ${escHtml(r.taskType)} (${r.overallNoveltyPct}% Novel Files)
                    </span>
                    <span class="mono" style="background:rgba(139,92,246,0.12);color:#c084fc;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:500">
                      ${r.uniquenessPct}% Worker-to-Worker Uniqueness
                    </span>
                  </div>
                  <div style="font-size:10.5px;color:var(--text-3)">
                    <strong>${r.uniqueNovelFilesCount}</strong> novel files · <strong>${r.uniqueTargetFilesCount}</strong> total scope files
                  </div>
                </div>
                <div style="font-size:10.5px;color:var(--text-2);margin-bottom:8px">
                  ${escHtml(r.taskTypeDescription)}
                </div>

                <!-- Worker Cards Grid -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(210px, 1fr));gap:8px">
                  ${r.workers.map(w => `
                    <div style="background:var(--surface-card);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:10px">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                        <strong style="color:var(--text);font-size:10.5px">${escHtml(w.label)}</strong>
                        <span class="mono" style="font-weight:bold;color:${w.noveltyPct >= 75 ? '#34d399' : (w.noveltyPct >= 35 ? '#38bdf8' : '#fbbf24')}">
                          ${w.noveltyPct}% novel
                        </span>
                      </div>
                      <div style="color:var(--text-3);margin-bottom:4px">
                        <span>Prior Main Context: </span>
                        <strong style="color:${w.knownToMainCount > 0 ? '#fbbf24' : '#34d399'}">
                          ${w.knownToMainCount > 0 ? `${w.knownToMainCount} file(s) seen` : '0% seen (100% Brand-New)'}
                        </strong>
                      </div>
                      <div style="color:var(--text-2);line-height:1.3">
                        <div style="font-weight:600;margin-bottom:2px">Assigned Scope Targets (${w.targetCount}):</div>
                        ${w.targetCount > 0 ? `
                          <ul style="margin:0 0 0 12px;padding:0;list-style:disc">
                            ${w.targets.slice(0, 3).map(t => `<li title="${escHtml(t)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.split('/').pop())}</li>`).join('')}
                            ${w.targets.length > 3 ? `<li style="color:var(--text-3)">+${w.targets.length - 3} more files...</li>` : ''}
                          </ul>
                        ` : `<span style="color:var(--text-3);font-style:italic">Dynamic codebase inspection / directive</span>`}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Engineering Reality Banner -->
      <div style="font-size:11px;color:var(--text-2);background:var(--surface-card);padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);line-height:1.6;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:14px;line-height:1">💡</span>
          <div>
            <strong style="color:var(--text)">The Scope-Grounded Reality:</strong>
            ${escHtml(grounded.basisExplanation || `Subagents were assigned ${scope.summary?.totalDistinctNovelFiles || 0} novel files unseen by the main agent. Reading them sequentially would require at least ${grounded.turns || 1} tool turns, costing ${fmtCost(grounded.cost)} on ${mainModelShort}.`)}
            Subagents completed in <strong style="color:#a5b4fc">${fmtCost(actualCost)}</strong> across ${s.totalWorkers} parallel worker${s.totalWorkers === 1 ? '' : 's'} (${s.totalTurns} turns, ${fmtTokens(s.totalOutputTokens || 0)} output tokens).
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:14px;line-height:1">⚡</span>
          <div>
            <strong style="color:var(--text)">Why Subagents Were Used:</strong>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:6px;margin-top:4px">
              <span style="background:var(--surface-sub);border:1px solid var(--border);padding:4px 8px;border-radius:4px">
                🚀 <strong>Concurrency Speedup:</strong> Completed in <strong>${(wall.actualSec / 60).toFixed(1)} min</strong> concurrent vs <strong>${(wall.sequentialSec / 60).toFixed(1)} min</strong> sequential (<strong>${(wall.savedSec / 60).toFixed(1)} min saved</strong>).
              </span>
              <span style="background:var(--surface-sub);border:1px solid var(--border);padding:4px 8px;border-radius:4px">
                🛡️ <strong>Context Window Protection:</strong> Kept <strong>~${fmtTokens(roi.contextTokensPrevented || (s.totalTokensIn + s.totalTokensOut) || 0)}</strong> of raw file contents and worker reasoning out of the main thread.
              </span>
              <span style="background:var(--surface-sub);border:1px solid var(--border);padding:4px 8px;border-radius:4px">
                🎯 <strong>Partition Uniqueness:</strong> <strong>${scope.runs?.[0]?.uniquenessPct != null ? `${scope.runs[0].uniquenessPct}%` : '100%'}</strong> inter-worker partitioning with minimal duplicate reads across workers.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
