/**
 * Scenarios — Sheet: Files & Terminal Tools
 */
export const filesScenarios = [
  {
    id: 'agent-tools',
    checklistId: 'FILE-01',
    sheetName: 'Files & Terminal Tools',
    priority: 'P0',
    title: 'FILE-01: Agent Tool Execution & Workspace Mutation',
    desc: 'Agent executes write_to_file in fixture workspace; verifies file content on disk and preserves artifact.',
    meaning: 'Proves the agentic file mutation contract: agent interprets file creation prompt, calls write_to_file tool with file path and content, extension writes physical bytes to workspace disk, and artifact is preserved for audit.',
    pipeline: {
      request: 'Prompt submitted via UI: "Create result.txt with test verification details"',
      tools: 'write_to_file({ path: "result.txt", content: "..." }) invoked by PostQode',
      response: 'Tool output confirmation and completion summary streamed to chat DOM',
      uiAndSideEffects: 'result.txt created on disk in workspace, non-empty byte count verified, preserved in test artifacts, and cleaned up',
    },
    sideEffects: 'Filesystem Mutation: result.txt created in workspace fixture',
    defaultChecked: true,
  },
];
