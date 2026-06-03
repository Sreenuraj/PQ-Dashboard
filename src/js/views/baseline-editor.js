import { api } from '../api.js';
import { agentChainChips, agentColor } from '../utils.js';

export async function renderBaselineEditor(container, id) {
  if (!id) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><p>No baseline ID provided.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading baseline details...</p></div>`;

  let baseline;
  try {
    baseline = await api.baseline(id);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><p>Error loading baseline: ${e.message}</p></div>`;
    return;
  }

  // Phase 4: also fetch the source task so we can show the source agent
  // (informational only — the baseline itself is agent-agnostic at edit time).
  let sourceTask = null;
  if (baseline.source_task_id) {
    try { sourceTask = await api.task(baseline.source_task_id); } catch {}
  }

  // Local state for edits
  const state = {
    name: baseline.name || '',
    description: baseline.description || '',
    tags: [...(baseline.tags || [])],
    // Phase 3: expected_tools and output_keywords may be objects or legacy strings
    expected_tools: (baseline.expected_tools || []).map(t =>
      typeof t === 'string' ? { name: t, is_essential: true } : { ...t }
    ),
    excluded_tools: [...(baseline.excluded_tools || [])],
    excluded_files: [...(baseline.excluded_files || [])],
    tool_sequence: JSON.parse(JSON.stringify(baseline.tool_sequence || [])),
    behavior_contract: JSON.parse(JSON.stringify(baseline.behavior_contract || {
      has_code_block: false,
      output_keywords: [],
      excluded_keywords: [],
      output_min_length: 40,
      output_max_length: 1000,
    })),
  };

  if (!state.behavior_contract.output_keywords) state.behavior_contract.output_keywords = [];
  if (!state.behavior_contract.excluded_keywords) state.behavior_contract.excluded_keywords = [];
  // Phase 3: Normalize output_keywords to objects
  state.behavior_contract.output_keywords = state.behavior_contract.output_keywords.map(k =>
    typeof k === 'string' ? { word: k, is_essential: true } : { ...k }
  );

  function render() {
    container.innerHTML = `
      <div class="view-header">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="#/baselines" style="color:var(--text-3);text-decoration:none;font-size:13px">← Baselines</a>
          <h1 class="view-title" style="margin:0">Edit Baseline</h1>
        </div>
        <p class="view-subtitle">Customize expected behaviors, essential steps, tools, and contract parameters.</p>
      </div>

      <div class="grid-2">
        <!-- Left Column: Details, Tags, & Metadata -->
        <div class="panel">
          <div class="panel-title">General Information</div>
          <div class="panel-body">
            <div style="margin-bottom:12px">
              <label class="field-label" style="margin-top:0">Baseline Name</label>
              <input type="text" id="edit-name" class="filter-input" style="width:100%" value="${escAttr(state.name)}" />
            </div>

            <div style="margin-bottom:12px">
              <label class="field-label">Description</label>
              <textarea id="edit-desc" class="filter-input" style="width:100%;height:80px;resize:vertical">${escHtml(state.description)}</textarea>
            </div>

            <div>
              <label class="field-label">Tags</label>
              <div id="tags-list" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${state.tags.map((t, i) => `
                  <span class="badge grey" style="display:inline-flex;align-items:center;gap:4px">
                    ${escHtml(t)}
                    <span style="cursor:pointer;font-weight:bold" data-remove-tag="${i}">×</span>
                  </span>
                `).join('')}
              </div>
              <div class="dual-list-input-group">
                <input type="text" id="new-tag-input" class="filter-input" placeholder="New tag name" style="flex:1" />
                <button id="add-tag-btn" class="action-btn">Add Tag</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Behavior Contract Parameters -->
        <div class="panel">
          <div class="panel-title">Behavior Contract Bounds</div>
          <div class="panel-body">
            <div style="display:flex;gap:16px;margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                <input type="checkbox" id="contract-code-block" ${state.behavior_contract.has_code_block ? 'checked' : ''} />
                Requires Code Block (\`\`\`)
              </label>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label class="field-label" style="margin-top:0">Min Length (chars)</label>
                <input type="number" id="contract-min" class="filter-input" style="width:100%" value="${state.behavior_contract.output_min_length || state.behavior_contract.min_length || 40}" />
              </div>
              <div>
                <label class="field-label" style="margin-top:0">Max Length (chars)</label>
                <input type="number" id="contract-max" class="filter-input" style="width:100%" value="${state.behavior_contract.output_max_length || state.behavior_contract.max_length || 1000}" />
              </div>
            </div>
            
            <div class="mono" style="font-size:11px;color:var(--text-3)">
              Source Session: <span style="color:var(--text)">${escHtml(baseline.source_task_id)}</span>
            </div>
            ${sourceTask ? renderSourceAgentField(sourceTask) : ''}
          </div>
        </div>
      </div>

      <!-- Tools Curators (Dual Lists) -->
      <div class="panel" style="margin-top:20px">
        <div class="panel-title">Tool Curation (Expected vs Excluded)</div>
        <div class="panel-body">
          <p class="view-subtitle" style="margin-bottom:12px">Expected tools are verified to exist in the session trace. Excluded tools cause test failures if invoked. <strong>Essential</strong> tools must be used; <strong>optional</strong> tools are nice-to-have.</p>
          <div class="dual-list-container">
            <div>
              <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">EXPECTED TOOLS</div>
              <div class="dual-list" id="expected-tools-list">
                ${state.expected_tools.map((t, idx) => `
                  <div class="dual-list-item" data-tool-idx="${idx}" data-list="expected" style="display:flex;justify-content:space-between;align-items:center;width:100%">
                    <div style="display:flex;align-items:center;gap:6px;flex:1">
                      <input type="checkbox" data-tool-essential="${idx}" ${t.is_essential ? 'checked' : ''} />
                      <span>${escHtml(t.name)}</span>
                      ${t.is_essential ? '<span style="font-size:9px;color:var(--accent);font-weight:600">ESSENTIAL</span>' : ''}
                    </div>
                    <span class="delete-btn" data-delete-tool="${idx}" data-list="expected" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px;transition:opacity 0.2s" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">×</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="dual-list-controls">
              <button id="tool-move-right" class="dual-list-btn" style="font-size:18px">→</button>
              <button id="tool-move-left" class="dual-list-btn" style="font-size:18px">←</button>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">EXCLUDED TOOLS</div>
              <div class="dual-list" id="excluded-tools-list">
                ${state.excluded_tools.map((t, idx) => `
                  <div class="dual-list-item" data-tool-idx="${idx}" data-list="excluded" style="display:flex;justify-content:space-between;align-items:center;width:100%">
                    <span>${escHtml(t)}</span>
                    <span class="delete-btn" data-delete-tool="${idx}" data-list="excluded" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px;transition:opacity 0.2s" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">×</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="dual-list-input-group" style="max-width:400px">
            <input type="text" id="new-tool-input" class="filter-input" placeholder="Custom tool name" style="flex:1" />
            <button id="add-expected-tool" class="action-btn">Add to Expected</button>
            <button id="add-excluded-tool" class="action-btn">Add to Excluded</button>
          </div>
        </div>
      </div>

      <!-- Keywords Curators (Dual Lists) -->
      <div class="panel" style="margin-top:20px">
        <div class="panel-title">Contract Keywords (Required vs Excluded)</div>
        <div class="panel-body">
          <p class="view-subtitle" style="margin-bottom:12px">Required keywords must appear in final outputs. Excluded keywords trigger contract warnings if detected. <strong>Essential</strong> keywords must appear; <strong>optional</strong> keywords are nice-to-have.</p>
          <div class="dual-list-container">
            <div>
              <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">REQUIRED KEYWORDS</div>
              <div class="dual-list" id="required-keywords-list">
                ${state.behavior_contract.output_keywords.map((k, idx) => `
                  <div class="dual-list-item" data-kw-idx="${idx}" data-list="required" style="display:flex;justify-content:space-between;align-items:center;width:100%">
                    <div style="display:flex;align-items:center;gap:6px;flex:1">
                      <input type="checkbox" data-kw-essential="${idx}" ${k.is_essential ? 'checked' : ''} />
                      <span>${escHtml(k.word)}</span>
                      ${k.is_essential ? '<span style="font-size:9px;color:var(--accent);font-weight:600">ESSENTIAL</span>' : ''}
                    </div>
                    <span class="delete-btn" data-delete-kw="${idx}" data-list="required" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px;transition:opacity 0.2s" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">×</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="dual-list-controls">
              <button id="kw-move-right" class="dual-list-btn" style="font-size:18px">→</button>
              <button id="kw-move-left" class="dual-list-btn" style="font-size:18px">←</button>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">EXCLUDED KEYWORDS</div>
              <div class="dual-list" id="excluded-keywords-list">
                ${state.behavior_contract.excluded_keywords.map((k, idx) => `
                  <div class="dual-list-item" data-kw-idx="${idx}" data-list="excluded" style="display:flex;justify-content:space-between;align-items:center;width:100%">
                    <span>${escHtml(k)}</span>
                    <span class="delete-btn" data-delete-kw="${idx}" data-list="excluded" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px;transition:opacity 0.2s" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">×</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="dual-list-input-group" style="max-width:400px">
            <input type="text" id="new-kw-input" class="filter-input" placeholder="Custom keyword" style="flex:1" />
            <button id="add-required-kw" class="action-btn">Add to Required</button>
            <button id="add-excluded-kw" class="action-btn">Add to Excluded</button>
          </div>
        </div>
      </div>

      <!-- Phase 3: Excluded Files -->
      <div class="panel" style="margin-top:20px">
        <div class="panel-title">Excluded Files (Agent should NOT access)</div>
        <div class="panel-body">
          <p class="view-subtitle" style="margin-bottom:12px">Define file path patterns the agent should not access. Supports glob patterns: <code>**/.env</code>, <code>*.key</code>, <code>src/internal/**</code></p>
          <div id="excluded-files-list">
            ${state.excluded_files.map((f, idx) => `
              <div class="dual-list-item" data-file-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;width:100%;max-width:500px">
                <span class="mono" style="font-size:12px">${escHtml(f)}</span>
                <span class="delete-btn" data-delete-file="${idx}" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px;transition:opacity 0.2s" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">×</span>
              </div>
            `).join('')}
          </div>
          <div class="dual-list-input-group" style="max-width:500px;margin-top:8px">
            <input type="text" id="new-file-input" class="filter-input" placeholder="e.g. **/.env, secrets.yaml, src/internal/**" style="flex:1" />
            <button id="add-file-btn" class="action-btn">Add Pattern</button>
          </div>
        </div>
      </div>

      <!-- Essential Tool Sequence Steps -->
      <div class="panel" style="margin-top:20px">
        <div class="panel-title">Tool Sequence & Essential Steps</div>
        <div class="panel-body">
          <p class="view-subtitle" style="margin-bottom:12px">Define descriptive labels and mark steps as "Essential". Tested runs will be compared against these essential steps.</p>
          <div id="sequence-list">
            ${state.tool_sequence.map((step, idx) => `
              <div class="editor-sequence-item">
                <div class="editor-sequence-header">
                  <div>
                    <strong class="mono" style="color:var(--accent)">#${idx + 1} - ${escHtml(step.tool_name)}</strong>
                    ${step.file_path ? `<span class="badge grey" style="font-family:var(--font-mono)">${escHtml(step.file_path)}</span>` : ''}
                  </div>
                  <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                    <input type="checkbox" data-seq-essential="${idx}" ${step.is_essential ? 'checked' : ''} />
                    Essential Step
                  </label>
                </div>
                <div class="editor-sequence-body">
                  <div>
                    <label class="field-label" style="margin:0 0 4px">Step Description</label>
                    <input type="text" data-seq-desc="${idx}" class="filter-input" style="width:100%" value="${escAttr(step.description || '')}" placeholder="Describe the goal of this step..." />
                  </div>
                  <div>
                    <label class="field-label" style="margin:0 0 4px">Command Context / Target</label>
                    <input type="text" data-seq-command="${idx}" class="filter-input" style="width:100%" value="${escAttr(step.command || '')}" placeholder="Optional target detail (e.g. npm test)..." />
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div style="margin-top:24px;display:flex;gap:12px">
        <button id="save-baseline-btn" class="action-btn primary" style="min-width:140px">Save Changes</button>
        <a href="#/baselines" class="action-btn ghost">Cancel</a>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    // Basic text inputs
    document.getElementById('edit-name').addEventListener('input', e => { state.name = e.target.value; });
    document.getElementById('edit-desc').addEventListener('input', e => { state.description = e.target.value; });
    document.getElementById('contract-code-block').addEventListener('change', e => {
      state.behavior_contract.has_code_block = e.target.checked;
    });
    document.getElementById('contract-min').addEventListener('input', e => {
      state.behavior_contract.output_min_length = parseInt(e.target.value) || 0;
    });
    document.getElementById('contract-max').addEventListener('input', e => {
      state.behavior_contract.output_max_length = parseInt(e.target.value) || 0;
    });

    // Tag removal
    document.querySelectorAll('[data-remove-tag]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.removeTag);
        state.tags.splice(idx, 1);
        render();
      });
    });

    // Tool deletion
    document.querySelectorAll('[data-delete-tool]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.deleteTool);
        const list = el.dataset.list;
        if (list === 'expected') {
          state.expected_tools.splice(idx, 1);
        } else {
          state.excluded_tools.splice(idx, 1);
        }
        render();
      });
    });

    // Keyword deletion
    document.querySelectorAll('[data-delete-kw]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.deleteKw);
        const list = el.dataset.list;
        if (list === 'required') {
          state.behavior_contract.output_keywords.splice(idx, 1);
        } else {
          state.behavior_contract.excluded_keywords.splice(idx, 1);
        }
        render();
      });
    });

    // Tag addition
    document.getElementById('add-tag-btn').addEventListener('click', () => {
      const input = document.getElementById('new-tag-input');
      const tag = input.value.trim();
      if (tag && !state.tags.includes(tag)) {
        state.tags.push(tag);
        render();
      }
    });

    // Selection in dual lists
    let selectedTool = null;
    let selectedKw = null;

    document.querySelectorAll('.dual-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't select item when clicking a checkbox — let label toggle work naturally
        if (e.target.tagName === 'INPUT') return;
        const isTool = item.hasAttribute('data-tool-idx');
        if (isTool) {
          document.querySelectorAll('#expected-tools-list .dual-list-item, #excluded-tools-list .dual-list-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          selectedTool = {
            index: parseInt(item.dataset.toolIdx),
            list: item.dataset.list,
          };
        } else {
          document.querySelectorAll('#required-keywords-list .dual-list-item, #excluded-keywords-list .dual-list-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          selectedKw = {
            index: parseInt(item.dataset.kwIdx),
            list: item.dataset.list,
          };
        }
      });
    });

    // Tools move buttons — convert between object (expected) and string (excluded)
    document.getElementById('tool-move-right').addEventListener('click', () => {
      if (selectedTool && selectedTool.list === 'expected') {
        const toolObj = state.expected_tools.splice(selectedTool.index, 1)[0];
        state.excluded_tools.push(toolObj.name);  // excluded stores plain strings
        selectedTool = null;
        render();
      }
    });
    document.getElementById('tool-move-left').addEventListener('click', () => {
      if (selectedTool && selectedTool.list === 'excluded') {
        const toolName = state.excluded_tools.splice(selectedTool.index, 1)[0];
        // Default to non-essential when moving back from excluded — preserves user's intent
        state.expected_tools.push({ name: toolName, is_essential: false });
        selectedTool = null;
        render();
      }
    });

    // Add tools
    document.getElementById('add-expected-tool').addEventListener('click', () => {
      const input = document.getElementById('new-tool-input');
      const val = input.value.trim();
      if (val && !state.expected_tools.some(t => t.name === val)) {
        state.expected_tools.push({ name: val, is_essential: true });
        // Remove from excluded if it was there
        state.excluded_tools = state.excluded_tools.filter(x => x !== val);
        render();
      }
    });
    document.getElementById('add-excluded-tool').addEventListener('click', () => {
      const input = document.getElementById('new-tool-input');
      const val = input.value.trim();
      if (val && !state.excluded_tools.includes(val)) {
        state.excluded_tools.push(val);
        // Remove from expected if it was there
        state.expected_tools = state.expected_tools.filter(t => t.name !== val);
        render();
      }
    });

    // Keywords move buttons — convert between object (required) and string (excluded)
    document.getElementById('kw-move-right').addEventListener('click', () => {
      if (selectedKw && selectedKw.list === 'required') {
        const kwObj = state.behavior_contract.output_keywords.splice(selectedKw.index, 1)[0];
        state.behavior_contract.excluded_keywords.push(kwObj.word);  // excluded stores plain strings
        selectedKw = null;
        render();
      }
    });
    document.getElementById('kw-move-left').addEventListener('click', () => {
      if (selectedKw && selectedKw.list === 'excluded') {
        const kwWord = state.behavior_contract.excluded_keywords.splice(selectedKw.index, 1)[0];
        // Default to non-essential when moving back from excluded — preserves user's intent
        state.behavior_contract.output_keywords.push({ word: kwWord, is_essential: false });
        selectedKw = null;
        render();
      }
    });

    // Add keywords
    document.getElementById('add-required-kw').addEventListener('click', () => {
      const input = document.getElementById('new-kw-input');
      const val = input.value.trim().toLowerCase();
      if (val && !state.behavior_contract.output_keywords.some(k => k.word === val)) {
        state.behavior_contract.output_keywords.push({ word: val, is_essential: true });
        // Remove from excluded if there
        state.behavior_contract.excluded_keywords = state.behavior_contract.excluded_keywords.filter(x => x !== val);
        render();
      }
    });
    document.getElementById('add-excluded-kw').addEventListener('click', () => {
      const input = document.getElementById('new-kw-input');
      const val = input.value.trim().toLowerCase();
      if (val && !state.behavior_contract.excluded_keywords.includes(val)) {
        state.behavior_contract.excluded_keywords.push(val);
        // Remove from required if there
        state.behavior_contract.output_keywords = state.behavior_contract.output_keywords.filter(k => k.word !== val);
        render();
      }
    });

    // Phase 3: Tool essential checkboxes — re-render to update ESSENTIAL tag immediately
    document.querySelectorAll('[data-tool-essential]').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.toolEssential);
        state.expected_tools[idx].is_essential = el.checked;
        render();
      });
    });

    // Phase 3: Keyword essential checkboxes — re-render to update ESSENTIAL tag immediately
    document.querySelectorAll('[data-kw-essential]').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.kwEssential);
        state.behavior_contract.output_keywords[idx].is_essential = el.checked;
        render();
      });
    });

    // Phase 3: Excluded files deletion
    document.querySelectorAll('[data-delete-file]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.deleteFile);
        state.excluded_files.splice(idx, 1);
        render();
      });
    });

    // Phase 3: Excluded files addition
    document.getElementById('add-file-btn')?.addEventListener('click', () => {
      const input = document.getElementById('new-file-input');
      const val = input.value.trim();
      if (val && !state.excluded_files.includes(val)) {
        state.excluded_files.push(val);
        render();
      }
    });

    // Sequence Step handlers
    document.querySelectorAll('[data-seq-essential]').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.seqEssential);
        state.tool_sequence[idx].is_essential = el.checked;
      });
    });
    document.querySelectorAll('[data-seq-desc]').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.dataset.seqDesc);
        state.tool_sequence[idx].description = el.value;
      });
    });
    document.querySelectorAll('[data-seq-command]').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.dataset.seqCommand);
        state.tool_sequence[idx].command = el.value;
      });
    });

    // Save changes button
    const saveBtn = document.getElementById('save-baseline-btn');
    saveBtn.addEventListener('click', async () => {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      try {
        const payload = {
          name: state.name,
          description: state.description,
          tags: state.tags,
          expected_tools: state.expected_tools,
          excluded_tools: state.excluded_tools,
          excluded_files: state.excluded_files,
          tool_sequence: state.tool_sequence,
          behavior_contract: state.behavior_contract,
        };
        await api.updateBaseline(id, payload);
        window.location.hash = '#/baselines';
      } catch (err) {
        saveBtn.textContent = 'Save Changes';
        saveBtn.disabled = false;
        alert('Failed to save baseline: ' + err.message);
      }
    });
  }

  render();
}

/**
 * Phase 4: render an informational "Source Agent" field. Read-only by
 * design — the agent that produced the baseline is intrinsic to the
 * source task and shouldn't be re-authored here. Reviewers can still
 * see the chain at a glance to know which agent this baseline describes.
 */
function renderSourceAgentField(sourceTask) {
  const sequence = sourceTask.agent_sequence || [];
  if (sequence.length === 0) return '';
  const primary = sourceTask.primary_agent;
  const isMulti = sourceTask.is_multi_agent;
  return `
    <div style="margin-top:12px;padding:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.4px">Source Agent</span>
        ${isMulti ? `<span class="badge accent" style="font-size:9px">Multi-agent (${sourceTask.agent_count})</span>` : ''}
        ${primary ? `<span class="badge" style="background:${agentColor(primary)}22;color:${agentColor(primary)};border:1px solid ${agentColor(primary)}55;font-size:9px">primary: ${escHtml(primary)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
        ${agentChainChips(sequence, { max: 5, clickable: false })}
      </div>
      <div style="font-size:10px;color:var(--text-3);margin-top:6px;font-style:italic">
        The agent that produced the source session. This is read-only —
        baselines are agent-agnostic so a baseline built on <code>plan</code> can still
        validate runs driven by <code>agent</code>.
      </div>
    </div>
  `;
}

function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function escAttr(s) {
  return escHtml(s).replace(/`/g, '&#96;');
}
