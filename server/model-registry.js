const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Model Registry — merges openrouter_models.json + vercel_ai_gateway_models.json
 * from all enabled source cache directories into a single in-memory lookup map.
 *
 * Resolution strategy (getModelInfo):
 *  1. Exact key match
 *  2. Strip :free suffix
 *  3. Strip ~ routing prefix
 *  4. Strip ~ and :free combined
 *  5. Bare name without provider (e.g. "kimi-k2.6") — scan by model-name portion
 *  6. Fuzzy substring fallback
 *
 * After loading all entries, for each base model ID we promote the variant with
 * the LARGEST context window as the canonical entry. This ensures
 * "anthropic/claude-sonnet-4.5" resolves to 1M (the :1m variant's window) rather
 * than 200K (the stale default routing alias entry), since PostQode now defaults
 * to 1M context without requiring the :1m suffix.
 */

let registry = {};    // { modelId -> info } — after promotion
let rawEntries = {};  // { modelId -> info } — as-is from files, before promotion

function loadModelRegistry(sources) {
  registry = {};
  rawEntries = {};
  let loaded = 0;

  for (const source of (sources || [])) {
    if (!source.enabled) continue;
    const resolvedPath = source.resolvedPath || source.path.replace(/^~/, os.homedir());
    const cacheDir = path.join(path.dirname(resolvedPath), 'cache');
    loaded += loadModelFile(path.join(cacheDir, 'openrouter_models.json'), 'openrouter');
    loaded += loadModelFile(path.join(cacheDir, 'vercel_ai_gateway_models.json'), 'vercel');
  }

  promoteMaxContextVariants();
  console.log(`[model-registry] Loaded ${Object.keys(registry).length} unique models from ${loaded} files`);
  return registry;
}

/**
 * For each base model ID (stripped of variant suffixes like :1m, :extended, :batch),
 * promote the LARGEST contextWindow found across any source or variant alias.
 * Ensures "anthropic/claude-sonnet-4.5" gets 1,000,000 context window even if
 * a file initially listed it with 200,000 context window under a routing alias.
 */
function promoteMaxContextVariants() {
  const VARIANT_RE = /:(1m|2m|extended|thinking|batch|free|nitro|floor|\d+k)$/i;

  for (const [key, info] of Object.entries(rawEntries)) {
    const cw = info.contextWindow || 0;
    if (cw <= 0) continue;

    const baseId = key.replace(VARIANT_RE, '');

    // Promote max context window to base model entry
    if (registry[baseId]) {
      if ((registry[baseId].contextWindow || 0) < cw) {
        registry[baseId].contextWindow = cw;
        registry[baseId].promotedFrom = key;
      }
    } else {
      registry[baseId] = { ...info, contextWindow: cw, promotedFrom: key };
    }

    // Promote max context window to exact variant key if present
    if (registry[key]) {
      if ((registry[key].contextWindow || 0) < cw) {
        registry[key].contextWindow = cw;
      }
    }
  }
}

function loadModelFile(filePath, source) {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const models = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const [modelId, info] of Object.entries(models)) {
      const entry = {
        contextWindow: info.contextWindow || null,
        maxTokens: info.maxTokens || null,
        inputPrice: info.inputPrice || null,
        outputPrice: info.outputPrice || null,
        cacheReadsPrice: info.cacheReadsPrice || null,
        cacheWritesPrice: info.cacheWritesPrice || null,
        supportsImages: info.supportsImages || false,
        supportsPromptCache: info.supportsPromptCache || false,
        source,
      };

      rawEntries[modelId] = entry;
      const normalizedId = modelId.replace(/:free$/, '');

      // Store or update with max contextWindow if already present
      if (!registry[normalizedId]) {
        registry[normalizedId] = { ...entry };
      } else if (entry.contextWindow && (!registry[normalizedId].contextWindow || entry.contextWindow > registry[normalizedId].contextWindow)) {
        registry[normalizedId].contextWindow = entry.contextWindow;
      }

      if (modelId !== normalizedId) {
        if (!registry[modelId]) {
          registry[modelId] = { ...entry };
        } else if (entry.contextWindow && (!registry[modelId].contextWindow || entry.contextWindow > registry[modelId].contextWindow)) {
          registry[modelId].contextWindow = entry.contextWindow;
        }
      }
    }
    return 1;
  } catch (e) {
    console.warn(`[model-registry] Failed to load ${filePath}: ${e.message}`);
    return 0;
  }
}

/**
 * Multi-step model ID resolution:
 *  1. Exact key
 *  2. Strip :free
 *  3. Strip ~ prefix
 *  4. Strip ~ and :free
 *  5. Bare model name (no provider slash) — match by name portion
 *  6. Fuzzy substring
 */
function getModelInfo(modelId) {
  if (!modelId) return null;

  // 1. Exact
  if (registry[modelId]) return registry[modelId];

  // 2. Strip :free
  const noFree = modelId.replace(/:free$/, '');
  if (noFree !== modelId && registry[noFree]) return registry[noFree];

  // 3. Strip ~ routing prefix
  const noTilde = modelId.replace(/^~/, '');
  if (noTilde !== modelId && registry[noTilde]) return registry[noTilde];

  // 4. Strip ~ + :free
  const clean = noTilde.replace(/:free$/, '');
  if (clean !== noTilde && registry[clean]) return registry[clean];

  // 5. Bare name without provider prefix (e.g. "kimi-k2.6", "gpt-5.4")
  if (!clean.includes('/')) {
    const nameLower = clean.toLowerCase();
    for (const [key, info] of Object.entries(registry)) {
      const keyName = (key.includes('/') ? key.split('/').slice(1).join('/') : key)
        .replace(/:free$/, '').toLowerCase();
      if (keyName === nameLower) return info;
    }
  }

  // 6. Fuzzy substring
  const cleanLower = clean.toLowerCase();
  for (const [key, info] of Object.entries(registry)) {
    const keyLower = key.replace(/^~/, '').toLowerCase();
    if (keyLower.includes(cleanLower) || cleanLower.includes(keyLower)) return info;
  }

  return null;
}

function getAllModels() {
  return registry;
}

module.exports = { loadModelRegistry, getModelInfo, getAllModels };
