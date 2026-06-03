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
// 20 visually-distinct colors. Disjoint from AGENT_COLORS above so the first
// ~30 agents never collide. If you ever have more than ~30 distinct agents in
// a single view, the pigeonhole principle forces collisions again — bump
// this list, or use the distinct-color API below for places that need it.
const AGENT_PALETTE = [
  // Saturated accents (10 — same family as AGENT_COLORS but reordered to
  // cover 20 distinct hues; original 10 are kept above as hardcoded picks)
  '#5B9EF5', '#F5C85B', '#7B9EF5', '#5BF58C', '#F55BE0',
  '#5BF5E0', '#F5A05B', '#E05BF5', '#F55B5B', '#CCCCCC',
  // Cooler secondaries (10)
  '#9B5BF5', '#F55B9B', '#5BC8F5', '#B9F55B', '#F58C5B',
  '#5B5BF5', '#F5F55B', '#5BF5C8', '#C85BF5', '#88E0C8',
];
function hashStr(s) {
  let h = 0;
  for (let i = 0; s[i]; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function agentColor(agent) {
  if (!agent) return '#666';
  return AGENT_COLORS[agent] || AGENT_PALETTE[hashStr(agent) % AGENT_PALETTE.length];
}

/**
 * Assign collision-free colors to a list of agent names.
 *
 * Why this exists: agentColor() is stable (same name → same color) but the
 * underlying palette only has 20 slots, so two different unknown agents
 * CAN get the same color. That's fine when each agent is shown alone
 * (chip next to a model, timeline band), but when a view lists many agents
 * side-by-side (Overview filter chips, Errors "By Agent" tab, Activity
 * matrix) a collision is visually bad.
 *
 * This function takes the *full set* of agents a view is about to show
 * and returns a Map<name, color> with no duplicates. Strategy:
 *   1. Hardcoded agents get their AGENT_COLORS entry (preferred brand color).
 *   2. Remaining palette slots are assigned to unknown agents in their
 *      hash order — but we walk the hash to find a free slot, so the
 *      result is still deterministic for the same input set.
 *   3. If we run out of palette slots (>20 distinct agents with the same
 *      hardcoded set), the function appends derived shades and reuses
 *      AGENT_COLORS slots only as a last resort (preserves hardcoded wins).
 *
 * @param {string[]} agentNames — full set of agent names shown together
 * @returns {Map<string, string>} — name → hex color
 */
export function agentColorsDistinct(agentNames) {
  const result = new Map();
  const usedHex = new Set();
  const palette = [...AGENT_PALETTE];

  // Phase 1: hardcoded wins (and mark those hexes as used)
  for (const name of agentNames) {
    if (AGENT_COLORS[name]) {
      result.set(name, AGENT_COLORS[name]);
      usedHex.add(AGENT_COLORS[name].toUpperCase());
    }
  }

  // Phase 2: assign distinct palette slots to remaining agents in hash order
  const remaining = agentNames.filter(n => !result.has(n));
  // Sort by hash so the *order* in the view is what determines the slot —
  // but we only need a stable assignment per (set, name), not per render.
  remaining.sort((a, b) => hashStr(a) - hashStr(b));
  for (const name of remaining) {
    let slot = hashStr(name) % palette.length;
    let attempts = 0;
    // Find the first free palette slot starting from this hash.
    while (usedHex.has(palette[slot].toUpperCase()) && attempts < palette.length) {
      slot = (slot + 1) % palette.length;
      attempts++;
    }
    if (attempts < palette.length) {
      result.set(name, palette[slot]);
      usedHex.add(palette[slot].toUpperCase());
    } else {
      // Palette exhausted: derive a shifted hue from a base palette entry.
      // Deterministic per name, never collides with usedHex by construction.
      const base = palette[hashStr(name) % palette.length];
      result.set(name, deriveShade(base, name));
    }
  }
  return result;
}

/** Deterministically shift the lightness of a hex color by a name-derived amount. */
function deriveShade(hex, name) {
  const { r, g, b } = parseHex(hex);
  // -25..+25% lightness shift, name-derived
  const shift = (hashStr(name) % 51) - 25;
  const adj = (c) => Math.max(0, Math.min(255, Math.round(c + (255 - c) * (shift / 100) * 0.4)));
  return rgbToHex(adj(r), adj(g), adj(b));
}
function parseHex(h) {
  const v = h.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
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
