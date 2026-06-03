export function fmtCost(n) {
  if (n == null || isNaN(n)) return '$0.00';
  if (n < 0.001) return '<$0.001';
  return '$' + n.toFixed(n < 0.1 ? 4 : 2);
}

export function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtMs(ms) {
  if (!ms) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms/1000).toFixed(1)}s`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 4: Agent context helpers
//
// The DB stores the agent as `mode`; the UI displays it as "Agent".
// These helpers centralize:
//   • Color assignment (stable per agent name across all views)
//   • Chip rendering (clickable when needed, e.g. for filter links)
//   • Chain formatting (collapse consecutive same-agent phases, with badge)
// ─────────────────────────────────────────────────────────────────────────

/** Stable color per agent. Hash fallback for unknown agents. */
export const AGENT_COLORS = {
  'web_agent':           '#5B9EF5',
  'agent':               '#F5C85B',
  'plan':                '#7B9EF5',
  'mobile_agent':        '#5BF58C',
  'api_agent':           '#F55BE0',
  'web-automation-pro':  '#5BF5E0',
  'web-performance-pro': '#F5A05B',
  'api-performance-pro': '#E05BF5',
  'act':                 '#F55B5B',
  'code-reviewer':       '#CCCCCC',
};
const AGENT_PALETTE = [
  '#5B9EF5', '#F5C85B', '#7B9EF5', '#5BF58C', '#F55BE0',
  '#5BF5E0', '#F5A05B', '#E05BF5', '#F55B5B', '#CCCCCC',
];
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function agentColor(agent) {
  if (!agent) return '#666';
  return AGENT_COLORS[agent] || AGENT_PALETTE[hashStr(agent) % AGENT_PALETTE.length];
}

/**
 * Format an agent_sequence (from `agent_sequence_json`) for display.
 * Adjacent same-agent phases are collapsed to a single chip with an
 * optional "×N" badge to indicate re-entries. Returns "—" for empty.
 *
 * @param {Array<{agent:string}>} sequence
 * @param {{ max?: number }} [opts]
 */
export function fmtAgentChain(sequence, opts = {}) {
  if (!sequence?.length) return '—';
  const { max = 3 } = opts;
  // Collapse consecutive same-agent phases
  const collapsed = [];
  for (const s of sequence) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.agent === s.agent) last.phase_count = (last.phase_count || 1) + 1;
    else collapsed.push({ agent: s.agent, phase_count: 1 });
  }
  const shown = collapsed.slice(0, max).map(c =>
    c.phase_count > 1 ? `${c.agent} ×${c.phase_count}` : c.agent
  );
  const overflow = collapsed.length - shown.length;
  return shown.join(' → ') + (overflow > 0 ? ` +${overflow}` : '');
}

/**
 * Render a single agent as a colored chip. Clickable by default; pass
 * `clickable: false` for read-only contexts (e.g. the deep-compare header).
 */
export function agentChip(agent, opts = {}) {
  const { clickable = true, size = 10, href } = opts;
  if (!agent) return '';
  const color = agentColor(agent);
  const cursor = clickable ? 'cursor:pointer' : 'default';
  const target = href || `#/sessions?agent=${encodeURIComponent(agent)}`;
  const handler = clickable
    ? `onclick="event.stopPropagation();window.location.hash='${target}'"`
    : '';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}55;font-size:${size}px;${cursor}" title="${escHtml(agent)}" ${handler}>${escHtml(agent)}</span>`;
}

/** Render a list of agent_sequence phases as chips (max N, then +k). */
export function agentChainChips(sequence, opts = {}) {
  if (!sequence?.length) return '<span class="text-dim" style="font-size:10px">—</span>';
  const { max = 3, clickable = true } = opts;
  const html = sequence.slice(0, max).map(s => agentChip(s.agent, { clickable })).join('');
  const overflow = sequence.length - max;
  const overflowHtml = overflow > 0
    ? `<span class="text-dim" style="font-size:10px;margin-left:2px">+${overflow}</span>`
    : '';
  return html + overflowHtml;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
