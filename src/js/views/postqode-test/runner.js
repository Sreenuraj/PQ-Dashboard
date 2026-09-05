/**
 * runner.js — Test execution engine.
 *
 * Manages:
 *  - SSE stream (connectStream / EventSource)
 *  - startTestRun (POST /api/postqode-test/run)
 *  - pause / resume / stop
 *  - updateExecutionState (idle | running | paused | stopped | completed)
 *  - Live step card updates (updateStepCard)
 */

export function initRunner(state, renderChecklist) {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const runBtn          = document.getElementById('testlab-run-btn');
  const pauseBtn        = document.getElementById('testlab-pause-btn');
  const stopBtn         = document.getElementById('testlab-stop-btn');
  const execPauseBtn    = document.getElementById('testlab-exec-pause-btn');
  const execStopBtn     = document.getElementById('testlab-exec-stop-btn');

  const targetSelect    = document.getElementById('testlab-target-select');
  const buildSelect     = document.getElementById('testlab-build-select');
  const localPathInput  = document.getElementById('testlab-local-path-input');
  const liveModelSelect = document.getElementById('testlab-live-model-select');

  const executionSection = document.getElementById('testlab-execution-section');
  const executionStatus  = document.getElementById('testlab-execution-status');
  const executionTitle   = document.getElementById('testlab-execution-title');
  const stepsContainer   = document.getElementById('testlab-steps-container');
  const terminalLogs     = document.getElementById('testlab-terminal-logs');
  const logCount         = document.getElementById('testlab-log-count');

  const checklist        = document.getElementById('testlab-checklist');

  // displayReport is injected after report.js initialises — filled via setter
  let _displayReport = null;
  let _loadRuns      = null;

  function setDisplayReport(fn) { _displayReport = fn; }
  function setLoadRuns(fn)      { _loadRuns      = fn; }

  // ── Execution state machine ───────────────────────────────────────────────
  function updateExecutionState(newState) {
    state.executionState = newState;

    const btnText = '<span>▶</span> Run Selected Scenarios';

    if (newState === 'running') {
      runBtn.disabled  = true;
      runBtn.innerHTML = '<span class="testlab-step-icon" style="display:inline-block;width:14px;height:14px;animation:spin 1s linear infinite;">⏳</span> Running...';
      if (pauseBtn)     { pauseBtn.style.display = 'inline-flex'; pauseBtn.innerHTML = '<span>⏸</span> Pause'; pauseBtn.className = 'testlab-btn testlab-btn-warning'; }
      if (stopBtn)        stopBtn.style.display  = 'inline-flex';
      if (execPauseBtn)  { execPauseBtn.style.display = 'inline-flex'; execPauseBtn.innerHTML = '<span>⏸</span> Pause'; execPauseBtn.className = 'testlab-btn testlab-btn-warning'; }
      if (execStopBtn)    execStopBtn.style.display  = 'inline-flex';
      executionStatus.textContent = 'Running';
      executionStatus.className   = 'testlab-info-badge';
      executionStatus.style.background = '';
      executionStatus.style.color      = '';

    } else if (newState === 'paused') {
      if (pauseBtn)    { pauseBtn.innerHTML = '<span>▶</span> Resume'; pauseBtn.className = 'testlab-btn testlab-btn-primary'; }
      if (execPauseBtn){ execPauseBtn.innerHTML = '<span>▶</span> Resume'; execPauseBtn.className = 'testlab-btn testlab-btn-primary'; }
      executionStatus.textContent = 'Paused (Sandbox Kept Alive)';
      executionStatus.className   = 'testlab-info-badge';

    } else if (newState === 'stopped' || newState === 'completed' || newState === 'idle') {
      runBtn.disabled  = false;
      runBtn.innerHTML = btnText;
      if (pauseBtn)    pauseBtn.style.display    = 'none';
      if (stopBtn)     stopBtn.style.display     = 'none';
      if (execPauseBtn) execPauseBtn.style.display = 'none';
      if (execStopBtn)  execStopBtn.style.display  = 'none';
      if (newState === 'stopped') {
        executionStatus.textContent = 'Stopped (Sandboxes Torn Down)';
        executionStatus.className   = 'testlab-info-badge';
      }
    }
  }

  // ── Live step card ────────────────────────────────────────────────────────
  function updateStepCard(step) {
    let card = document.getElementById(`step-card-${step.id}`);
    const icon = step.status === 'running' ? '⏳'
               : step.status === 'passed'  ? '✔'
               : step.status === 'skipped' ? '↷'
               : step.status === 'stopped' ? '⏹' : '✖';

    if (!card) {
      card = document.createElement('div');
      card.id        = `step-card-${step.id}`;
      card.className = `testlab-step-card ${step.status}`;
      card.innerHTML = `
        <div class="testlab-step-left">
          <div class="testlab-step-icon">${icon}</div>
          <div class="testlab-step-info">
            <h4>${step.checklistId ? `[${step.checklistId}] ` : ''}${step.title}</h4>
            <span id="step-assertions-${step.id}">${step.status === 'skipped' ? step.actualResult : 'Starting scenario...'}</span>
          </div>
        </div>
        <div class="testlab-step-duration" id="step-duration-${step.id}">
          ${step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''}
        </div>`;
      stepsContainer.appendChild(card);
    } else {
      card.className = `testlab-step-card ${step.status}`;
      const iconEl = card.querySelector('.testlab-step-icon');
      if (iconEl) iconEl.textContent = icon;

      const durationEl = document.getElementById(`step-duration-${step.id}`);
      if (durationEl && step.durationMs) {
        durationEl.textContent = `${(step.durationMs / 1000).toFixed(1)}s`;
      }

      // Add re-run button for failed steps
      if (step.status === 'failed' && durationEl && !durationEl.querySelector('.live-step-rerun-btn')) {
        const rerunBtn = document.createElement('button');
        rerunBtn.className   = 'testlab-btn testlab-btn-danger live-step-rerun-btn';
        rerunBtn.style.padding   = '2px 8px';
        rerunBtn.style.fontSize  = '10px';
        rerunBtn.style.marginLeft = '8px';
        rerunBtn.textContent = '▶ Re-run';
        rerunBtn.onclick = (e) => { e.stopPropagation(); startTestRun([step.checklistId || step.id]); };
        durationEl.appendChild(rerunBtn);
      }

      const assertionsEl = document.getElementById(`step-assertions-${step.id}`);
      if (assertionsEl) {
        if (step.status === 'skipped')       assertionsEl.textContent = step.actualResult || 'Skipped';
        else if (step.status === 'stopped')  assertionsEl.textContent = 'Stopped by user';
        else if (step.assertions?.length > 0) {
          const passed = step.assertions.filter((a) => a.passed).length;
          assertionsEl.textContent = `${passed}/${step.assertions.length} assertions passed`;
        }
      }
    }
  }

  // ── SSE stream ────────────────────────────────────────────────────────────
  function connectStream() {
    if (state.activeEventSource) state.activeEventSource.close();
    state.activeEventSource = new EventSource('/api/postqode-test/stream');

    state.activeEventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      const div  = document.createElement('div');
      div.className   = 'log-entry';
      div.textContent = data.message;
      terminalLogs.appendChild(div);
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
      logCount.textContent = `${terminalLogs.children.length} lines`;
    });

    state.activeEventSource.addEventListener('step', (e) => {
      updateStepCard(JSON.parse(e.data).step);
    });

    state.activeEventSource.addEventListener('stateChange', (e) => {
      updateExecutionState(JSON.parse(e.data).state);
    });

    state.activeEventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      if (state.activeEventSource) { state.activeEventSource.close(); state.activeEventSource = null; }
      updateExecutionState('completed');
      executionStatus.textContent = data.report.summary.failed === 0 ? 'All Passed ✔' : `${data.report.summary.failed} Failed ✖`;
      executionStatus.className   = data.report.summary.failed === 0 ? 'testlab-info-badge success' : 'testlab-info-badge';
      if (data.report.summary.failed > 0) {
        executionStatus.style.background = 'rgba(248,81,73,0.15)';
        executionStatus.style.color      = '#f85149';
      }
      if (_displayReport) _displayReport(data.report);
      if (_loadRuns)      _loadRuns();
    });

    state.activeEventSource.addEventListener('error', () => {
      if (state.executionState === 'running') {
        updateExecutionState('idle');
        executionStatus.textContent = 'Stream disconnected';
      }
    });
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────
  async function togglePause() {
    if (state.executionState === 'running') {
      try {
        const res  = await fetch('/api/postqode-test/pause', { method: 'POST' });
        const data = await res.json();
        if (data.success) updateExecutionState('paused');
      } catch (e) { alert(`Error pausing: ${e.message}`); }
    } else if (state.executionState === 'paused') {
      try {
        const res  = await fetch('/api/postqode-test/resume', { method: 'POST' });
        const data = await res.json();
        if (data.success) updateExecutionState('running');
      } catch (e) { alert(`Error resuming: ${e.message}`); }
    }
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
  async function handleStop() {
    if (!confirm('Stop test execution? Standalone IDE and sandboxes will be torn down immediately.')) return;
    try {
      if (execStopBtn) { execStopBtn.disabled = true; execStopBtn.innerHTML = 'Stopping...'; }
      if (stopBtn)       stopBtn.disabled = true;
      await fetch('/api/postqode-test/stop', { method: 'POST' });
      if (execStopBtn) execStopBtn.disabled = false;
      if (stopBtn)     stopBtn.disabled     = false;
      updateExecutionState('stopped');
      if (_loadRuns) _loadRuns();
    } catch (e) { alert(`Error stopping: ${e.message}`); }
  }

  // ── Button listeners ──────────────────────────────────────────────────────
  if (pauseBtn)    pauseBtn.addEventListener('click', togglePause);
  if (execPauseBtn) execPauseBtn.addEventListener('click', togglePause);
  if (stopBtn)     stopBtn.addEventListener('click', handleStop);
  if (execStopBtn) execStopBtn.addEventListener('click', handleStop);

  // ── startTestRun ──────────────────────────────────────────────────────────
  async function startTestRun(explicitScenarios = null) {
    let selectedScenarios = explicitScenarios;
    if (!selectedScenarios || selectedScenarios.length === 0) {
      selectedScenarios = Array.from(
        checklist.querySelectorAll('input[type="checkbox"]:checked')
      ).map((cb) => cb.value);
    }
    if (!selectedScenarios || selectedScenarios.length === 0) {
      alert('Please select at least one test scenario to execute.');
      return;
    }

    // Collect optional provider API keys
    const providerApiKeys = {};
    const anthropicKey  = document.getElementById('key-input-prov-04')?.value.trim();
    const openrouterKey = document.getElementById('key-input-prov-05')?.value.trim();
    if (anthropicKey)  providerApiKeys.anthropic   = anthropicKey;
    if (openrouterKey) providerApiKeys.openrouter  = openrouterKey;

    updateExecutionState('running');
    executionSection.style.display = 'block';

    const reportSection = document.getElementById('testlab-report-section');
    if (reportSection) reportSection.style.display = 'none';

    stepsContainer.innerHTML  = '';
    terminalLogs.innerHTML    = '';
    logCount.textContent      = '0 lines';
    executionStatus.textContent = 'Running';
    executionStatus.className   = 'testlab-info-badge';
    executionTitle.textContent  = `Running ${selectedScenarios.length} Scenario(s) on ${targetSelect.value}...`;
    executionSection.scrollIntoView({ behavior: 'smooth' });

    connectStream();

    try {
      const res  = await fetch('/api/postqode-test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host:          targetSelect.value,
          mode:          state.currentMode,
          buildSource:   buildSelect.value,
          localBuildPath: localPathInput.value.trim() || null,
          liveModel:     liveModelSelect.value || 'moonshotai/kimi-k3',
          providerApiKeys,
          scenarios:     selectedScenarios,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start test run.');
        updateExecutionState('idle');
      } else {
        state.activeRunId = data.runId;
      }
    } catch (e) {
      alert(`Network error: ${e.message}`);
      updateExecutionState('idle');
    }
  }

  runBtn.addEventListener('click', () => startTestRun());

  return { startTestRun, setDisplayReport, setLoadRuns, updateExecutionState };
}
