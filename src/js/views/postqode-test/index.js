/**
 * PostQode Test Lab — main orchestrator.
 *
 * Module map:
 *  template.js          → static HTML scaffold
 *  scenarios/index.js   → all sheet scenario definitions (split per-sheet)
 *  checklist.js         → renderChecklist (accordion, select-toggle, tabs, presets)
 *  runner.js            → connectStream, startTestRun, pause/resume/stop, state machine
 *  report.js            → displayReport, loadRuns, loadRunReport, screenshot gallery
 *
 * Circular dependency (runner ↔ report) is resolved via setDisplayReport / setLoadRuns
 * setter injection after both modules are initialised.
 */

import { getTemplate }    from './template.js';
import { allScenarios }   from './scenarios/index.js';
import { initChecklist }  from './checklist.js';
import { initRunner }     from './runner.js';
import { initReport }     from './report.js';

export async function renderPostQodeTest(container) {
  // 1. Inject template HTML
  container.innerHTML = getTemplate();

  // 2. Shared mutable state — passed by reference to all modules
  const state = {
    currentMode:       'mocked',
    activeEventSource: null,
    activeRunId:       null,
    currentReportData: null,
    currentCategory:   'all',
    executionState:    'idle', // 'idle' | 'running' | 'paused' | 'stopped' | 'completed'
    scenariosData:     allScenarios.map((s) => ({ ...s })), // mutable copy
  };

  // 3. Init runner first so we have startTestRun available for checklist inline buttons
  const runner = initRunner(state, null /* renderChecklist injected below */);

  // 4. Init checklist — pass startTestRun so "Run Module" inline buttons work
  const { renderChecklist, setScenarioChecked } = initChecklist(state, runner.startTestRun);

  // 5. Init report — pass renderChecklist + startTestRun for re-run wiring
  const { loadRuns, displayReport } = initReport(state, renderChecklist, runner.startTestRun);

  // 6. Inject report callbacks into runner (resolve circular dependency)
  runner.setDisplayReport(displayReport);
  runner.setLoadRuns(loadRuns);

  // 7. Initial checklist render
  renderChecklist('all');

  // 8. Restore active test execution if one is running in background
  runner.checkActiveRun();

  // 8. Re-run from Allure report deep-link (e.g. /#/postqode-test?rerun=CHAT-01)
  const currentHash = window.location.hash || '';
  if (currentHash.includes('rerun=')) {
    const match = currentHash.match(/rerun=([^&]+)/);
    if (match && match[1]) {
      const rerunId = decodeURIComponent(match[1]);
      setTimeout(() => {
        state.scenariosData.forEach((sc) => {
          sc.defaultChecked = sc.id === rerunId || sc.checklistId === rerunId;
        });
        renderChecklist('all');
        runner.startTestRun([rerunId]);
      }, 500);
    }
  }
}
