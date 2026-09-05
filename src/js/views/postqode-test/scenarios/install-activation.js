/**
 * Scenarios — Sheet: Install & Activation
 */
export const installScenarios = [
  {
    id: 'uninstall',
    checklistId: 'INS-07',
    sheetName: 'Install & Activation',
    priority: 'P2',
    title: 'INS-07: Clean Uninstall Lifecycle',
    desc: 'Uninstalls extension in test sandbox, verifies complete filesystem deletion and zero lingering processes.',
    defaultChecked: false,
  },
  {
    id: 'install',
    checklistId: 'INS-01',
    sheetName: 'Install & Activation',
    priority: 'P0',
    title: 'INS-01: Clean Install from VSIX / Marketplace',
    desc: 'Installs package into test profile; asserts unpack integrity, package.json manifest, and version.',
    defaultChecked: false,
  },
  {
    id: 'startup',
    checklistId: 'INS-02',
    sheetName: 'Install & Activation',
    priority: 'P1',
    title: 'INS-02: Startup Performance & Window Launch',
    desc: 'Measures time from window launch to CDP attachment and sidebar readiness (<15s SLA).',
    defaultChecked: true,
  },
];
