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

export const api = {
  overview:   (p={}) => get('/analytics/overview', p),
  models:     (p={}) => get('/analytics/models', p),
  errors:     (p={}) => get('/analytics/errors', p),
  tools:      (p={}) => get('/analytics/tools', p),
  costs:      (p={}) => get('/analytics/costs', p),
  sequences:  (p={}) => get('/analytics/sequences', p),
  flow:       (p={}) => get('/analytics/flow', p),
  reasoning:  (p={}) => get('/analytics/reasoning', p),
  tasks:      (p={}) => get('/tasks', p),
  task:       (id)   => get(`/tasks/${id}`),
  taskEvents: (id,p={}) => get(`/tasks/${id}/events`, p),
  refresh:    ()     => post('/refresh'),
  config:     ()     => get('/config'),
};
