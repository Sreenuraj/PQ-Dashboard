/**
 * Scenarios barrel — re-exports every sheet's scenarios in execution order.
 * To add a new sheet: create a new file in this directory, add to the import
 * below, and spread it into `allScenarios`.
 */
import { providerScenarios } from './providers-models.js';
import { guiScenarios } from './gui-editor.js';
import { installScenarios } from './install-activation.js';
import { settingsScenarios } from './settings-flags.js';
import { mcpScenarios } from './mcp.js';
import { historyScenarios } from './history-state.js';
import { chatScenarios } from './chat-agent.js';
import { filesScenarios } from './files-tools.js';
import { slashScenarios } from './slash-commands.js';
import { workflowRuleSkillScenarios } from './workflows-rules-skills.js';

export const allScenarios = [
  ...providerScenarios,
  ...guiScenarios,
  ...installScenarios,
  ...historyScenarios,
  ...settingsScenarios,
  ...mcpScenarios,
  ...chatScenarios,
  ...filesScenarios,
  ...slashScenarios,
  ...workflowRuleSkillScenarios,
];

// Named re-exports for direct use in preset logic
export {
  providerScenarios,
  guiScenarios,
  installScenarios,
  settingsScenarios,
  mcpScenarios,
  historyScenarios,
  chatScenarios,
  filesScenarios,
  slashScenarios,
  workflowRuleSkillScenarios,
};

