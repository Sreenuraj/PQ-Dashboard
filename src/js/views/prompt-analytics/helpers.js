// ── Prompt Analytics Helpers ──

export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function fmtTokens(n) {
  if (!n || n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1000000).toFixed(2) + 'M';
}

export function fmtCost(cost) {
  if (!cost) return '$0.00';
  if (cost < 0.01) return '$' + cost.toFixed(4);
  return '$' + cost.toFixed(3);
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min === 0) return `${remSec}s`;
  return `${min}m ${remSec}s`;
}

export function fmtDelta(bytes) {
  if (bytes === 0) return '<span class="pa-delta-zero" title="No size change from previous call">±0</span>';
  if (bytes > 0) return `<span class="pa-delta-up" title="Request size expanded by ${fmtBytes(bytes)}">▲ +${fmtBytes(bytes)}</span>`;
  return `<span class="pa-delta-down" title="Request size reduced by ${fmtBytes(Math.abs(bytes))}">▼ ${fmtBytes(Math.abs(bytes))}</span>`;
}
