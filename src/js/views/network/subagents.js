import { extractSystemPromptStart, extractAgentLabel } from './helpers.js';

// ── Client-Side Dynamic Subagent Registry ────────────────────────────────
export const clientSubagentRegistry = []; // { index: number, snippet: string }
export const clientDynamicSubagentMap = new Map();
export let clientNextSubagentIndex = 1;

export function registerClientParentPrompts(responseBody) {
  if (!responseBody || typeof responseBody !== 'string' || !responseBody.includes('subagent')) return;
  let fullArgs = '';
  if (responseBody.includes('data: ')) {
    const lines = responseBody.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.arguments) fullArgs += tc.function.arguments;
            }
          }
        } catch {}
      }
    }
  }
  if (!fullArgs) {
    try {
      const resJson = JSON.parse(responseBody);
      const tc = resJson.choices?.[0]?.message?.tool_calls?.find(t => /subagent/i.test(t.function?.name || ''));
      if (tc?.function?.arguments) fullArgs = tc.function.arguments;
    } catch {}
  }
  if (fullArgs) {
    try {
      const parsed = typeof fullArgs === 'object' ? fullArgs : JSON.parse(fullArgs);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim().length > 10) {
          const numMatch = k.match(/\d+/);
          const idx = numMatch ? parseInt(numMatch[0], 10) : clientSubagentRegistry.length + 1;
          const snippet = v.trim().slice(0, 100);
          if (!clientSubagentRegistry.some(p => p.index === idx && p.snippet === snippet)) {
            clientSubagentRegistry.push({ index: idx, snippet });
          }
        }
      }
    } catch {}
  }
}

export function resolveClientSubagentIndex(userPromptText) {
  if (!userPromptText || typeof userPromptText !== 'string') return null;
  const cleanPrompt = userPromptText.trim();
  for (const p of clientSubagentRegistry) {
    if (cleanPrompt.includes(p.snippet) || p.snippet.includes(cleanPrompt.slice(0, 80))) {
      return p.index;
    }
  }
  const taskKey = cleanPrompt.slice(0, 150).replace(/\s+/g, ' ');
  if (!clientDynamicSubagentMap.has(taskKey)) {
    clientDynamicSubagentMap.set(taskKey, clientNextSubagentIndex++);
  }
  return clientDynamicSubagentMap.get(taskKey);
}

export function getAgentLabel(r) {
  if (!r) return null;
  if (r._cachedAgentLabel !== undefined) return r._cachedAgentLabel;

  // 1. If server or record already assigned 'Subagent 1', 'Subagent 2', etc.
  if (r.agentLabel && /^Subagent \d+$/i.test(r.agentLabel)) {
    r._cachedAgentLabel = r.agentLabel;
    return r.agentLabel;
  }
  if (r.subagentIndex) {
    const label = `Subagent ${r.subagentIndex}`;
    r._cachedAgentLabel = label;
    return label;
  }

  let label = null;
  if (r.requestBody) {
    const sysText = extractSystemPromptStart(r.requestBody);
    if (sysText) {
      label = extractAgentLabel(sysText);
    }
  }
  if (!label && r.agentLabel) {
    label = r.agentLabel;
  }

  // 2. If identified as subagent, resolve to dynamic Subagent 1, Subagent 2, etc.
  if (label && /subagent/i.test(label)) {
    let uText = '';
    try {
      const parsed = typeof r.requestBody === 'object' ? r.requestBody : JSON.parse(r.requestBody);
      const uMsg = parsed.messages?.find(m => m.role === 'user');
      if (uMsg) {
        uText = typeof uMsg.content === 'string' ? uMsg.content : (Array.isArray(uMsg.content) ? uMsg.content.map(c => c.text || '').join(' ') : '');
      }
    } catch {}
    const subIdx = resolveClientSubagentIndex(uText);
    if (subIdx) {
      label = `Subagent ${subIdx}`;
    }
  }

  r._cachedAgentLabel = label;
  return label;
}

export function calculateUsageAndCost(r) {
  if (!r.responseBody) return null;

  let reqJson = null;
  let resJson = null;
  
  try { reqJson = JSON.parse(r.requestBody); } catch {}
  try { resJson = JSON.parse(r.responseBody); } catch {}
  
  if (!resJson) return null;

  // Extract model name
  const model = reqJson?.model || resJson?.model || '';
  if (!model) return null;

  // Extract token counts
  let inputTokens = 0;
  let outputTokens = 0;
  
  if (resJson.usage) {
    inputTokens = resJson.usage.prompt_tokens || resJson.usage.input_tokens || 0;
    outputTokens = resJson.usage.completion_tokens || resJson.usage.output_tokens || 0;
  } else if (resJson.usageMetadata) {
    inputTokens = resJson.usageMetadata.promptTokenCount || 0;
    outputTokens = resJson.usageMetadata.candidatesTokenCount || 0;
  }

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) return null;

  // Simple pricing database (Rates per 1M tokens in USD)
  let inputRate = 1.0; // fallback $1.00 / 1M
  let outputRate = 3.0; // fallback $3.00 / 1M
  const m = model.toLowerCase();

  if (m.includes('gpt-4o-mini')) {
    inputRate = 0.15;
    outputRate = 0.60;
  } else if (m.includes('gpt-4o')) {
    inputRate = 5.00;
    outputRate = 15.00;
  } else if (m.includes('o1-mini')) {
    inputRate = 3.00;
    outputRate = 12.00;
  } else if (m.includes('o1-')) {
    inputRate = 15.00;
    outputRate = 60.00;
  } else if (m.includes('gpt-4')) {
    inputRate = 10.00;
    outputRate = 30.00;
  } else if (m.includes('gpt-3.5')) {
    inputRate = 0.50;
    outputRate = 1.50;
  } else if (m.includes('claude-3-5-sonnet') || m.includes('claude-3.5-sonnet')) {
    inputRate = 3.00;
    outputRate = 15.00;
  } else if (m.includes('claude-3-opus')) {
    inputRate = 15.00;
    outputRate = 75.00;
  } else if (m.includes('claude-3-haiku')) {
    inputRate = 0.25;
    outputRate = 1.25;
  } else if (m.includes('gemini-1.5-flash')) {
    inputRate = 0.075;
    outputRate = 0.30;
  } else if (m.includes('gemini-1.5-pro')) {
    inputRate = 1.25;
    outputRate = 5.00;
  } else if (m.includes('deepseek')) {
    inputRate = 0.14;
    outputRate = 0.28;
  }

  const cost = (inputTokens * inputRate / 1000000) + (outputTokens * outputRate / 1000000);

  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    cost
  };
}

export function safeGetStorage(key, fallback = '') {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem(key) || fallback) : fallback;
  } catch {
    return fallback;
  }
}

export function safeSetStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch {}
}
