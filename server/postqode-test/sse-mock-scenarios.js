/**
 * SSE Mock Scenarios for PostQode Testing
 * Generates OpenRouter / OpenAI compatible Server-Sent Events (SSE)
 * that PostQode expects at /gateway/v1/postqode-provider/chat/completions.
 */
const fs = require('fs');
const path = require('path');

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
 * Robustly parses user messages from PostQode request payloads.
 * Strips out <environment_details> entirely (which contains directory file listings like calculator.js).
 * Extracts:
 * - commandType: e.g. 'init', 'new_task', 'condense', 'new_rule', 'new_workflow', 'report_bug' from <explicit_instructions>
 * - taskText: clean user task text from <task>...</task>
 * - fullUserText: entire non-environment user instruction text
 * - isToolResult: whether message represents a tool result return
 */
function parsePostQodeUserMessage(messages) {
  let latestUserMsg = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      latestUserMsg = messages[i];
      break;
    }
  }
  if (!latestUserMsg) {
    return { commandType: null, taskText: '', fullUserText: '', isToolResult: false };
  }

  const content = latestUserMsg.content;
  let userText = '';
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const cleaned = block.text.replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, '').trim();
        if (cleaned) {
          userText += cleaned + '\n';
        }
      } else if (block.type === 'tool_result') {
        const resultText = typeof block.content === 'string'
          ? block.content
          : (Array.isArray(block.content) ? block.content.map((c) => c.text || '').join(' ') : JSON.stringify(block.content || ''));
        userText += `[tool_result] ${resultText}\n`;
      }
    }
  } else if (typeof content === 'string') {
    userText = content.replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, '');
  }

  userText = userText.trim();

  // Determine if incoming user message is a tool result
  const isToolResult = (
    userText.startsWith('[') ||
    userText.startsWith('<tool_result') ||
    userText.includes('[tool_result]') ||
    userText.includes('tool execution result:') ||
    userText.includes('result:\nthe content was successfully') ||
    messages.some((m) => m.role === 'tool' || !!m.tool_call_id) ||
    (Array.isArray(content) && content.some((b) => b.type === 'tool_result'))
  );

  // Extract explicit instruction type if present: e.g. <explicit_instructions type="init">
  let commandType = null;
  const explicitMatch = userText.match(/<explicit_instructions\s+type=["']([^"']+)["']/i);
  if (explicitMatch) {
    commandType = explicitMatch[1].toLowerCase().trim();
  }

  // Extract task text
  let taskText = '';
  const taskMatch = userText.match(/<task>([\s\S]*?)<\/task>/i);
  if (taskMatch) {
    taskText = taskMatch[1].trim();
  } else {
    taskText = userText
      .replace(/<explicit_instructions[^>]*>[\s\S]*?<\/explicit_instructions>/gi, '')
      .replace(/# TODO LIST RECOMMENDED[\s\S]*/gi, '')
      .trim();
  }

  if (!taskText && commandType) {
    taskText = `/${commandType}`;
  }

  return {
    commandType,
    taskText,
    fullUserText: userText,
    isToolResult,
  };
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
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'close',
      'x-mocked-by': 'PQ-Dashboard-Test-Lab',
    });
  }
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
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'close',
      'x-mocked-by': 'PQ-Dashboard-Test-Lab',
    });
  }
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
      delta: {},
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
  resolvePath = (p) => p,
  onChunk,
  reqBody = null,
  activeScenario = null,
}) {
  const cmd = (command || '').toLowerCase().trim();
  const scenarioKey = activeScenario || cmd.replace(/^\//, '').trim();
  const replayed = await replayLiveStreamIfExists({ res, activeScenario: scenarioKey, reqBody });
  if (replayed) return '';

  if (cmd === '/init' || cmd.startsWith('/init')) {
    const agentsMdContent = `# PostQode Workspace Guidelines\n\n## Project Architecture\n- Architecture: Express REST API & Vite Web Application\n- Target Host: VS Code / VS Code Insiders\n- Proxy Engine: Port 3457\n\n## Coding & Testing Standards\n- Run automated matrix tests via PQ Dashboard\n- Maintain clean sandboxes and full teardown\n`;
    return streamToolCallResponse({
      res,
      toolName: 'write_to_file',
      argsObj: {
        path: 'AGENTS.md',
        absolutePath: resolvePath('AGENTS.md'),
        content: agentsMdContent,
      },
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
    // PostQode condense tool requires params.context
    return streamToolCallResponse({
      res,
      toolName: 'condense',
      argsObj: { context: summaryContext },
      model,
      onChunk,
    });
  }

  if (cmd === '/globalrule' || cmd.startsWith('/globalrule')) {
    const ruleName = param.trim() || 'security-baseline';
    const globalRulePath = require('path').join(require('os').homedir(), '.postqode', 'rules', `${ruleName}.md`);
    const ruleContent = `# Global Rule: ${ruleName}\n\n- Follow organizational security baseline\n- Never commit unencrypted secrets or credentials\n- Enforce strict typing across all modules\n`;
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
      toolName: 'ask_followup_question',
      argsObj: {
        question: "I'd like to help you submit a bug report to PostQode's GitHub repository. Could you describe the issue? Please select an option below or describe what happened:",
        options: JSON.stringify([
          'The new_workflow file creation was denied/failed unexpectedly',
          "It's about something else — let me describe it",
        ]),
      },
      model,
      onChunk,
    });
  }

  if (cmd === '/deep-planning' || cmd.startsWith('/deep-planning')) {
    const responseText = `# Deep Planning: Architecture & Execution Blueprint\n\n## 1. Codebase Investigation\nAnalyzed components and dependencies across workspace.\n\n## 2. Implementation Strategy\n- Step 1: Establish isolated testing sandbox with custom profile.\n- Step 2: Route completions via proxy to validate SSE chunks.\n- Step 3: Capture DOM evidence and verify state persistence.\n\n## 3. Verification Plan\nRun test suite and check Allure assertion report.`;
    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: { result: responseText },
      model,
      onChunk,
    });
  }

  if (cmd === '/explain-changes' || cmd.startsWith('/explain-changes')) {
    const responseText = `### Git Diff Explanation\n\n1. **Scenarios Expansion**: Added dedicated modules for Slash Commands and Workflows.\n2. **UI Controls**: Added quick module dropdown option and navigation tabs.\n3. **Mock Engine**: Added deterministic SSE handlers for zero-token verification.`;
    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: { result: responseText },
      model,
      onChunk,
    });
  }

  // Fallback for custom slash command / workflow
  return streamToolCallResponse({
    res,
    toolName: 'attempt_completion',
    argsObj: { result: `Executed slash command \`${cmd}\` successfully. All pipeline assertions verified.` },
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
    argsObj: { command, requires_approval: 'true' },
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
  return streamToolCallResponse({
    res,
    toolName: 'attempt_completion',
    argsObj: { result: text },
    model,
    onChunk,
  });
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

/**
 * Replay live captured network stream if recorded trace exists on disk.
 */
async function replayLiveStreamIfExists({ res, activeScenario, turnIndex = 0, currentWorkspace = null, reqBody = null }) {
  if (!activeScenario) return false;
  const resolveTargetDir = (name) => {
    const fixtureDir = path.resolve('./server/postqode-test/fixtures/live-recordings', name);
    if (fs.existsSync(fixtureDir)) return fixtureDir;
    return path.resolve('./data/live-recordings', name);
  };
  let targetDir = resolveTargetDir(activeScenario);
  if (!fs.existsSync(targetDir)) {
    const aliases = {
      'file-01': 'agent-tools',
      'agent-tools': 'file-01',
      'init': 'slash-03',
      'slash-03': 'init',
      'newtask': 'slash-01',
      'slash-01': 'newtask',
      'compact': 'slash-02',
      'slash-02': 'compact',
      'newrule': 'slash-04',
      'slash-04': 'newrule',
      'globalrule': 'slash-05',
      'slash-05': 'globalrule',
      'workflow': 'slash-06',
      'slash-06': 'workflow',
      'globalworkflow': 'slash-07',
      'slash-07': 'globalworkflow',
      'reportbug': 'slash-08',
      'slash-08': 'reportbug',
      'deep-planning': 'slash-09',
      'slash-09': 'deep-planning',
      'explain-changes': 'slash-10',
      'slash-10': 'explain-changes',
    };
    if (aliases[activeScenario]) {
      targetDir = resolveTargetDir(aliases[activeScenario]);
    }
  }
  const streamFile = path.join(targetDir, 'network_stream.json');
  if (!fs.existsSync(streamFile)) return false;

  const metaFile = path.join(targetDir, 'meta.json');
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta && meta.activeAsMock === false) return false;
    } catch (e) {}
  }

  try {
    const raw = fs.readFileSync(streamFile, 'utf8');
    const records = JSON.parse(raw);
    if (!Array.isArray(records) || records.length === 0) return false;

    const chatStreams = records.filter((r) =>
      r.url &&
      (r.url.includes('/chat/completions') || r.url.includes('/v1/messages') || r.url.includes('/postqode-provider')) &&
      Array.isArray(r.chunks) && r.chunks.length > 0
    );
    if (chatStreams.length === 0) return false;

    // If reqBody is provided and currentWorkspace is null, extract it dynamically
    if (!currentWorkspace && reqBody) {
      const bodyStr = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
      const m = bodyStr.match(/\/var\/folders\/[^\s"',\\]+\/pq-workspace-[a-zA-Z0-9]+/);
      if (m) currentWorkspace = m[0];
    }

    const rec = chatStreams[turnIndex] || chatStreams[chatStreams.length - 1];
    if (!Array.isArray(rec.chunks) || rec.chunks.length === 0) return false;

    // Detect recorded workspace in stream record
    const recStr = JSON.stringify(rec);
    const recordedWorkspaceMatch = recStr.match(/\/var\/folders\/[^\s"',\\]+\/pq-workspace-[a-zA-Z0-9]+/);
    const recordedWorkspace = recordedWorkspaceMatch ? recordedWorkspaceMatch[0] : null;

    res.writeHead(rec.statusCode || 200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-mocked-by': 'PQ-Live-Replay-Engine',
      'x-recorded-scenario': activeScenario,
    });

    let lastTime = 0;
    for (const c of rec.chunks) {
      const wait = Math.min(Math.max((c.timeMs || 0) - lastTime, 4), 300);
      lastTime = c.timeMs || 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      let chunkData = c.data;
      if (recordedWorkspace && currentWorkspace && recordedWorkspace !== currentWorkspace) {
        chunkData = chunkData.split(recordedWorkspace).join(currentWorkspace);
      }
      res.write(chunkData);
    }
    res.end();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Intelligent stateful mock dispatcher.
 * Inspects reqBody.messages to replicate live model behavior, multi-turn tool loops,
 * and realistic streaming delays matching moonshotai/kimi-k3.
 */
async function dispatchSmartMockResponse({
  res,
  reqBody = {},
  activeScenario = '',
  model = 'moonshotai/kimi-k3',
  onChunk,
}) {
  let bodyObj = reqBody;
  if (typeof reqBody === 'string') {
    try {
      bodyObj = JSON.parse(reqBody);
    } catch (e) {
      bodyObj = {};
    }
  } else if (Buffer.isBuffer(reqBody)) {
    try {
      bodyObj = JSON.parse(reqBody.toString('utf8'));
    } catch (e) {
      bodyObj = {};
    }
  }
  const messages = Array.isArray(bodyObj?.messages) ? bodyObj.messages : [];

  // Check if messages contains prior assistant turn with tool calls
  const hasPriorAssistantToolCall = messages.some(
    (m) =>
      m.role === 'assistant' &&
      ((Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
        (typeof m.content === 'string' && (m.content.includes('<tool_call>') || m.content.includes('[Tool Use:'))))
  );

  const parsed = parsePostQodeUserMessage(messages);
  const { commandType, taskText, fullUserText, isToolResult } = parsed;
  const taskLower = taskText.toLowerCase();
  const fullLower = fullUserText.toLowerCase();
  const prompt = taskText || fullUserText;
  const promptLower = prompt.toLowerCase();

  // Explicit user commands should never be treated as tool output
  const isExplicitUserCommand = (
    !!commandType ||
    fullLower.startsWith('/compact') ||
    fullLower.startsWith('/condense') ||
    fullLower.startsWith('/newtask') ||
    fullLower.startsWith('/init') ||
    fullLower.startsWith('/newrule') ||
    fullLower.startsWith('/workflow') ||
    fullLower.startsWith('/reportbug') ||
    fullLower.startsWith('/globalrule') ||
    fullLower.startsWith('/globalworkflow')
  );

  const isFollowUpTurn = hasPriorAssistantToolCall && isToolResult && !isExplicitUserCommand;
  const priorAssistantTurns = messages.filter((m) => m.role === 'assistant').length;
  const turnIndex = priorAssistantTurns;

  // Extract current active workspace path from request body
  const bodyStr = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody || '');
  const currentWorkspaceMatch = bodyStr.match(/\/var\/folders\/[^\s"',\\]+\/pq-workspace-[a-zA-Z0-9]+/);
  const currentWorkspace = currentWorkspaceMatch ? currentWorkspaceMatch[0] : null;

  // Try replaying live recording if available
  const replayed = await replayLiveStreamIfExists({ res, activeScenario, turnIndex, currentWorkspace });
  if (replayed) return;

  // Emulate realistic live model TTFT (Time To First Token) delay: 280ms
  await new Promise((r) => setTimeout(r, 280));

  if (isFollowUpTurn) {
    // Check if assistant has already called attempt_completion in history
    const hasAttemptCompletionInHistory = messages.some((m) => {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        return m.tool_calls.some((tc) => tc.function?.name === 'attempt_completion');
      }
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return text.includes('attempt_completion');
    });

    if (hasAttemptCompletionInHistory) {
      // Task already completed! End loop immediately with clean finish_reason: 'stop'
      return streamTextResponse({
        res,
        text: '',
        finishReason: 'stop',
        model,
        onChunk,
      });
    }

    // Turn 2+: Tool has completed execution on PostQode side.
    // Stream final completion markdown and finish_reason: 'stop' to end loop!
    let completionText = 'The requested operation has completed successfully.';
    const scenarioLower = (activeScenario || '').toLowerCase();

    if (commandType === 'init' || scenarioLower.includes('slash-03') || taskLower.includes('init') || taskLower.includes('agents.md')) {
      completionText = 'Generated `AGENTS.md` in the workspace root with comprehensive architectural and testing guidelines.';
    } else if (commandType === 'new_rule' || scenarioLower.includes('slash-04') || taskLower.includes('newrule') || taskLower.includes('code-style')) {
      completionText = 'Project rule file `.postqode/rules/code-style.md` has been created and registered successfully.';
    } else if (scenarioLower.includes('slash-05') || taskLower.includes('globalrule') || taskLower.includes('security-baseline')) {
      completionText = 'Global rule file `.postqode/rules/security-baseline.md` has been created and registered successfully.';
    } else if (commandType === 'new_workflow' || scenarioLower.includes('slash-06') || taskLower.includes('workflow') || taskLower.includes('deploy-service')) {
      completionText = 'Workflow file `.postqode/workflows/deploy-service.md` has been created and registered successfully.';
    } else if (scenarioLower.includes('slash-07') || taskLower.includes('globalworkflow') || taskLower.includes('team-review')) {
      completionText = 'Global workflow file `.postqode/workflows/team-review.md` has been created and registered successfully.';
    } else if (commandType === 'report_bug' || scenarioLower.includes('slash-08') || taskLower.includes('reportbug')) {
      completionText = 'Bug report has been submitted and diagnostic information recorded.';
    } else if (scenarioLower.includes('chat-01') || taskLower.includes('hello.py')) {
      completionText = 'I have created `hello.py` which prints `"Hello from PostQode Test Lab"`. You can run it with `python hello.py`.';
    } else if (scenarioLower.includes('file-01') || scenarioLower.includes('agent-tools') || taskLower.includes('result.txt')) {
      completionText = 'Verification file `result.txt` has been created and saved to the workspace root. All assertions are satisfied.';
    } else if (scenarioLower.includes('chat-02') || taskLower.includes('package.json') || taskLower.includes('sample-project')) {
      completionText = '### Project Structure Summary\n- Package: **sample-project** (v1.0.0)\n- File `package.json` verified on disk.\n- Multi-turn loop completed successfully without errors.';
    } else if (scenarioLower.includes('rule-01') || taskLower.includes('helper function') || taskLower.includes('helper.js')) {
      completionText = 'Created `helper.js` adhering to workspace architecture guidelines and coding standards.';
    } else if (scenarioLower.includes('skill-03') || taskLower.includes('custom deployment') || taskLower.includes('custom-deploy')) {
      completionText = 'Custom deployment workflow executed successfully for production release verification.';
    } else if (scenarioLower.includes('chat-04') || taskLower.includes('approval')) {
      return streamToolCallResponse({
        res,
        toolName: 'attempt_completion',
        argsObj: { result: 'Command execution approved and completed successfully with exit code 0.' },
        model,
        onChunk,
      });
    }

    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: { result: completionText },
      model,
      onChunk,
    });
  }

  // Detect workspace directory from system prompt or messages to supply absolutePath
  let workspaceDir = '';
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    const wsMatch = text.match(/\/var\/folders\/[^\s"'<>\n]+/);
    if (wsMatch) {
      const parts = wsMatch[0].split('/');
      const pqWsIdx = parts.findIndex((p) => p.startsWith('pq-workspace-'));
      if (pqWsIdx !== -1) {
        workspaceDir = parts.slice(0, pqWsIdx + 1).join('/');
        break;
      }
    }
  }
  const resolvePath = (rel) => (workspaceDir ? require('path').join(workspaceDir, rel) : rel);

  // Turn 1: Dispatch tool call or initial response based on user intent & scenario
  const scen = (activeScenario || '').toLowerCase();

  // 1. SLASH-03: /init (Always match /init or explicit init command first!)
  if (commandType === 'init' || promptLower.startsWith('/init') || fullLower.startsWith('/init') || (!taskText && scen.includes('slash-03'))) {
    return streamSlashCommandResponse({
      res,
      command: '/init',
      param: taskText.replace(/^\/init\s*/i, '').trim(),
      model,
      resolvePath,
      onChunk,
    });
  }

  // 2. SLASH-01: /newtask
  if (commandType === 'new_task' || promptLower.startsWith('/newtask') || fullLower.startsWith('/newtask')) {
    return streamSlashCommandResponse({
      res,
      command: '/newtask',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 3. SLASH-02: /compact or explicit condense instructions
  if (
    commandType === 'condense' ||
    promptLower.startsWith('/compact') ||
    promptLower.startsWith('/condense') ||
    fullLower.includes('type="condense"') ||
    fullLower.includes('<condense>') ||
    fullLower.includes('/compact') ||
    fullLower.includes('/condense') ||
    (scen.includes('slash-02') && (fullLower.includes('condense') || promptLower.includes('compact')))
  ) {
    return streamSlashCommandResponse({
      res,
      command: '/compact',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 3b. SLASH-02 Seed Turn 1: Keep conversation active so /compact can be executed on an open task
  if (promptLower.includes('inspect the workspace directory structure') || (scen.includes('slash-02') && !isFollowUpTurn)) {
    return streamToolCallResponse({
      res,
      toolName: 'ask_followup_question',
      argsObj: {
        question: 'Workspace inspection complete: found `calculator.js`, `package.json`, and `sample.txt`. Would you like to proceed with testing or summarize context?',
      },
      model,
      onChunk,
    });
  }

  // 4. SLASH-04: /newrule
  if (commandType === 'new_rule' || fullLower.startsWith('/newrule') || scen.includes('slash-04')) {
    const paramMatch = (taskText + ' ' + fullUserText).match(/\/newrule\s+([a-zA-Z0-9_-]+)/);
    return streamSlashCommandResponse({
      res,
      command: '/newrule',
      param: paramMatch ? paramMatch[1] : 'code-style',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 5. SLASH-05: /globalrule
  if (fullLower.startsWith('/globalrule') || scen.includes('slash-05')) {
    const paramMatch = (taskText + ' ' + fullUserText).match(/\/globalrule\s+([a-zA-Z0-9_-]+)/);
    return streamSlashCommandResponse({
      res,
      command: '/globalrule',
      param: paramMatch ? paramMatch[1] : 'security-baseline',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 6. SLASH-06: /workflow
  if (commandType === 'new_workflow' || fullLower.startsWith('/workflow') || scen.includes('slash-06')) {
    const paramMatch = (taskText + ' ' + fullUserText).match(/\/workflow\s+([a-zA-Z0-9_-]+)/);
    return streamSlashCommandResponse({
      res,
      command: '/workflow',
      param: paramMatch ? paramMatch[1] : 'deploy-service',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 7. SLASH-07: /globalworkflow
  if (fullLower.startsWith('/globalworkflow') || scen.includes('slash-07')) {
    const paramMatch = (taskText + ' ' + fullUserText).match(/\/globalworkflow\s+([a-zA-Z0-9_-]+)/);
    return streamSlashCommandResponse({
      res,
      command: '/globalworkflow',
      param: paramMatch ? paramMatch[1] : 'team-review',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 8. SLASH-08: /reportbug
  if (commandType === 'report_bug' || fullLower.startsWith('/reportbug') || scen.includes('slash-08')) {
    return streamSlashCommandResponse({
      res,
      command: '/reportbug',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 9. SLASH-09: /deep-planning
  if (fullLower.startsWith('/deep-planning') || scen.includes('slash-09')) {
    return streamSlashCommandResponse({
      res,
      command: '/deep-planning',
      param: taskText.replace(/^\/deep-planning\s*/i, '').trim(),
      model,
      resolvePath,
      onChunk,
    });
  }

  // 10. SLASH-10: /explain-changes
  if (fullLower.startsWith('/explain-changes') || scen.includes('slash-10')) {
    return streamSlashCommandResponse({
      res,
      command: '/explain-changes',
      model,
      resolvePath,
      onChunk,
    });
  }

  // 11. FLOW-01: Workflow invocation via slash (e.g. /review-pr.md)
  if (scen.includes('flow-01') || fullLower.includes('review-pr.md')) {
    return streamWorkflowStepResponse({
      res,
      stepNumber: 1,
      workflowName: 'review-pr.md',
      model,
      onChunk,
    });
  }

  // 12. FLOW-03: Step 2 of workflow
  if (scen.includes('flow-03') || taskLower.includes('workflow step 2')) {
    return streamWorkflowStepResponse({
      res,
      stepNumber: 2,
      workflowName: 'review-pr.md',
      toolCall: 'ask_followup_question',
      model,
      onChunk,
    });
  }

  // 13. CHAT-01: hello.py
  if (taskLower.includes('hello.py') || scen.includes('chat-01')) {
    return streamToolCallResponse({
      res,
      toolName: 'write_to_file',
      argsObj: {
        path: 'hello.py',
        absolutePath: resolvePath('hello.py'),
        content: 'print("Hello from PostQode Test Lab")\n',
      },
      chunkDelayMs: 20,
      model,
      onChunk,
    });
  }

  // 14. FILE-01 / agent-tools: result.txt
  if (taskLower.includes('result.txt') || scen.includes('file-01') || scen.includes('agent-tools')) {
    return streamToolCallResponse({
      res,
      toolName: 'write_to_file',
      argsObj: {
        path: 'result.txt',
        absolutePath: resolvePath('result.txt'),
        content: `Verified by PostQode Agent Sanity Test.\nExecution Timestamp: ${new Date().toISOString()}\nStatus: PASS\n`,
      },
      chunkDelayMs: 20,
      model,
      onChunk,
    });
  }

  // 15. CHAT-02: read_file package.json
  if (taskLower.includes('inspect package.json') || (taskLower.includes('package.json') && !taskLower.includes('example.js')) || scen.includes('chat-02')) {
    return streamToolCallResponse({
      res,
      toolName: 'read_file',
      argsObj: {
        path: 'package.json',
        absolutePath: resolvePath('package.json'),
      },
      chunkDelayMs: 20,
      model,
      onChunk,
    });
  }

  // 16. CHAT-03: progressive rendering with think tags
  if (taskLower.includes('recursive backtracking') || scen.includes('chat-03')) {
    return streamWithThinkTags({
      res,
      thinkingText: 'Analyzing recursive backtracking algorithm and state-space tree traversal...',
      responseText: 'Recursive backtracking is an algorithmic paradigm that searches incrementally for candidate solutions.',
      model,
      onChunk,
    });
  }

  // 17. CHAT-04: Privileged tool approval
  if (taskLower.includes('approval') || scen.includes('chat-04')) {
    return streamApprovalToolCall({
      res,
      command: "echo 'Testing PostQode Approval Workflow'",
      model,
      onChunk,
    });
  }

  // 18. CHAT-06 & CHAT-07: Parallel tool calling (sequential guard vs parallel batching)
  if (scen.includes('chat-06') || scen.includes('chat-07') || taskLower.includes('example.js')) {
    return streamParallelToolCalls({
      res,
      toolCalls: [
        { name: 'read_file', arguments: { path: 'example.js' } },
        { name: 'read_file', arguments: { path: 'package.json' } },
      ],
      model,
      onChunk,
    });
  }

  // 19. CHAT-08: Mistake response
  if (scen.includes('chat-08') || taskLower.includes('mistake')) {
    return streamMistakeResponse({ res, attemptNumber: 2, model, onChunk });
  }

  // 20. CHAT-11: Background tasks
  if (scen.includes('chat-11') || taskLower.includes('background check')) {
    return streamBackgroundTaskResponse({
      res,
      command: 'echo "Background task completed" && sleep 1',
      model,
      onChunk,
    });
  }

  // 21. RULE-01: Write helper function adhering to guidelines
  if (scen.includes('rule-01') || taskLower.includes('helper function') || taskLower.includes('adhering to project guidelines')) {
    return streamToolCallResponse({
      res,
      toolName: 'write_to_file',
      argsObj: {
        path: 'helper.js',
        absolutePath: resolvePath('helper.js'),
        content: '/**\n * Helper function adhering to project guidelines\n */\nfunction sanitizeInput(input) {\n  return typeof input === "string" ? input.trim() : "";\n}\nmodule.exports = { sanitizeInput };\n',
      },
      chunkDelayMs: 20,
      model,
      onChunk,
    });
  }

  // 22. SKILL-03: Skills execution
  if (scen.includes('skill-03') || taskLower.includes('custom deployment') || taskLower.includes('custom-deploy')) {
    return streamSkillToolCallResponse({
      res,
      skillName: 'custom-deploy',
      model,
      onChunk,
    });
  }

  // 23. Explicit seed prompts
  if (taskLower.includes('analyze calculator.js')) {
    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: { result: 'Analysis complete: `calculator.js` exports an `add(a, b)` function. Workspace structure is nominal.' },
      model,
      onChunk,
    });
  }
  if (taskLower.includes('inspect the workspace')) {
    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: { result: 'Workspace inspection complete: found `calculator.js` and `sample.txt`. Environment ready for tasks.' },
      model,
      onChunk,
    });
  }

  // 24. Raw Slash Commands fallback
  if (prompt.startsWith('/')) {
    const parts = prompt.split(' ');
    const cmd = parts[0];
    const param = parts.slice(1).join(' ');
    return streamSlashCommandResponse({
      res,
      command: cmd,
      param,
      model,
      resolvePath,
      onChunk,
    });
  }

  // Check if session is running in PostQode AGENT MODE
  const isAgentMode = messages.some((m) => {
    const str = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return str.includes('AGENT MODE') || str.includes('agent');
  });

  if (isAgentMode) {
    return streamToolCallResponse({
      res,
      toolName: 'attempt_completion',
      argsObj: {
        result: `Task executed successfully: "${prompt.slice(0, 60)}". All environment assertions verified.`,
      },
      model,
      onChunk,
    });
  }

  // Default Chat Mode: Stream realistic natural conversational text
  return streamTextResponse({
    res,
    text: `PostQode response for task: "${prompt.slice(0, 60)}". Execution verified cleanly.`,
    chunkSize: 10,
    chunkDelayMs: 22,
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
  dispatchSmartMockResponse,
};



