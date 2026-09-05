/**
 * Scenarios — Sheet: GUI & Editor Integration
 */
export const guiScenarios = [
  {
    id: 'activation',
    checklistId: 'GUI-01',
    sheetName: 'GUI & Editor Integration',
    priority: 'P0',
    title: 'GUI-01: Activity-Bar UI Icon & Full Hydration',
    desc: 'Clicks PostQode Activity Bar icon via UI; asserts logo, tasks, prompt box, and status bar hydrate.',
    defaultChecked: true,
  },
  {
    id: 'view-title',
    checklistId: 'GUI-02',
    sheetName: 'GUI & Editor Integration',
    priority: 'P1',
    title: 'GUI-02: View Title Navigation Action Icons',
    desc: 'Inspects view title action buttons (+, History, Settings, MCP, Rules, Account) in header DOM.',
    defaultChecked: true,
  },
  {
    id: 'fullscreen-resize',
    checklistId: 'GUI-07',
    sheetName: 'GUI & Editor Integration',
    priority: 'P1',
    title: 'GUI-07: Fullscreen Toggle & Dynamic Editor Auto-Resize',
    desc: 'Expands PostQode to fullscreen; opens file in Monaco editor; asserts side-by-side resize and context attachment.',
    defaultChecked: true,
  },
  {
    id: 'bottom-controls',
    checklistId: 'UI-03',
    sheetName: 'GUI & Editor Integration',
    priority: 'P0',
    title: 'UI-03: Bottom Prompt Controls, Mode Dropdown & Model Badge',
    desc: 'Inspects prompt controls, tests Mode dropdown click, dynamically verifies active model badge.',
    defaultChecked: true,
  },
];
