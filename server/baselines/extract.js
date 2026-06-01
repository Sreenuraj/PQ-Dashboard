const { extractPromptChain } = require('./prompts');
const { toolEvents, parseToolTarget, getFinalOutput } = require('../testing/shared');

function extractBenchmarkSet(task, events) {
  const tools = toolEvents(events);
  const expectedTools = [...new Set(tools.map(e => e.tool_name))];
  const finalOutput = getFinalOutput(events);

  return {
    baseline_id: task.id,
    prompts: extractPromptChain(events, task),
    expected_tools: expectedTools,
    tool_sequence: tools.map((e, index) => ({
      index,
      tool_name: e.tool_name,
      file_path: parseToolTarget(e),
      command: e.command_text || commandFromPreview(e),
    })),
    behavior_contract: {
      has_code_block: /```/.test(finalOutput),
      output_keywords: topKeywords(finalOutput, 8),
      output_min_length: Math.max(20, Math.floor(finalOutput.length * 0.6)),
      output_max_length: Math.max(200, Math.ceil(finalOutput.length * 1.6)),
      forbidden_phrases: [],
    },
    reference_metrics: {
      cost: task.total_cost || 0,
      tokens_in: task.total_tokens_in || 0,
      tokens_out: task.total_tokens_out || 0,
      cache_reads: task.total_cache_reads || 0,
      duration: task.duration || 0,
      api_calls: task.api_call_count || 0,
      tool_calls: task.tool_call_count || tools.length,
      error_count: task.error_count || 0,
      has_context_reset: !!task.has_context_reset,
    },
  };
}

function commandFromPreview(event) {
  const text = event.content_preview || '';
  return text.includes('→') ? text.split('→').slice(1).join('→').trim() || null : null;
}

function topKeywords(text, limit) {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'have', 'will', 'are', 'was', 'were', 'you', 'not']);
  const counts = new Map();
  String(text || '').toLowerCase().match(/[a-z][a-z0-9_]{3,}/g)?.forEach(word => {
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

module.exports = { extractBenchmarkSet };
