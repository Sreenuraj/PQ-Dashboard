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

module.exports = {
  buildChunk,
  streamTextResponse,
  streamToolCallResponse,
  streamWithThinkTags,
  streamParallelToolCalls,
};
