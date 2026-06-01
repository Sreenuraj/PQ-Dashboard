const API = '/api';

export async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
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
  getTestRules:  ()     => get('/test-rules'),
  updateTestRules:(body)=> put('/test-rules', body),
  toolsRegistry: ()     => get('/tools/registry'),
  refresh:       ()     => post('/refresh'),
  config:        ()     => get('/config'),
};
