/**
 * Rate calibration: find the per-1M-token rates that reproduce the cost the extension LOGGED for a model
 * within one task, so cost components and the "excess cost" of a cache miss are exact instead of guessed.
 *
 * Why: provider prices change over time and catalogs only know today's price (a cache-read price that was cut
 * mid-month would make every older task look mispriced), and some models are in no catalog at all.
 *
 * For each model in a task, in order:
 *   1. 'catalog'   - the catalog profile reproduces >=99% of the logged costs      -> use the catalog profile
 *   2. 'fitted'    - least-squares rates reproduce the logged costs                  -> catalog profile with the fitted
 *                    rates laid over it (a price the task never exercised, e.g. the 1h write rate when only 5m writes
 *                    occurred, still comes from the catalog)
 *   3. 'unmodeled' - neither reproduces the logs (provider-specific billing)         -> keep logged cost only
 */
const { getProfile, priceWithProfile, ratesAt } = require('./cache-pricing');

const TOL_ABS = 5e-6;
const TOL_REL = 1e-4;

function withinTol(calc, logged) {
  const err = Math.abs(calc - logged);
  return err <= TOL_ABS || err <= TOL_REL * Math.max(Math.abs(logged), 1e-9);
}

/** Solves min ||A x - y|| via normal equations with column scaling; null if rank deficient. */
function solveLeastSquares(A, y) {
  const n = A.length;
  const k = n ? A[0].length : 0;
  if (!k || n < k + 1) return null;
  const scale = new Array(k).fill(0);
  for (const row of A) for (let j = 0; j < k; j++) scale[j] = Math.max(scale[j], Math.abs(row[j]));
  if (scale.some((s) => s === 0)) return null;
  const M = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < k; i++) {
      const ai = A[r][i] / scale[i];
      M[i][k] += ai * y[r];
      for (let j = 0; j < k; j++) M[i][j] += ai * (A[r][j] / scale[j]);
    }
  }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[k] / row[i] / scale[i]);
}

const COLS = [
  { key: 'input', get: (c) => c.tokensIn || 0 },
  { key: 'output', get: (c) => c.tokensOut || 0 },
  { key: 'cacheWrite5m', get: (c) => (c.cacheWrites || 0) - Math.min(c.cacheWrites1h || 0, c.cacheWrites || 0) },
  { key: 'cacheWrite1h', get: (c) => Math.min(c.cacheWrites1h || 0, c.cacheWrites || 0) },
  { key: 'cacheRead', get: (c) => c.cacheReads || 0 },
];

function fitRates(calls) {
  const usable = calls.filter((c) => typeof c.cost === 'number');
  const active = COLS.filter((col) => usable.some((c) => col.get(c) > 0));
  if (!active.length) return null;
  const x = solveLeastSquares(usable.map((c) => active.map((col) => col.get(c))), usable.map((c) => c.cost));
  if (!x) return null;
  const rates = {};
  active.forEach((col, i) => { rates[col.key] = x[i] * 1e6; });
  if (Object.values(rates).some((v) => v < -1e-6)) return null; // negative price = overfit
  for (const k of Object.keys(rates)) rates[k] = Math.max(0, Math.round(rates[k] * 1e6) / 1e6);
  let ok = 0;
  for (const c of usable) {
    const calc = COLS.reduce((s, col) => s + (rates[col.key] || 0) * col.get(c) / 1e6, 0);
    if (withinTol(calc, c.cost)) ok++;
  }
  return { rates, reproduced: ok, total: usable.length };
}

function reproduction(profile, calls) {
  let ok = 0;
  for (const c of calls) {
    const p = priceWithProfile(profile, c);
    if (p && withinTol(p.cost.total, c.cost)) ok++;
  }
  return ok;
}

/**
 * @returns {{source:'catalog'|'fitted'|'unmodeled', profile:object|null, rates:object|null, reproduced:number, total:number, catalogKey:string|null}}
 *   `profile` is what the engine prices with (null when unmodeled).
 */
function calibrateModel(modelId, calls) {
  const usable = calls.filter((c) => typeof c.cost === 'number' && c.cost > 0);
  const catalogProfile = getProfile(modelId);
  const total = usable.length;
  const catalogKey = catalogProfile ? catalogProfile.key : null;
  if (!total) return { source: catalogProfile ? 'catalog' : 'unmodeled', profile: catalogProfile, rates: null, reproduced: 0, total: 0, catalogKey };

  if (catalogProfile) {
    const ok = reproduction(catalogProfile, usable);
    if (ok / total >= 0.99) return { source: 'catalog', profile: catalogProfile, rates: null, reproduced: ok, total, catalogKey };
  }
  const fit = fitRates(usable);
  if (fit && fit.reproduced / fit.total >= 0.99) {
    const base = catalogProfile ? catalogProfile.base : { input: null, output: null, cacheWrite5m: null, cacheWrite1h: null, cacheRead: null };
    const merged = { ...base };
    for (const [k, v] of Object.entries(fit.rates)) merged[k] = v;
    const profile = {
      key: catalogKey, source: 'fitted', supportsPromptCache: catalogProfile ? catalogProfile.supportsPromptCache : (merged.cacheRead || 0) > 0 || (merged.cacheWrite5m || 0) > 0,
      explicitCacheWrites: (merged.cacheWrite5m || 0) > 0 || (merged.cacheWrite1h || 0) > 0, base: merged, tiers: [], // a flat fit supersedes tiers
    };
    return { source: 'fitted', profile, rates: fit.rates, reproduced: fit.reproduced, total: fit.total, catalogKey };
  }
  return { source: 'unmodeled', profile: null, rates: null, reproduced: fit ? fit.reproduced : 0, total, catalogKey };
}

module.exports = { calibrateModel, fitRates, solveLeastSquares, withinTol, ratesAt };