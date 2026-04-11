const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Model Registry — merges openrouter_models.json + vercel_ai_gateway_models.json
 * from all enabled source cache directories into a single in-memory lookup map.
 */

let registry = {};  // { modelId → { contextWindow, maxTokens, inputPrice, outputPrice, ... } }

/**
 * Load model registry from all enabled sources.
 * Each source path points to .../tasks — the cache dir is path/../cache/
 */
function loadModelRegistry(sources) {
  registry = {};
  let loaded = 0;

  for (const source of (sources || [])) {
    if (!source.enabled) continue;

    const resolvedPath = source.resolvedPath || source.path.replace(/^~/, os.homedir());
    // Source path is .../tasks → cache is at .../cache/
    const cacheDir = path.join(path.dirname(resolvedPath), 'cache');

    // Load OpenRouter models first (more complete data, takes priority)
    const orPath = path.join(cacheDir, 'openrouter_models.json');
    loaded += loadModelFile(orPath, 'openrouter');

    // Load Vercel AI Gateway models (fills gaps)
    const vercelPath = path.join(cacheDir, 'vercel_ai_gateway_models.json');
    loaded += loadModelFile(vercelPath, 'vercel');
  }

  console.log(`[model-registry] Loaded ${Object.keys(registry).length} unique models from ${loaded} files`);
  return registry;
}

/**
 * Load a single model cache file and merge into registry.
 * OpenRouter data takes priority (richer metadata).
 */
function loadModelFile(filePath, source) {
  if (!fs.existsSync(filePath)) return 0;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const models = JSON.parse(raw);

    for (const [modelId, info] of Object.entries(models)) {
      // Normalize: strip :free suffix for lookup
      const normalizedId = modelId.replace(/:free$/, '');

      // Only overwrite if not already present (OpenRouter loads first = priority)
      if (!registry[normalizedId]) {
        registry[normalizedId] = {
          contextWindow: info.contextWindow || null,
          maxTokens: info.maxTokens || null,
          inputPrice: info.inputPrice || null,
          outputPrice: info.outputPrice || null,
          supportsImages: info.supportsImages || false,
          supportsPromptCache: info.supportsPromptCache || false,
          source,
        };
      }

      // Also store with the original key (including :free) for exact lookups
      if (modelId !== normalizedId && !registry[modelId]) {
        registry[modelId] = registry[normalizedId];
      }
    }

    return 1;
  } catch (e) {
    console.warn(`[model-registry] Failed to load ${filePath}: ${e.message}`);
    return 0;
  }
}

/**
 * Get model info by ID. Tries exact match first, then normalized (without :free).
 */
function getModelInfo(modelId) {
  if (!modelId) return null;
  return registry[modelId] || registry[modelId.replace(/:free$/, '')] || null;
}

/**
 * Get the full registry map.
 */
function getAllModels() {
  return registry;
}

module.exports = { loadModelRegistry, getModelInfo, getAllModels };
