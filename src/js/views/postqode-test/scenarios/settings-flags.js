/**
 * Scenarios — Sheet: Settings & Feature Flags
 */
export const settingsScenarios = [
  {
    id: 'settings',
    checklistId: 'SET-01',
    sheetName: 'Settings & Feature Flags',
    priority: 'P0',
    title: 'SET-01: Settings Panel Inspection via UI Click',
    desc: 'Clicks Settings Gear icon in view title via UI; verifies settings controls render; returns via + click.',
    meaning: 'Proves view navigation contract: header action buttons correctly route the webview to the Settings panel, exposing provider configurations and feature toggles, and returning cleanly to chat upon clicking + New Task.',
    pipeline: {
      request: 'Header navigation click on Settings Gear icon in view title DOM',
      tools: 'VS Code view router & settings panel mount',
      response: 'Settings panel DOM loaded with API provider, models, and capability toggles',
      uiAndSideEffects: 'Settings view container visible, interactive toggles present, clicking + returns to chat cleanly',
    },
    sideEffects: 'View Navigation: Settings container mounted and unmounted',
    defaultChecked: true,
  },
];
