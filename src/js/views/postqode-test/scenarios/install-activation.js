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
    meaning: 'Proves clean teardown contract: uninstalling the PostQode extension completely purges extension files from the host filesystem with zero lingering background daemon processes, orphaned temp directories, or cross-profile state leakage.',
    pipeline: {
      request: 'Extension uninstall trigger in sandbox test profile',
      tools: 'VS Code extension manager',
      response: 'Extension removed from active registry',
      uiAndSideEffects: 'Extension directory deleted from disk in extensions dir, zero postqode child processes remaining',
    },
    sideEffects: 'Filesystem Cleanup: Extension package directory fully removed',
    defaultChecked: false,
  },
  {
    id: 'install',
    checklistId: 'INS-01',
    sheetName: 'Install & Activation',
    priority: 'P0',
    title: 'INS-01: Clean Install from VSIX / Marketplace',
    desc: 'Installs package into test profile; asserts unpack integrity, package.json manifest, and version.',
    meaning: 'Proves package distribution contract: newly built VSIX or marketplace package installs cleanly into an isolated profile, unpacks required assets, contributes valid extension points, and matches the expected semver version.',
    pipeline: {
      request: 'Install extension package into clean test profile',
      tools: 'VSIX unpacker & extension subsystem',
      response: 'Exit code 0 and package unpacked',
      uiAndSideEffects: 'package.json manifest parsed on disk, version validated, activation events confirmed',
    },
    sideEffects: 'Filesystem Verification: Package unpacked and manifest parsed on disk',
    defaultChecked: false,
  },
  {
    id: 'startup',
    checklistId: 'INS-02',
    sheetName: 'Install & Activation',
    priority: 'P1',
    title: 'INS-02: Startup & PostQode Runtime Activation',
    desc: 'Measures time from window launch to CDP attachment (<15s SLA) and asserts PostQode is loaded, registered, and active in the IDE runtime.',
    meaning: 'Proves startup and activation contract: launching VS Code with PostQode does not block workbench initialization, CDP attaches within <15s SLA, and PostQode extension is verified loaded and active in the IDE runtime.',
    pipeline: {
      request: 'Spawn isolated VS Code instance with CDP debugging port',
      tools: 'Process launcher & CDP connection adapter',
      response: 'CDP port responds with active page target',
      uiAndSideEffects: 'Startup latency measured under 15s SLA, PostQode extension verified active in runtime',
    },
    sideEffects: 'Process Lifecycle & Verification: Sandbox spawned, attached via CDP, and PostQode verified active',
    defaultChecked: true,
  },
];
