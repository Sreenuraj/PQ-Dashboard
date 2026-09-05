/**
 * checklist.js — Renders the grouped, collapsible sheet checklist.
 *
 * Responsibilities:
 *  - Sheet accordion (collapsed by default, click-to-expand)
 *  - "Select Sheet" toggle button (checked ↔ unchecked visual state)
 *  - "Run Only This Sheet" inline button
 *  - Tab filtering, preset buttons, API-key unlock inputs
 *  - VSIX picker & build-source toggle
 *  - Mode (mocked / live) pill switcher
 */

export function initChecklist(state, startTestRunFn) {
  // Accordion collapse state persisted across re-renders
  const collapsed = {};

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const checklist        = document.getElementById('testlab-checklist');
  const categoryTabs     = document.getElementById('testlab-category-tabs');
  const selectAllBtn     = document.getElementById('testlab-select-all');
  const presetP0Btn      = document.getElementById('testlab-preset-p0');
  const presetSlashBtn   = document.getElementById('testlab-preset-slash');
  const presetFlowsBtn   = document.getElementById('testlab-preset-flows');
  const presetProvBtn    = document.getElementById('testlab-preset-prov');
  const presetChatBtn    = document.getElementById('testlab-preset-chat');
  const presetGuiBtn     = document.getElementById('testlab-preset-gui');
  const presetLifecycleBtn = document.getElementById('testlab-preset-lifecycle');

  const targetSelect     = document.getElementById('testlab-target-select');
  const targetBadge      = document.getElementById('testlab-target-badge');
  const hostStatus       = document.getElementById('testlab-host-status');
  const buildSelect      = document.getElementById('testlab-build-select');
  const buildBadge       = document.getElementById('testlab-build-badge');
  const localPathContainer = document.getElementById('testlab-local-path-container');
  const localPathInput   = document.getElementById('testlab-local-path-input');
  const browseFileBtn    = document.getElementById('testlab-browse-file-btn');
  const filePicker       = document.getElementById('testlab-file-picker');
  const detectedChips    = document.getElementById('testlab-detected-chips');
  const refreshVsixBtn   = document.getElementById('testlab-refresh-vsix-btn');

  const modeBadge        = document.getElementById('testlab-mode-badge');
  const modePills        = document.querySelectorAll('#testlab-mode-pills .testlab-pill');
  const liveModelContainer = document.getElementById('testlab-live-model-container');
  const liveProviderInput  = document.getElementById('testlab-live-provider-input');
  const liveModelInput     = document.getElementById('testlab-live-model-input');
  const detectedProviderBadge = document.getElementById('testlab-detected-provider-badge');
  const detectedModelBadge    = document.getElementById('testlab-detected-model-badge');
  const detectedConfigText    = document.getElementById('testlab-detected-config-text');
  const syncConfigBtn         = document.getElementById('testlab-sync-config-btn');

  const quickSheetSelect = document.getElementById('testlab-quick-sheet-select');
  const runSheetBtn      = document.getElementById('testlab-run-sheet-btn');

  // ── renderChecklist ───────────────────────────────────────────────────────
  function renderChecklist(categoryFilter = 'all') {
    state.currentCategory = categoryFilter;

    const filtered = state.scenariosData.filter((sc) =>
      categoryFilter === 'all' ? true : sc.sheetName === categoryFilter
    );

    // Group by sheetName preserving insertion order
    const sheetsMap = {};
    for (const sc of filtered) {
      if (!sheetsMap[sc.sheetName]) sheetsMap[sc.sheetName] = [];
      sheetsMap[sc.sheetName].push(sc);
    }

    let html = '';
    for (const [sheetName, items] of Object.entries(sheetsMap)) {
      // Default: collapsed unless explicitly opened
      if (!(sheetName in collapsed)) collapsed[sheetName] = true;
      const isCollapsed = collapsed[sheetName];

      // "Select Sheet" button reflects whether all enabled items are checked
      const selectableItems = items.filter(
        (sc) => !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live')
      );
      const allSelected =
        selectableItems.length > 0 && selectableItems.every((sc) => sc.defaultChecked);

      html += `
        <div class="sheet-group-wrapper" style="grid-column: 1 / -1;">
          <div class="sheet-group-heading"
               style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; cursor: pointer;"
               data-sheet-toggle="${sheetName}">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13px; transition: transform 0.2s; display: inline-block;
                           transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};"
                    class="sheet-chevron">▼</span>
              <span class="sheet-group-title">
                <strong>${sheetName}</strong>
              </span>
              <span class="testlab-info-badge" style="font-size: 10px;">${items.length} tests</span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation();">
              <button type="button"
                      class="testlab-btn ${allSelected ? 'testlab-btn-primary' : 'testlab-btn-secondary'} sheet-select-btn"
                      data-sheet="${sheetName}"
                      style="padding: 2px 8px; font-size: 10px;"
                      title="${allSelected ? 'Deselect all in this area' : 'Select all in this area'}">
                ${allSelected ? '☑ Selected' : '☐ Select All'}
              </button>
              <button type="button"
                      class="testlab-btn testlab-btn-primary sheet-run-btn"
                      data-sheet="${sheetName}"
                      style="padding: 2px 10px; font-size: 10px; font-weight: 600;"
                      title="Run only tests in this feature area">
                ▶ Run
              </button>
            </div>
          </div>
          <div class="sheet-group-body"
               style="${isCollapsed ? 'display: none;' : 'display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));'} gap: 12px; margin-top: 8px;">
      `;

      for (const sc of items) {
        const pClass =
          sc.priority === 'P0' ? 'priority-p0' : sc.priority === 'P1' ? 'priority-p1' : 'priority-p2';
        const isLiveOnlyDisabled = sc.liveOnly && state.currentMode === 'mocked';

        let badgeHtml = '';
        if (isLiveOnlyDisabled) {
          badgeHtml = '<span class="testlab-info-badge" style="background: rgba(139,148,158,0.2); color: #8b949e; font-size: 9px;">Disabled in Mocked Mode</span>';
        } else if (sc.liveOnly && state.currentMode === 'live') {
          badgeHtml = `<span class="testlab-info-badge success" style="font-size: 9px;">Live: ${liveModelSelect.value}</span>`;
        }

        let keyInputHtml = '';
        if (sc.requiresApiKey) {
          keyInputHtml = `
            <div style="margin-top: 6px;" onclick="event.stopPropagation();">
              <input type="password" id="key-input-${sc.id}" class="api-key-input"
                     placeholder="Enter ${sc.requiresApiKey.toUpperCase()} API key to enable..."
                     autocomplete="off" />
            </div>`;
        }

        const isChecked  = isLiveOnlyDisabled ? false : sc.defaultChecked;
        const isDisabled = isLiveOnlyDisabled || (sc.requiresApiKey && !isChecked);

        const meaningHtml = sc.meaning
          ? `<div style="font-size: 11px; color: var(--text-2); margin-top: 5px; line-height: 1.4; border-left: 2px solid var(--accent); padding-left: 8px;">
               <span style="font-weight: 600; color: var(--text);">Purpose:</span> ${sc.meaning}
             </div>`
          : '';

        const pipelineHtml = sc.pipeline
          ? `
            <details style="margin-top: 6px; font-size: 11px;" onclick="event.stopPropagation();">
              <summary style="cursor: pointer; color: var(--accent); font-weight: 600; font-size: 10px; user-select: none;">
                🔍 4-Phase Contract (Request ➔ Tools ➔ Response ➔ UI &amp; Side Effects)
              </summary>
              <div style="margin-top: 4px; padding: 6px 8px; background: var(--bg-2); border-radius: 4px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;">
                <div><strong style="color: var(--text-3);">1. Request:</strong> <span style="color: var(--text-2);">${sc.pipeline.request}</span></div>
                <div><strong style="color: var(--text-3);">2. Tools:</strong> <code style="font-family: var(--font-mono); color: var(--accent-cyan, #58a6ff); font-size: 10px;">${sc.pipeline.tools}</code></div>
                <div><strong style="color: var(--text-3);">3. Response:</strong> <span style="color: var(--text-2);">${sc.pipeline.response}</span></div>
                <div><strong style="color: var(--text-3);">4. UI &amp; Side Effects:</strong> <span style="color: var(--text);">${sc.pipeline.uiAndSideEffects}</span></div>
              </div>
            </details>`
          : '';

        const sideEffectBadgeHtml = sc.sideEffects
          ? `<div style="margin-top: 4px;"><span class="testlab-info-badge" style="font-size: 9px; background: rgba(88,166,255,0.12); color: #58a6ff; display: inline-block;">${sc.sideEffects}</span></div>`
          : '';

        html += `
          <label class="testlab-check-item" data-id="${sc.id}" style="${isLiveOnlyDisabled ? 'opacity: 0.65;' : ''}">
            <input type="checkbox" value="${sc.id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} />
            <div class="testlab-check-text" style="width: 100%;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                <span class="testlab-info-badge" style="font-size: 10px; padding: 1px 6px;">${sc.checklistId}</span>
                <span class="priority-badge ${pClass}">${sc.priority}</span>
                <span class="testlab-check-title" style="font-size: 12px; font-weight: 600;">${sc.title.replace(/^[^:]+:\s*/, '')}</span>
                ${badgeHtml}
              </div>
              <span class="testlab-check-desc">${sc.desc}</span>
              ${meaningHtml}
              ${sideEffectBadgeHtml}
              ${pipelineHtml}
              ${keyInputHtml}
            </div>
          </label>`;
      }

      html += `</div></div>`;
    }

    checklist.innerHTML = html;

    // ── Wire accordion toggles ──
    checklist.querySelectorAll('[data-sheet-toggle]').forEach((heading) => {
      heading.addEventListener('click', () => {
        const sheet = heading.dataset.sheetToggle;
        collapsed[sheet] = !collapsed[sheet];
        const body    = heading.nextElementSibling;
        const chevron = heading.querySelector('.sheet-chevron');
        if (body) {
          if (collapsed[sheet]) {
            body.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(-90deg)';
          } else {
            body.style.display = 'grid';
            body.style.gridTemplateColumns = 'repeat(auto-fit, minmax(340px, 1fr))';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
          }
        }
      });
    });

    // ── Wire "Select Sheet" toggle ──
    checklist.querySelectorAll('.sheet-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sheet      = btn.dataset.sheet;
        const sheetItems = state.scenariosData.filter(
          (sc) => sc.sheetName === sheet && !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live')
        );
        const allChecked = sheetItems.every((sc) => sc.defaultChecked);
        sheetItems.forEach((sc) => { sc.defaultChecked = !allChecked; });
        // Auto-expand so user sees the change
        collapsed[sheet] = false;
        renderChecklist(state.currentCategory);
      });
    });

    // ── Wire "Run Module" inline button ──
    checklist.querySelectorAll('.sheet-run-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sheet      = btn.dataset.sheet;
        const sheetItems = state.scenariosData
          .filter((sc) => sc.sheetName === sheet && !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live'))
          .map((sc) => sc.checklistId || sc.id);
        state.scenariosData.forEach((sc) => {
          sc.defaultChecked =
            sc.sheetName === sheet && !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live');
        });
        renderChecklist(state.currentCategory);
        if (startTestRunFn) startTestRunFn(sheetItems);
      });
    });

    // ── Wire API-key unlock inputs ──
    state.scenariosData.forEach((sc) => {
      if (!sc.requiresApiKey) return;
      const input = document.getElementById(`key-input-${sc.id}`);
      const cb    = checklist.querySelector(`input[value="${sc.id}"]`);
      if (input && cb) {
        input.addEventListener('input', () => {
          const hasKey = input.value.trim().length > 5;
          cb.disabled  = !hasKey;
          cb.checked   = hasKey;
          sc.defaultChecked = hasKey;
        });
      }
    });
  }

  // ── setScenarioChecked helper ────────────────────────────────────────────
  function setScenarioChecked(id, isChecked) {
    const sc = state.scenariosData.find((s) => s.id === id);
    if (sc) sc.defaultChecked = isChecked;
    const cb = checklist.querySelector(`input[value="${id}"]`);
    if (cb && !cb.disabled) cb.checked = isChecked;
  }

  // ── Category tabs ────────────────────────────────────────────────────────
  categoryTabs.querySelectorAll('.testlab-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      categoryTabs.querySelectorAll('.testlab-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.category;
      if (quickSheetSelect && runSheetBtn) {
        quickSheetSelect.value = cat === 'all' ? '' : cat;
        runSheetBtn.disabled = !quickSheetSelect.value;
      }
      renderChecklist(cat);
    });
  });

  // ── Preset buttons ────────────────────────────────────────────────────────
  presetP0Btn.addEventListener('click', () => {
    state.scenariosData.forEach((sc) => {
      sc.defaultChecked = sc.priority === 'P0' && !sc.liveOnly && !sc.requiresApiKey;
    });
    renderChecklist(state.currentCategory);
  });

  if (presetSlashBtn) {
    presetSlashBtn.addEventListener('click', () => {
      state.scenariosData.forEach((sc) => {
        sc.defaultChecked = sc.sheetName === 'Slash Commands';
      });
      renderChecklist('Slash Commands');
    });
  }

  if (presetFlowsBtn) {
    presetFlowsBtn.addEventListener('click', () => {
      state.scenariosData.forEach((sc) => {
        sc.defaultChecked = sc.sheetName === 'Workflows, Rules & Skills';
      });
      renderChecklist('Workflows, Rules & Skills');
    });
  }

  presetProvBtn.addEventListener('click', () => {
    state.scenariosData.forEach((sc) => {
      if (sc.sheetName === 'Providers & Models') {
        sc.defaultChecked = !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live');
      } else {
        sc.defaultChecked = false;
      }
    });
    renderChecklist(state.currentCategory);
  });

  if (presetChatBtn) {
    presetChatBtn.addEventListener('click', () => {
      state.scenariosData.forEach((sc) => {
        sc.defaultChecked = sc.sheetName === 'Chat & Agent Mode';
      });
      renderChecklist('Chat & Agent Mode');
    });
  }

  presetGuiBtn.addEventListener('click', () => {
    state.scenariosData.forEach((sc) => {
      sc.defaultChecked = sc.sheetName === 'GUI & Editor Integration';
    });
    renderChecklist(state.currentCategory);
  });

  presetLifecycleBtn.addEventListener('click', () => {
    state.scenariosData.forEach((sc) => {
      sc.defaultChecked = ['uninstall', 'install', 'startup', 'activation'].includes(sc.id);
    });
    renderChecklist(state.currentCategory);
  });

  selectAllBtn.addEventListener('click', () => {
    state.scenariosData.forEach((sc) => {
      if (!sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live')) {
        sc.defaultChecked = true;
      }
    });
    renderChecklist(state.currentCategory);
  });

  // ── Quick sheet dropdown ──────────────────────────────────────────────────
  if (quickSheetSelect && runSheetBtn) {
    quickSheetSelect.addEventListener('change', () => {
      const sheet = quickSheetSelect.value;
      runSheetBtn.disabled = !sheet;
      if (sheet) {
        state.scenariosData.forEach((sc) => {
          sc.defaultChecked =
            sc.sheetName === sheet && !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live');
        });
        renderChecklist(sheet);
        categoryTabs.querySelectorAll('.testlab-tab').forEach((t) => {
          if (t.dataset.category === sheet) {
            categoryTabs.querySelectorAll('.testlab-tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
          }
        });
      } else {
        renderChecklist('all');
        categoryTabs.querySelectorAll('.testlab-tab').forEach((t) => {
          t.classList.toggle('active', t.dataset.category === 'all');
        });
      }
    });

    runSheetBtn.addEventListener('click', () => {
      const sheet = quickSheetSelect.value;
      if (!sheet) return;
      const sheetItems = state.scenariosData
        .filter((sc) => sc.sheetName === sheet && !sc.requiresApiKey && (!sc.liveOnly || state.currentMode === 'live'))
        .map((sc) => sc.checklistId || sc.id);
      if (startTestRunFn) startTestRunFn(sheetItems);
    });
  }

  // ── Mode pills (Mocked / Live) ────────────────────────────────────────────
  modePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      modePills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentMode = pill.dataset.mode;
      modeBadge.textContent =
        state.currentMode === 'live' ? 'Live (Real API Calls)' : 'Mocked (Free)';
      liveModelContainer.style.display = state.currentMode === 'live' ? 'block' : 'none';
      renderChecklist(state.currentCategory);
    });
  });

  // ── Build source selector ─────────────────────────────────────────────────
  buildSelect.addEventListener('change', () => {
    const val = buildSelect.value;
    if (val === 'local') {
      localPathContainer.style.display = 'block';
      buildBadge.textContent  = 'Local VSIX';
      buildBadge.className    = 'testlab-info-badge';
      loadDetectedVsix();
      setScenarioChecked('uninstall', true);
      setScenarioChecked('install', true);
    } else if (val === 'marketplace') {
      localPathContainer.style.display = 'none';
      buildBadge.textContent  = 'Marketplace';
      buildBadge.className    = 'testlab-info-badge';
      setScenarioChecked('uninstall', true);
      setScenarioChecked('install', true);
    } else {
      localPathContainer.style.display = 'none';
      buildBadge.textContent  = 'Installed';
      buildBadge.className    = 'testlab-info-badge success';
    }
  });

  browseFileBtn.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    browseFileBtn.textContent = 'Uploading...';
    try {
      const res  = await fetch(`/api/postqode-test/upload-vsix?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', body: file,
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

  async function loadDetectedVsix() {
    try {
      detectedChips.innerHTML = '<span style="color: var(--text-3); font-size: 11px;">Scanning...</span>';
      const res  = await fetch('/api/postqode-test/local-vsix-files');
      const data = await res.json();
      if (!data.files || data.files.length === 0) {
        detectedChips.innerHTML =
          '<span style="color: var(--text-3); font-size: 11px;">No .vsix files found. Click Browse to pick one.</span>';
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
    } catch (_e) {
      detectedChips.innerHTML = '<span style="color: #f85149; font-size: 11px;">Failed to scan files.</span>';
    }
  }

  refreshVsixBtn.addEventListener('click', loadDetectedVsix);

  // ── Targets (IDE detection) ───────────────────────────────────────────────
  (async function loadTargets() {
    try {
      const res  = await fetch('/api/postqode-test/targets');
      const data = await res.json();
      if (data.targets && data.targets.length > 0) {
        targetSelect.innerHTML = data.targets
          .map((t) => {
            const availText = t.isAvailable ? 'Available' : 'Not found';
            const extText   = t.extensionInstalled ? `(PostQode v${t.extensionVersion})` : '(Extension missing)';
            return `<option value="${t.id}" ${t.isDefault ? 'selected' : ''} ${!t.isAvailable ? 'disabled' : ''}>
              ${t.name} — ${availText} ${extText}
            </option>`;
          })
          .join('');
        const defaultTarget = data.targets.find((t) => t.isDefault) || data.targets[0];
        targetBadge.textContent = defaultTarget.extensionInstalled
          ? `v${defaultTarget.extensionVersion}` : 'Not detected';
        targetBadge.className = defaultTarget.extensionInstalled
          ? 'testlab-info-badge success' : 'testlab-info-badge';
        hostStatus.textContent = 'Host Ready';
      }
    } catch (_e) {
      hostStatus.textContent = 'API Error';
    }
  })();

  // ── PostQode Active Config Auto-Detection ─────────────────────────────────
  async function detectAndAutoFillPostQodeConfig(host = 'vscode-insiders', isExplicitClick = false) {
    if (!detectedConfigText) return;
    try {
      detectedConfigText.textContent = '⚡ Checking PostQode active config...';
      const res  = await fetch(`/api/postqode-test/active-llm-config?host=${encodeURIComponent(host || 'vscode-insiders')}`);
      const data = await res.json();
      if (data.detected) {
        if (liveProviderInput && (isExplicitClick || !liveProviderInput.dataset.userEdited)) {
          liveProviderInput.value = data.provider || 'postqode';
          if (detectedProviderBadge) detectedProviderBadge.style.display = 'inline-flex';
        }
        if (liveModelInput && (isExplicitClick || !liveModelInput.dataset.userEdited)) {
          liveModelInput.value = data.model || 'moonshotai/kimi-k3';
          if (detectedModelBadge) detectedModelBadge.style.display = 'inline-flex';
        }
        detectedConfigText.innerHTML = `⚡ <strong>PostQode active:</strong> <span style="color:var(--accent);font-family:var(--font-mono)">${data.provider}</span> &bull; <code style="color:#a371f7">${data.model}</code>`;
      } else {
        detectedConfigText.textContent = '⚡ PostQode active config not detected (using defaults or custom input)';
        if (detectedProviderBadge) detectedProviderBadge.style.display = 'none';
        if (detectedModelBadge) detectedModelBadge.style.display = 'none';
      }
    } catch (_e) {
      detectedConfigText.textContent = '⚡ Could not read PostQode config (enter manually above)';
    }
  }

  if (liveProviderInput) {
    liveProviderInput.addEventListener('input', () => {
      liveProviderInput.dataset.userEdited = 'true';
      if (detectedProviderBadge) detectedProviderBadge.style.display = 'none';
    });
  }

  if (liveModelInput) {
    liveModelInput.addEventListener('input', () => {
      liveModelInput.dataset.userEdited = 'true';
      if (detectedModelBadge) detectedModelBadge.style.display = 'none';
    });
  }

  if (syncConfigBtn) {
    syncConfigBtn.addEventListener('click', () => {
      syncConfigBtn.disabled = true;
      syncConfigBtn.textContent = 'Syncing...';
      if (liveProviderInput) delete liveProviderInput.dataset.userEdited;
      if (liveModelInput) delete liveModelInput.dataset.userEdited;
      detectAndAutoFillPostQodeConfig(targetSelect.value, true).finally(() => {
        syncConfigBtn.disabled = false;
        syncConfigBtn.textContent = '🔄 Auto-fill';
      });
    });
  }

  targetSelect.addEventListener('change', () => {
    detectAndAutoFillPostQodeConfig(targetSelect.value, false);
  });

  // Initial detection
  detectAndAutoFillPostQodeConfig('vscode-insiders');

  return { renderChecklist, setScenarioChecked, liveProviderInput, liveModelInput, targetSelect, buildSelect, localPathInput };
}
