/**
 * SSE Mock Scenarios for PostQode Testing
 * Generates OpenRouter / OpenAI compatible Server-Sent Events (SSE)
 * that PostQode expects at /gateway/v1/postqode-provider/chat/completions.
 */

function buildChunk({ id, model = 'z-ai/glm-5.2:free', delta = {}, finish_reason = null, usage = null }) {
  const payload = {
    id: id || `gen-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    provider: 'PostQodeMockProvider',
    choices: [
      {
        index: 0,
        delta,
        finish_reason,
        native_finish_reason: finish_reason,
      },
    ],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Stream an assistant text response incrementally chunk-by-chunk.
 */
async function streamTextResponse({
  res,
  text,
  chunkSize = 12,
  chunkDelayMs = 40,
  model = 'z-ai/glm-5.2:free',
  onChunk,
}) {
  const id = `gen-${Date.now()}`;
  let sentChunks = [];

  // Initial comment / role
  const initComment = ': OPENROUTER PROCESSING\n\n';
  res.write(initComment);
  sentChunks.push(initComment);

  const initChunk = buildChunk({
    id,
    model,
    delta: { role: 'assistant', content: '' },
  });
  res.write(initChunk);
  sentChunks.push(initChunk);
  if (onChunk) onChunk(initChunk);

  // Stream text content in segments
  for (let i = 0; i < text.length; i += chunkSize) {
    if (res.writableEnded || res.destroyed) break;
    const slice = text.slice(i, i + chunkSize);
    const chunk = buildChunk({
      id,
      model,
      delta: { content: slice },
    });
    res.write(chunk);
    sentChunks.push(chunk);
    if (onChunk) onChunk(chunk);
    if (chunkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
  }

  // Final chunk with usage & finish_reason = stop
  if (!res.writableEnded && !res.destroyed) {
    const finalChunk = buildChunk({
      id,
      model,
      delta: {},
      finish_reason: 'stop',
      usage: {
        prompt_tokens: 120,
        completion_tokens: Math.ceil(text.length / 4),
        total_tokens: 120 + Math.ceil(text.length / 4),
        cost: 0,
      },
    });
    res.write(finalChunk);
    sentChunks.push(finalChunk);
    if (onChunk) onChunk(finalChunk);

    const doneChunk = 'data: [DONE]\n\n';
    res.write(doneChunk);
    sentChunks.push(doneChunk);
    res.end();
  }

  return sentChunks.join('');
}

/**
 * Stream a tool call (e.g. read_file, write_to_file, or attempt_completion)
 */
async function streamToolCallResponse({
  res,
  toolName,
  argsObj,
  chunkDelayMs = 30,
  model = 'z-ai/glm-5.2:free',
  onChunk,
}) {
  const id = `gen-${Date.now()}`;
  const toolCallId = `call-${Date.now()}`;
  const argsString = JSON.stringify(argsObj);
  let sentChunks = [];

  const initComment = ': OPENROUTER PROCESSING\n\n';
  res.write(initComment);
  sentChunks.push(initComment);

  // Send tool call initiation
  const startChunk = buildChunk({
    id,
    model,
    delta: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          index: 0,
          id: toolCallId,
          type: 'function',
          function: { name: toolName, arguments: '' },
        },
      ],
    },
  });
  res.write(startChunk);
  sentChunks.push(startChunk);
  if (onChunk) onChunk(startChunk);

  // Stream arguments in chunks
  const chunkSize = 20;
  for (let i = 0; i < argsString.length; i += chunkSize) {
    if (res.writableEnded || res.destroyed) break;
    const argSlice = argsString.slice(i, i + chunkSize);
    const argChunk = buildChunk({
      id,
      model,
      delta: {
        tool_calls: [
          {
            index: 0,
            function: { arguments: argSlice },
          },
        ],
      },
    });
    res.write(argChunk);
    sentChunks.push(argChunk);
    if (onChunk) onChunk(argChunk);
    if (chunkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
  }

  // End of tool call
  if (!res.writableEnded && !res.destroyed) {
    const endChunk = buildChunk({
      id,
      model,
      delta: { content: '', role: 'assistant' },
      finish_reason: 'tool_calls',
      usage: {
        prompt_tokens: 300,
        completion_tokens: 80,
        total_tokens: 380,
        cost: 0,
      },
    });
    res.write(endChunk);
    sentChunks.push(endChunk);
    if (onChunk) onChunk(endChunk);

    const doneChunk = 'data: [DONE]\n\n';
    res.write(doneChunk);
    sentChunks.push(doneChunk);
    res.end();
  }

  return sentChunks.join('');
}

/**
 * Stream a response with <think>...</think> reasoning blocks followed by final response.
 * Used to verify CHAT-03 progressive rendering and <think> tag sanitization.
 */
async function streamWithThinkTags({
  res,
  thinkingText = 'Analyzing requirements and planning execution steps...',
  responseText = 'I will create the requested file and configure the environment cleanly.',
  chunkDelayMs = 25,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  const fullText = `<think>\n${thinkingText}\n</think>\n\n${responseText}`;
  return streamTextResponse({
    res,
    text: fullText,
    chunkSize: 10,
    chunkDelayMs,
    model,
    onChunk,
  });
}

/**
 * Stream multiple tool calls simultaneously in a single turn.
 * Used for CHAT-07 (Parallel tool calling batching reads).
 */
async function streamParallelToolCalls({
  res,
  toolCalls = [],
  chunkDelayMs = 20,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  const id = `gen-${Date.now()}`;
  let sentChunks = [];

  const initComment = ': OPENROUTER PROCESSING\n\n';
  res.write(initComment);
  sentChunks.push(initComment);

  const initChunk = buildChunk({
    id,
    model,
    delta: {
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map((tc, idx) => ({
        index: idx,
        id: tc.id || `call-${Date.now()}-${idx}`,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
      })),
    },
  });
  res.write(initChunk);
  sentChunks.push(initChunk);
  if (onChunk) onChunk(initChunk);

  if (chunkDelayMs > 0) {
    await new Promise((r) => setTimeout(r, chunkDelayMs));
  }

  if (!res.writableEnded && !res.destroyed) {
    const endChunk = buildChunk({
      id,
      model,
      delta: { content: '', role: 'assistant' },
      finish_reason: 'tool_calls',
      usage: {
        prompt_tokens: 350,
        completion_tokens: 90,
        total_tokens: 440,
        cost: 0,
      },
    });
    res.write(endChunk);
    sentChunks.push(endChunk);
    if (onChunk) onChunk(endChunk);

    const doneChunk = 'data: [DONE]\n\n';
    res.write(doneChunk);
    sentChunks.push(doneChunk);
    res.end();
  }

  return sentChunks.join('');
}

/**
 * Stream mock response for PostQode Slash Commands.
 * Simulates tool calls (e.g. write_to_file for AGENTS.md, rules, workflows)
 * or structured text responses according to the slash command invoked.
 */
async function streamSlashCommandResponse({
  res,
  command,
  param = '',
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  const cmd = (command || '').toLowerCase().trim();

  if (cmd === '/init' || cmd.startsWith('/init')) {
    const agentsMdContent = `# PostQode Workspace Guidelines\n\n## Project Architecture\n- Architecture: Express REST API & Vite Web Application\n- Target Host: VS Code / VS Code Insiders\n- Proxy Engine: Port 3457\n\n## Coding & Testing Standards\n- Run automated matrix tests via PQ Dashboard\n- Maintain clean sandboxes and full teardown\n`;
    return streamToolCallResponse({
      res,
      toolName: 'write_to_file',
      argsObj: { path: 'AGENTS.md', content: agentsMdContent },
      model,
      onChunk,
    });
  }

  if (cmd === '/newrule' || cmd.startsWith('/newrule')) {
    const ruleName = param.trim() || 'code-style';
    const ruleContent = `# Rule: ${ruleName}\n\n- Ensure code quality and consistent formatting\n- Use meaningful variable names\n- Add unit tests for all newly added endpoints\n`;
    // new_rule is a real PostQode tool — PostQode handles writing this to .postqode/rules/
    return streamToolCallResponse({
      res,
      toolName: 'new_rule',
      argsObj: { path: `.postqode/rules/${ruleName}.md`, content: ruleContent },
      model,
      onChunk,
    });
  }

  if (cmd === '/workflow' || cmd.startsWith('/workflow')) {
    const wfName = param.trim() || 'deploy-service';
    const wfContent = `# Workflow: ${wfName}\n\n## 1. Run Verification\nVerify build succeeds without errors.\n\n## 2. Deploy Service\nDeploy updated package to target environment.\n\n## Validation\n- Check service status endpoint returns 200 OK\n`;
    // new_workflow is a real PostQode tool — PostQode handles writing this to .postqode/workflows/
    return streamToolCallResponse({
      res,
      toolName: 'new_workflow',
      argsObj: { path: `.postqode/workflows/${wfName}.md`, content: wfContent },
      model,
      onChunk,
    });
  }

  if (cmd === '/newtask' || cmd.startsWith('/newtask')) {
    const handoffContext = `## Handoff Context for New Task\n- Goal: Automated PostQode test verification\n- Progress: Configured CDP controller and test runners\n- Active Files: Scenarios, checklist, runner, and mock proxy\n- Key Decisions: Multi-IDE support enabled (VS Code, Cursor, Windsurf)\n`;
    return streamToolCallResponse({
      res,
      toolName: 'new_task',
      argsObj: { context: handoffContext },
      model,
      onChunk,
    });
  }

  if (cmd === '/compact' || cmd.startsWith('/compact')) {
    const summaryContext = `## Compacted Conversation Summary\n- Context: Completed initial environment inspection and CDP connection.\n- Decision: Target host selected as VS Code Insiders with live Moonshot Kimi K3 provider.\n- Status: All dependencies healthy and proxy active.\n`;
    // Stream a visible summary text first so DOM has content to detect,
    // then emit the condense tool call that PostQode uses to render the action button
    return streamToolCallResponse({
      res,
      toolName: 'condense',
      argsObj: { summary: summaryContext },
      model,
      onChunk,
    });
  }

  if (cmd === '/globalrule' || cmd.startsWith('/globalrule')) {
    const ruleName = param.trim() || 'security-baseline';
    const globalRulePath = require('path').join(require('os').homedir(), '.postqode', 'rules', `${ruleName}.md`);
    const ruleContent = `# Global Rule: ${ruleName}\n\n- Follow organizational security baseline\n- Never commit unencrypted secrets or credentials\n- Enforce strict typing across all modules\n`;
    // new_global_rule is a real PostQode tool — PostQode handles writing this to global ~/.postqode/rules/
    return streamToolCallResponse({
      res,
      toolName: 'new_global_rule',
      argsObj: { path: globalRulePath, content: ruleContent },
      model,
      onChunk,
    });
  }

  if (cmd === '/globalworkflow' || cmd.startsWith('/globalworkflow')) {
    const wfName = param.trim() || 'team-review';
    const globalWfPath = require('path').join(require('os').homedir(), '.postqode', 'workflows', `${wfName}.md`);
    const wfContent = `# Global Workflow: ${wfName}\n\n## 1. Peer Review\nRun code quality check across repository.\n\n## 2. Security Scan\nRun dependency audit and secret scan.\n`;
    // new_global_workflow is a real PostQode tool — PostQode handles writing this to global ~/.postqode/workflows/
    return streamToolCallResponse({
      res,
      toolName: 'new_global_workflow',
      argsObj: { path: globalWfPath, content: wfContent },
      model,
      onChunk,
    });
  }

  if (cmd === '/reportbug' || cmd.startsWith('/reportbug')) {
    return streamToolCallResponse({
      res,
      toolName: 'report_bug',
      argsObj: {
        title: 'PostQode automated test verification report',
        description: 'Automated test run diagnostic verification',
        steps_to_reproduce: '1. Launch IDE with CDP\n2. Open PostQode webview\n3. Execute sanity check',
        expected_behavior: 'All assertions pass cleanly',
        actual_behavior: 'Verified successfully'
      },
      model,
      onChunk,
    });
  }

  if (cmd === '/deep-planning' || cmd.startsWith('/deep-planning')) {
    const responseText = `# Deep Planning: Architecture & Execution Blueprint\n\n## 1. Codebase Investigation\nAnalyzed components and dependencies across workspace.\n\n## 2. Implementation Strategy\n- Step 1: Establish isolated testing sandbox with custom profile.\n- Step 2: Route completions via proxy to validate SSE chunks.\n- Step 3: Capture DOM evidence and verify state persistence.\n\n## 3. Verification Plan\nRun test suite and check Allure assertion report.`;
    return streamTextResponse({ res, text: responseText, model, onChunk });
  }

  if (cmd === '/explain-changes' || cmd.startsWith('/explain-changes')) {
    const responseText = `### Git Diff Explanation\n\n1. **Scenarios Expansion**: Added dedicated modules for Slash Commands and Workflows.\n2. **UI Controls**: Added quick module dropdown option and navigation tabs.\n3. **Mock Engine**: Added deterministic SSE handlers for zero-token verification.`;
    return streamTextResponse({ res, text: responseText, model, onChunk });
  }

  // Fallback for custom slash command / workflow
  return streamTextResponse({
    res,
    text: `Executed slash command \`${cmd}\` successfully. All pipeline assertions verified.`,
    model,
    onChunk,
  });
}

/**
 * Stream HTTP error (e.g. 401 Unauthorized for PROV-09).
 */
function streamHttpError({ res, statusCode = 401, message = 'Invalid API key: unauthorized', code = 'invalid_api_key' }) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: {
      message,
      type: 'authentication_error',
      code,
    },
  }));
}

/**
 * Stream tool call that requires explicit user approval (CHAT-04).
 * Uses execute_command which triggers PostQode's approval card.
 */
async function streamApprovalToolCall({
  res,
  command = "echo 'Testing PostQode Approval Workflow'",
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  return streamToolCallResponse({
    res,
    toolName: 'execute_command',
    argsObj: { command, requires_approval: true },
    model,
    onChunk,
  });
}

/**
 * Stream background task tool call (CHAT-11).
 */
async function streamBackgroundTaskResponse({
  res,
  command = 'echo "Background task in progress..." && sleep 1',
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  return streamToolCallResponse({
    res,
    toolName: 'execute_command',
    argsObj: { command, requires_approval: false },
    model,
    onChunk,
  });
}

/**
 * Stream mistake / malformed response to test mistake escalation guard (CHAT-08).
 */
async function streamMistakeResponse({
  res,
  attemptNumber = 1,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  // Deliberately stream text without expected tools or malformed content
  const mistakeText = attemptNumber >= 2
    ? 'I am having trouble formatting the tool call properly. Please provide guidance.'
    : 'Processing request with incomplete parameters...';
  return streamTextResponse({
    res,
    text: mistakeText,
    model,
    onChunk,
  });
}

/**
 * Stream mock response for PostQode Workflows with tool invocation support.
 */
async function streamWorkflowStepResponse({
  res,
  stepNumber = 1,
  workflowName = 'review-pr.md',
  toolCall = null,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  if (toolCall === 'ask_followup_question' || stepNumber === 2) {
    return streamToolCallResponse({
      res,
      toolName: 'ask_followup_question',
      argsObj: {
        question: `Workflow [${workflowName}] step 2 requires verification: Confirm PR review actions?`,
        options: ['Proceed with Automated Review', 'Require Manual Sign-off'],
      },
      model,
      onChunk,
    });
  }
  const text = `### Workflow Step ${stepNumber}: [${workflowName}]\n1. Inspecting workspace configuration and dependencies.\n2. Executing automated validation assertions.\n3. Step completed cleanly with status: SUCCESS.`;
  return streamTextResponse({ res, text, model, onChunk });
}

/**
 * Stream mock response for PostQode Skills invoking the use_skill tool.
 */
async function streamSkillToolCallResponse({
  res,
  skillName = 'custom-deploy',
  argsObj = null,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  return streamToolCallResponse({
    res,
    toolName: 'use_skill',
    argsObj: argsObj || { skill_name: skillName },
    model,
    onChunk,
  });
}

/**
 * Stream multi-step file read and summary loop response.
 * Used for CHAT-02.
 */
async function streamMultiStepFileReadSummary({
  res,
  reqBody = null,
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  const messages = reqBody?.messages || [];
  const hasToolResult = messages.some(
    (m) => m.role === 'tool' || (typeof m.content === 'string' && m.content.includes('sample-project'))
  );

  if (hasToolResult) {
    const summaryText = `### Project Structure Summary\n- Package: **sample-project** (v1.0.0)\n- File \`package.json\` verified.\n- Multi-turn loop completed successfully without errors.`;
    return streamTextResponse({ res, text: summaryText, model, onChunk });
  }

  // Turn 1: emit read_file tool call
  return streamToolCallResponse({
    res,
    toolName: 'read_file',
    argsObj: { path: 'package.json' },
    model,
    onChunk,
  });
}

module.exports = {
  buildChunk,
  streamTextResponse,
  streamToolCallResponse,
  streamWithThinkTags,
  streamParallelToolCalls,
  streamSlashCommandResponse,
  streamWorkflowStepResponse,
  streamSkillToolCallResponse,
  streamMultiStepFileReadSummary,
  streamHttpError,
  streamApprovalToolCall,
  streamBackgroundTaskResponse,
  streamMistakeResponse,
};


