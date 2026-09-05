/**
 * Scenarios — Sheet: Checkpoints, History & State
 */
export const historyScenarios = [
  {
    id: 'recent-tasks',
    checklistId: 'HIST-02',
    sheetName: 'Checkpoints, History & State',
    priority: 'P1',
    title: 'HIST-02: Dynamic Recent Tasks Inspection (Middle Part)',
    desc: 'Dynamically parses Recent Tasks cards, token counts, and cost badges without hardcoding.',
    meaning: 'Proves recent session telemetry contract: past task sessions displayed in the welcome view are extracted dynamically from the state store, verifying card summaries, token counts, and cost metrics without brittle hardcoded strings.',
    pipeline: {
      request: 'Inspect Recent Tasks container in PostQode welcome view DOM',
      tools: 'Task session history store',
      response: 'Recent task cards array returned with telemetry metadata',
      uiAndSideEffects: 'Dynamic task card containers verified in DOM, token counts and cost badges parsed, "View all" history link validated',
    },
    sideEffects: 'State Inspection: Dynamic session metrics validated',
    defaultChecked: true,
  },
  {
    id: 'history',
    checklistId: 'HIST-01',
    sheetName: 'Checkpoints, History & State',
    priority: 'P1',
    title: 'HIST-01: Task History Drawer via UI Click',
    desc: 'Clicks History Clock in view title via UI; verifies session history drawer renders cleanly.',
    meaning: 'Proves checkpoint restoration contract: clicking the History Clock icon opens the history slide-out drawer, displaying past task sessions for instant inspection or restoration, and returns to chat upon clicking + New Task.',
    pipeline: {
      request: 'Header navigation click on History Clock icon in view title DOM',
      tools: 'Task history drawer controller',
      response: 'History drawer slide-out animation completes in webview',
      uiAndSideEffects: 'History panel renders task session list in DOM, clicking New Task returns to fresh prompt view',
    },
    sideEffects: 'View Navigation: History drawer state opened and closed',
    defaultChecked: true,
  },
];
