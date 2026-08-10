const API = '/api';

export async function get(path, params = {}) {
  const cleaned = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== 'undefined' && v !== 'null') {
      cleaned[k] = v;
    }
  });
  const qs = new URLSearchParams(cleaned).toString();
  const url = `${API}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  const bodyText = await res.text();
  let body = null;

  if (contentType.includes('application/json') && bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`Invalid JSON from ${url}`);
    }
  }

  if (!res.ok) {
    throw new Error(body?.error || `API error ${res.status}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON from ${url}, got ${contentType || 'unknown content type'}`);
  }

  return body;
}

export async function post(path, body = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function put(path, body = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function del(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  overview:      (p={}) => get('/analytics/overview', p),
  models:        (p={}) => get('/analytics/models', p),
  errors:        (p={}) => get('/analytics/errors', p),
  tools:         (p={}) => get('/analytics/tools', p),
  costs:         (p={}) => get('/analytics/costs', p),
  sequences:     (p={}) => get('/analytics/sequences', p),
  flow:          (p={}) => get('/analytics/flow', p),
  reasoning:     (p={}) => get('/analytics/reasoning', p),
  activity:      (p={}) => get('/analytics/activity', p),
  shellCommands: (p={}) => get('/analytics/shell-commands', p),
  activityDaily: (p={}) => get('/analytics/activity/daily', p),
  // Phase 4: agent-aware analytics
  agents:        (p={}) => get('/analytics/agents', p),
  agentMatrix:   (p={}) => get('/analytics/agent-matrix', p),
  metricDefs:    ()     => get('/analytics/metric-defs'),
  tasks:         (p={}) => get('/tasks', p),
  task:          (id)   => get(`/tasks/${id}`),
  taskEvents:    (id,p={}) => get(`/tasks/${id}/events`, p),
  evaluate:      (id)   => get(`/tasks/${id}/evaluate`),
  testTask:      (id,p={}) => get(`/tasks/${id}/test`, p),
  testPattern:   (id,pattern,p={}) => get(`/tasks/${id}/test/${pattern}`, p),
  compareDeep:   (body) => post('/tasks/compare', body),
  baselines:     (p={}) => get('/baselines', p),
  baseline:      (id)   => get(`/baselines/${id}`),
  createBaseline:(body) => post('/baselines', body),
  updateBaseline:(id,body) => put(`/baselines/${id}`, body),
  deleteBaseline:(id)   => del(`/baselines/${id}`),
  baselinePrompts:(id)  => get(`/baselines/${id}/prompts`),
  reextractBaseline:(id)=> post(`/baselines/${id}/re-extract`),
  enrichBaseline:(id,body) => post(`/baselines/${id}/enrich`, body),
  mergeEnrichment:(id,body) => put(`/baselines/${id}/merge`, body),
  rateTestResult:(id,body) => put(`/test-results/${id}/rate`, body),
  getTestRules:  ()     => get('/test-rules'),
  updateTestRules:(body)=> put('/test-rules', body),
  toolsRegistry: ()     => get('/tools/registry'),
  refresh:       ()     => post('/refresh'),
  config:        ()     => get('/config'),
  // Network Inspector
  networkStatus:   ()     => get('/network/status'),
  networkRequests: (p={}) => get('/network/requests', p),
  networkRequest:  (id)   => get(`/network/requests/${id}`),
  networkClear:    ()     => post('/network/clear'),
  networkReplay:   (id)   => post(`/network/replay/${id}`),
  networkMocks:    ()     => get('/network/mocks'),
  networkSaveMock: (body) => post('/network/mocks', body),
  networkDeleteMock:(id)  => del(`/network/mocks/${id}`),
  // Intercept / Breakpoints
  networkIntercept:       () => get('/network/intercept'),
  networkSetIntercept:    (body) => put('/network/intercept', body),
  networkInterceptForward:(id, body) => post(`/network/intercept/${id}/forward`, body),
  networkInterceptDrop:   (id) => post(`/network/intercept/${id}/drop`),
  networkInterceptForwardAll: () => post('/network/intercept/forward-all'),
  // Prompt Analytics
  promptAnalytics:     (taskId) => get(`/prompt-analytics/${taskId}`),
  promptMessages:      (taskId, from, to) => get(`/prompt-analytics/${taskId}/messages`, { from, to }),
  promptRequest:       (taskId, call) => get(`/prompt-analytics/${taskId}/prompt`, { call }),
  promptCompare:       (taskId, call1, call2, mode) => get(`/prompt-analytics/${taskId}/compare`, { call1, call2, mode }),
};

// Phase 4: cached metric defs (fetched once per page-load; consumed by MetricTooltip)
let _metricDefsCache = null;
export async function getMetricDefs() {
  if (_metricDefsCache) return _metricDefsCache;
  _metricDefsCache = await api.metricDefs();
  return _metricDefsCache;
}
