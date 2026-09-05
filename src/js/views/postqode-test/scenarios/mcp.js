/**
 * Scenarios — Sheet: MCP
 */
export const mcpScenarios = [
  {
    id: 'mcp',
    checklistId: 'MCP-01',
    sheetName: 'MCP',
    priority: 'P1',
    title: 'MCP-01: MCP Server View Inspection via UI Click',
    desc: 'Clicks MCP icon in view title via UI; inspects tool status and server list.',
    meaning: 'Proves Model Context Protocol integration contract: clicking the MCP view title icon mounts the server orchestration panel, showing connected server endpoints, tool catalogs, and communication status.',
    pipeline: {
      request: 'Header navigation click on MCP plug icon in view title DOM',
      tools: 'MCP client manager & server registry',
      response: 'MCP management panel DOM loaded with server status and tools catalog',
      uiAndSideEffects: 'MCP server list rendered in webview DOM, tool status indicators verified, clicking + returns to chat cleanly',
    },
    sideEffects: 'MCP Registry: Server state and tool list inspected',
    defaultChecked: true,
  },
];
