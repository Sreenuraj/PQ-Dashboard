const { toolEvents } = require('../testing/shared');

function extractPromptChain(events, task) {
  const prompts = [];
  const firstApiTs = events.find(e => e.sub_type === 'api_req_started')?.ts ?? Number.MAX_SAFE_INTEGER;
  const userFeedbackEvents = events.filter(e => e.sub_type === 'user_feedback' && e.content_preview);

  const firstPromptEvent = events.find(e =>
    e.type === 'say' &&
    e.sub_type === 'text' &&
    e.content_preview &&
    (e.ts || 0) <= firstApiTs
  );

  if (firstPromptEvent) {
    prompts.push({
      index: 0,
      text: task.first_message || firstPromptEvent.content_preview,
      ts: firstPromptEvent.ts,
      response_preview: '',
      tools_after: [],
    });
  }

  if (prompts.length === 0 && task.first_message) {
    prompts.push({ index: 0, text: task.first_message, ts: task.start_ts, response_preview: '', tools_after: [] });
  }

  for (const e of userFeedbackEvents) {
    prompts.push({
      index: prompts.length,
      text: e.content_preview,
      ts: e.ts,
      response_preview: '',
      tools_after: [],
    });
  }

  prompts.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  prompts.forEach((p, index) => { p.index = index; });

  for (let i = 0; i < prompts.length; i++) {
    const start = prompts[i].ts || 0;
    const end = prompts[i + 1]?.ts || Number.MAX_SAFE_INTEGER;
    const between = events.filter(e => (e.ts || 0) >= start && (e.ts || 0) < end);
    const response = between.find(e => e.response_text) ||
      between.find(e => e.type === 'say' && e.sub_type === 'text' && e.content_preview && e.content_preview !== prompts[i].text);
    prompts[i].response_preview = (response?.response_text || response?.content_preview || '').substring(0, 300);
    prompts[i].tools_after = toolEvents(between).map(e => e.tool_name);
  }

  return prompts;
}

module.exports = { extractPromptChain };
