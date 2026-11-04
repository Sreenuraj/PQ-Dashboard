import { escHtml, fmtBytes } from './helpers.js';

export function splitPromptLines(text) {
  if (!text) return [''];
  return String(text).split('\n');
}

export function buildSideBySideDiffRows(beforeText, afterText) {
  const beforeLines = splitPromptLines(beforeText);
  const afterLines = splitPromptLines(afterText);

  if (beforeText === afterText) {
    return [{ type: 'note', text: 'No prompt text changed between these two calls.' }];
  }

  let prefixLen = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefixLen < maxPrefix && beforeLines[prefixLen] === afterLines[prefixLen]) prefixLen++;

  let suffixLen = 0;
  const maxSuffix = Math.min(beforeLines.length - prefixLen, afterLines.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]
  ) suffixLen++;

  const context = 8;
  const beforeChangeEnd = beforeLines.length - suffixLen;
  const afterChangeEnd = afterLines.length - suffixLen;
  const contextStart = Math.max(0, prefixLen - context);
  const suffixVisible = Math.min(context, suffixLen);

  const rows = [];

  if (contextStart > 0) rows.push({ type: 'skip', text: `... ${contextStart} unchanged lines hidden ...` });

  for (let i = contextStart; i < prefixLen; i++) {
    rows.push({ type: 'ctx', leftLine: i + 1, leftText: beforeLines[i], rightLine: i + 1, rightText: afterLines[i] });
  }

  const removedCount = beforeChangeEnd - prefixLen;
  const addedCount = afterChangeEnd - prefixLen;
  const maxCount = Math.max(removedCount, addedCount);

  for (let j = 0; j < maxCount; j++) {
    const leftIdx = j < removedCount ? prefixLen + j : null;
    const rightIdx = j < addedCount ? prefixLen + j : null;
    rows.push({
      type: 'change',
      leftLine: leftIdx != null ? leftIdx + 1 : '',
      leftText: leftIdx != null ? beforeLines[leftIdx] : null,
      rightLine: rightIdx != null ? rightIdx + 1 : '',
      rightText: rightIdx != null ? afterLines[rightIdx] : null,
    });
  }

  const suffixBeforeStart = beforeChangeEnd;
  const suffixAfterStart = afterChangeEnd;
  for (let i = 0; i < suffixVisible; i++) {
    rows.push({
      type: 'ctx',
      leftLine: suffixBeforeStart + i + 1,
      leftText: beforeLines[suffixBeforeStart + i],
      rightLine: suffixAfterStart + i + 1,
      rightText: afterLines[suffixAfterStart + i],
    });
  }

  if (suffixLen > suffixVisible) rows.push({ type: 'skip', text: `... ${suffixLen - suffixVisible} unchanged lines hidden ...` });

  return rows;
}

export function renderSideBySideDiffRow(row) {
  if (row.type === 'skip') {
    return `<div class="pa-diff-skip-row" style="grid-column:1/-1;padding:4px 10px;color:var(--text-3);font-size:10px;font-style:italic;background:var(--bg-3);border-top:1px dashed var(--border);border-bottom:1px dashed var(--border)">${escHtml(row.text)}</div>`;
  }

  if (row.type === 'note') {
    return `<div style="grid-column:1/-1;padding:12px;color:var(--text-3);font-style:italic;text-align:center">${escHtml(row.text)}</div>`;
  }

  const isCtx = row.type === 'ctx';
  const leftBg = isCtx ? 'transparent' : (row.leftText != null ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.02)');
  const rightBg = isCtx ? 'transparent' : (row.rightText != null ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.02)');
  const leftColor = isCtx ? 'var(--text-3)' : (row.leftText != null ? 'var(--red)' : 'var(--text-3)');
  const rightColor = isCtx ? 'var(--text-2)' : (row.rightText != null ? 'var(--green)' : 'var(--text-3)');

  return `
    <div style="display:grid;grid-template-columns:40px 1fr;background:${leftBg};color:${leftColor};border-right:1px solid var(--border);padding:1px 8px;white-space:pre-wrap;word-break:break-word">
      <span style="color:var(--text-3);text-align:right;padding-right:8px;user-select:none;font-size:9.5px">${row.leftLine || ''}</span>
      <span>${escHtml(row.leftText ?? '')}</span>
    </div>
    <div style="display:grid;grid-template-columns:40px 1fr;background:${rightBg};color:${rightColor};padding:1px 8px;white-space:pre-wrap;word-break:break-word">
      <span style="color:var(--text-3);text-align:right;padding-right:8px;user-select:none;font-size:9.5px">${row.rightLine || ''}</span>
      <span>${escHtml(row.rightText ?? '')}</span>
    </div>
  `;
}

export function renderSideBySidePromptDiffMarkup(comp, prevIdx, idx) {
  const beforeText = comp?.prompt1?.text || '';
  const afterText = comp?.prompt2?.text || '';
  const beforeSize = comp?.prompt1?.requestSize || comp?.call1?.requestSize || 0;
  const afterSize = comp?.prompt2?.requestSize || comp?.call2?.requestSize || 0;
  const delta = afterSize - beforeSize;
  const deltaText = delta >= 0 ? `+${fmtBytes(delta)}` : `-${fmtBytes(Math.abs(delta))}`;
  const deltaColor = delta >= 0 ? '#f59e0b' : 'var(--green)';

  const rows = buildSideBySideDiffRows(beforeText, afterText);

  return `
    <div class="pa-git-diff-card" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <div class="pa-git-diff-header" style="background:var(--bg-3);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:bold;font-size:12px;color:var(--text)">Prompt Diff: Call #${prevIdx + 1} → Call #${idx + 1}</div>
          <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">${comp?.call1?.messageCount || 0} messages → ${comp?.call2?.messageCount || 0} messages</div>
        </div>
        <div class="mono" style="font-size:11px;color:${deltaColor};font-weight:bold">
          ${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)} (${deltaText})
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;background:var(--bg-1);border-bottom:1px solid var(--border);font-size:10.5px;color:var(--text-3)">
        <div class="mono" style="padding:8px 14px;color:var(--red);border-right:1px solid var(--border)">🔴 call-${prevIdx + 1}-prompt (Before)</div>
        <div class="mono" style="padding:8px 14px;color:var(--green)">🟢 call-${idx + 1}-prompt (After)</div>
      </div>
      <div class="pa-git-diff-content mono" style="max-height:560px;overflow:auto;background:var(--bg-1);font-size:10.5px;line-height:1.45;display:grid;grid-template-columns:1fr 1fr">
        ${rows.map(renderSideBySideDiffRow).join('')}
      </div>
    </div>
  `;
}

export function renderSystemPromptSection(systemPrompt) {
  if (systemPrompt && systemPrompt.text) {
    return `
      <details style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:10px">
        <summary style="cursor:pointer;padding:8px 14px;font-size:11.5px;font-weight:bold;color:var(--text);display:flex;align-items:center;gap:8px">
          <span>🛰️</span> System Prompt (captured live via Network Inspector proxy)
          <span style="font-size:10px;color:var(--text-3);font-weight:normal">— not persisted to disk; only available while the proxy was capturing traffic</span>
        </summary>
        <div class="mono" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:10px 14px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--border)">${escHtml(systemPrompt.text)}</div>
      </details>
    `;
  }

  return `
    <div style="background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:10px;font-size:10.5px;color:var(--text-3);display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:13px">📄</span>
      <span><strong style="color:var(--text-2)">System prompt not shown:</strong> it's generated in-memory by the extension and never persisted to any task file. It's only recoverable live via the Network Inspector proxy.</span>
    </div>
  `;
}

export function renderCacheExplanationBanner(explanation) {
  if (!explanation || !explanation.text) return '';
  const iconMap = {
    first_call: '🆕', new_cache_entry: '🆕', model_changed: '🔀', mode_changed: '🔀', ttl_expired: '⏳', provider_changed: '🛰️',
    tools_changed: '🧰', system_changed: '📜', history_edited: '✂️', provider_eviction: '🗑️', task_rebuilt_after_cancel: '🔁',
    unexplained_full_miss: '❓', unexplained_partial_miss: '❓', hit: '✅', hit_extend: '✅', no_cache: 'ℹ️',
  };
  const levels = {
    confirmed: ['#22c55e', 'Confirmed', 'Both requests were captured by the Network Inspector and diffed.'],
    strong: ['#38bdf8', 'Recorded', 'Directly recorded in the task files or the extension log.'],
    inferred: ['#f59e0b', 'Inferred', 'Inferred from cache numbers only; keep the Network Inspector running to capture the evidence.'],
  };
  const lv = levels[explanation.level] || null;
  const isSpike = !!explanation.spike;
  const accent = isSpike ? '#f87171' : (explanation.level === 'inferred' ? '#f59e0b' : '#38bdf8');
  const bg = isSpike ? 'rgba(248,113,113,0.08)' : (explanation.level === 'inferred' ? 'rgba(245,158,11,0.08)' : 'rgba(56,189,248,0.08)');
  const border = isSpike ? 'rgba(248,113,113,0.35)' : (explanation.level === 'inferred' ? 'rgba(245,158,11,0.3)' : 'rgba(56,189,248,0.3)');
  const icon = iconMap[explanation.code] || 'ℹ️';
  const title = explanation.title || 'Why this cache behavior?';

  return `
    <div style="background:${bg};border:1px solid ${border};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:11.5px;color:var(--text);display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:14px">${icon}</span>
      <span>
        <strong style="color:${accent}">${escHtml(title)}</strong>
        ${lv ? `<span title="${escHtml(lv[2])}" style="color:${lv[0]};font-weight:bold;font-size:10px;margin-left:6px">● ${lv[1]}</span>` : ''}
        <br>${escHtml(explanation.text)}
      </span>
    </div>
  `;
}

export function renderChangeAnnotationsBanner(annotations, prevIdx, idx) {
  if (!annotations) return '';
  const { modelChanged, fromModelId, toModelId, possibleContextCondensation, sizeDropPct } = annotations;

  if (!modelChanged && !possibleContextCondensation) return '';

  const items = [];
  if (modelChanged) {
    items.push(`
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🔀</span>
        <span><strong style="color:#f59e0b">Model changed</strong> between Call #${prevIdx + 1} and Call #${idx + 1}:
          <span class="mono" style="color:var(--red)">${escHtml(fromModelId || 'unknown')}</span> →
          <span class="mono" style="color:var(--green)">${escHtml(toModelId || 'unknown')}</span>
        </span>
      </div>
    `);
  }
  if (possibleContextCondensation) {
    items.push(`
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🧹</span>
        <span><strong style="color:#f59e0b">Likely context condensation/reset</strong> detected — request size dropped by
          <strong>${sizeDropPct}%</strong>.
        </span>
      </div>
    `);
  }

  return `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:11.5px;color:var(--text);display:flex;flex-direction:column;gap:6px">
      ${items.join('')}
    </div>
  `;
}

export function buildAddedFileDiffRows(text) {
  const lines = splitPromptLines(text);
  return [
    { type: 'file', text: '--- /dev/null' },
    { type: 'file', text: '+++ prompt' },
    ...lines.map((line, i) => ({ type: 'add', oldLine: '', newLine: i + 1, text: line })),
  ];
}

export function renderInitialPromptDiffMarkup(promptData, idx) {
  const prompt = promptData?.prompt || {};
  const rows = buildAddedFileDiffRows(prompt.text || '');
  return renderUnifiedDiffPanel({
    title: `Prompt for Call #${idx + 1}`,
    subtitle: 'Initial request prompt',
    beforeLabel: '/dev/null',
    afterLabel: `call-${idx + 1}-prompt`,
    beforeSize: 0,
    afterSize: prompt.requestSize || promptData?.call?.requestSize || 0,
    rows,
  });
}

export function renderUnifiedDiffPanel({ title, subtitle, beforeLabel, afterLabel, beforeSize, afterSize, rows }) {
  const delta = afterSize - beforeSize;
  const deltaText = delta >= 0 ? `+${fmtBytes(delta)}` : `-${fmtBytes(Math.abs(delta))}`;
  const deltaColor = delta >= 0 ? '#f59e0b' : 'var(--green)';

  return `
    <div class="pa-git-diff-card" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <div class="pa-git-diff-header" style="background:var(--bg-3);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:bold;font-size:12px;color:var(--text)">${escHtml(title)}</div>
          <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">${escHtml(subtitle)}</div>
        </div>
        <div class="mono" style="font-size:11px;color:${deltaColor};font-weight:bold">
          ${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)} (${deltaText})
        </div>
      </div>
      <div style="background:var(--bg-1);border-bottom:1px solid var(--border);padding:8px 14px;font-size:10.5px;color:var(--text-3)">
        <span class="mono" style="color:var(--red)">--- ${escHtml(beforeLabel)}</span>
        <span class="mono" style="color:var(--green);margin-left:14px">+++ ${escHtml(afterLabel)}</span>
      </div>
      <div class="pa-git-diff-content mono" style="max-height:560px;overflow:auto;background:var(--bg-1);font-size:10.5px;line-height:1.45">
        ${rows.map(renderUnifiedDiffRow).join('')}
      </div>
    </div>
  `;
}

export function renderUnifiedDiffRow(row) {
  if (row.type === 'file') {
    const color = row.text.startsWith('---') ? 'var(--red)' : 'var(--green)';
    return `<div style="display:flex;color:${color};background:var(--bg-3);padding:2px 10px">${escHtml(row.text)}</div>`;
  }

  if (row.type === 'skip' || row.type === 'note') {
    return `<div style="display:flex;color:var(--text-3);background:var(--bg-3);padding:3px 10px;font-style:italic">${escHtml(row.text)}</div>`;
  }

  const mark = row.type === 'add' ? '+' : (row.type === 'del' ? '-' : ' ');
  const bg = row.type === 'add' ? 'rgba(34,197,94,0.12)' : (row.type === 'del' ? 'rgba(239,68,68,0.12)' : 'transparent');
  const color = row.type === 'add' ? 'var(--green)' : (row.type === 'del' ? 'var(--red)' : 'var(--text-2)');

  return `
    <div class="pa-diff-line" style="display:grid;grid-template-columns:52px 52px 18px 1fr;gap:8px;background:${bg};color:${color};padding:1px 10px;white-space:pre-wrap;word-break:break-word">
      <span style="color:var(--text-3);text-align:right;user-select:none">${row.oldLine || ''}</span>
      <span style="color:var(--text-3);text-align:right;user-select:none">${row.newLine || ''}</span>
      <span style="font-weight:bold;user-select:none">${mark}</span>
      <span>${escHtml(row.text)}</span>
    </div>
  `;
}
