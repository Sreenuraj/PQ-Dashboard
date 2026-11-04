/**
 * Joins proxy fingerprints to a task's API calls.
 *
 * Timestamps drift (the proxy sees the request when it is sent; the task log stamps it earlier and the stored
 * `ts` of a fingerprint is the response time), so the reliable join key is the usage the provider reported:
 *     task call  :  tokensIn + cacheWrites + cacheReads        == fingerprint.promptTokens
 *                   cacheWrites                                 == fingerprint.cacheWriteTokens   (when reported)
 * plus the same model and a generous time window. Ties are resolved in time order (each fingerprint used once).
 */
const WINDOW_MS = 15 * 60 * 1000;

const baseModel = (id) => String(id || '').toLowerCase().replace(/^[a-z0-9_.-]+\//, '').replace(/\./g, '-');

/**
 * @param {Array} calls  task calls ({ts, modelId, tokensIn, cacheWrites, cacheReads})
 * @param {Array} fps    candidate fingerprints (any order)
 * @returns {Array<object|null>} fingerprint per call index (null when unmatched)
 */
function matchFingerprintsToCalls(calls, fps) {
  const sorted = [...fps].sort((a, b) => a.capturedTs - b.capturedTs);
  const used = new Set();
  return calls.map((c) => {
    const total = (c.tokensIn || 0) + (c.cacheWrites || 0) + (c.cacheReads || 0);
    let best = null;
    let bestDrift = Infinity;
    for (const fp of sorted) {
      if (used.has(fp)) continue;
      if (fp.promptTokens == null || fp.promptTokens !== total) continue;
      if (fp.cacheWriteTokens != null && fp.cacheWriteTokens !== (c.cacheWrites || 0)) continue;
      if (c.modelId && fp.model && baseModel(c.modelId) !== baseModel(fp.model)) continue;
      const drift = Math.abs(fp.capturedTs - c.ts);
      if (drift > WINDOW_MS) continue;
      if (drift < bestDrift) { best = fp; bestDrift = drift; }
    }
    if (best) used.add(best);
    return best;
  });
}

module.exports = { matchFingerprintsToCalls };