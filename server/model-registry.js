const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

/**
 * Model Registry — merges openrouter_models.json + vercel_ai_gateway_models.json
 * from all enabled source cache directories into a single in-memory lookup map.
 * Also fetches live models from OpenRouter API to always maintain the latest
 * specs and context windows for new models (e.g. Gemini 3.7 Flash, Claude 3.7, DeepSeek V4).
 */

let registry = {};    // { modelId -> info } — after promotion
let rawEntries = {};  // { modelId -> info } — as-is from files, before promotion
let lastFetchTs = 0;
let isFetchingLive = false;

function loadModelRegistry(sources) {
  registry = {};
  rawEntries = {};
  let loaded = 0;

  // 1. Load local cache files from enabled sources
  for (const source of (sources || [])) {
    if (!source.enabled) continue;
    const resolvedPath = source.resolvedPath || source.path.replace(/^~/, os.homedir());
    const cacheDir = path.join(path.dirname(resolvedPath), 'cache');
    loaded += loadModelFile(path.join(cacheDir, 'openrouter_models.json'), 'openrouter');
    loaded += loadModelFile(path.join(cacheDir, 'vercel_ai_gateway_models.json'), 'vercel');
  }

  // 2. Load locally cached live OpenRouter models if present
  const liveLocalPath = path.join(process.cwd(), 'data', 'openrouter_models_live.json');
  if (fs.existsSync(liveLocalPath)) {
    loaded += loadModelFile(liveLocalPath, 'openrouter-live');
  }

  promoteMaxContextVariants();
  console.log(`[model-registry] Loaded ${Object.keys(registry).length} unique models from ${loaded} files`);

  // 3. Trigger asynchronous live refresh in background
  fetchLiveOpenRouterModels().catch(() => {});

  return registry;
}

/**
 * Fetch live model catalog from OpenRouter API to support newly released models immediately.
 */
function fetchLiveOpenRouterModels() {
  const now = Date.now();
  if (isFetchingLive || (now - lastFetchTs < 30 * 60 * 1000 && Object.keys(registry).length > 100)) {
    return Promise.resolve(registry);
  }

  isFetchingLive = true;
  return new Promise((resolve) => {
    const req = https.get('https://openrouter.ai/api/v1/models', {
      headers: { 'User-Agent': 'PQ-Dashboard/1.0' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode !== 200) {
        isFetchingLive = false;
        return resolve(registry);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        isFetchingLive = false;
        lastFetchTs = Date.now();
        try {
          const json = JSON.parse(data);
          if (json && Array.isArray(json.data)) {
            const mapped = {};
            for (const m of json.data) {
              if (!m.id) continue;
              const inputPrice = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1000000 : null;
              const outputPrice = m.pricing?.completion ? parseFloat(m.pricing.completion) * 1000000 : null;
              const cacheReadsPrice = m.pricing?.input_cache_read ? parseFloat(m.pricing.input_cache_read) * 1000000 : null;
              const cacheWritesPrice = m.pricing?.input_cache_write ? parseFloat(m.pricing.input_cache_write) * 1000000 : null;

              mapped[m.id] = {
                contextWindow: m.context_length || null,
                maxTokens: m.top_provider?.max_completion_tokens || null,
                inputPrice,
                outputPrice,
                cacheReadsPrice,
                cacheWritesPrice,
                supportsImages: m.architecture?.modality?.includes('image') || false,
                supportsPromptCache: !!(cacheReadsPrice || cacheWritesPrice),
                description: m.description || '',
              };
            }

            // Save to local data folder for offline persistence
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(path.join(dataDir, 'openrouter_models_live.json'), JSON.stringify(mapped, null, 2), 'utf8');

            // Ingest into in-memory registry
            for (const [id, info] of Object.entries(mapped)) {
              rawEntries[id] = info;
              if (!registry[id] || (info.contextWindow && info.contextWindow > (registry[id].contextWindow || 0))) {
                registry[id] = { ...info, source: 'openrouter-live' };
              }
            }
            promoteMaxContextVariants();
            console.log(`[model-registry] Successfully refreshed ${Object.keys(mapped).length} live models from OpenRouter API`);
          }
        } catch (e) {
          console.warn('[model-registry] Live models parse error:', e.message);
        }
        resolve(registry);
      });
    });

    req.on('error', (err) => {
      isFetchingLive = false;
      console.warn('[model-registry] Live models network fetch skipped:', err.message);
      resolve(registry);
    });

    req.on('timeout', () => {
      req.destroy();
      isFetchingLive = false;
      resolve(registry);
    });
  });
}

/**
 * For each base model ID (stripped of variant suffixes like :1m, :extended, :batch),
 * promote the LARGEST contextWindow found across any source or variant alias.
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
 * Intelligent Fallback for standard AI frontier models when offline or unindexed.
 */
function inferModelFallback(modelId) {
  if (!modelId) return null;
  const m = modelId.toLowerCase();

  // Gemini models (1M to 2M tokens)
  if (m.includes('gemini-3.7') || m.includes('gemini-3.6') || m.includes('gemini-3.5') || m.includes('gemini-2.5') || m.includes('gemini-flash') || m.includes('gemini-pro')) {
    const isPro = m.includes('pro');
    return {
      contextWindow: 1048576, // 1M tokens
      maxTokens: 65536,
      inputPrice: isPro ? 1.25 : 0.375,
      outputPrice: isPro ? 10.0 : 1.875,
      cacheReadsPrice: isPro ? 0.125 : 0.09375,
      cacheWritesPrice: isPro ? 0.375 : 0,
      supportsImages: true,
      supportsPromptCache: true,
      source: 'inferred-gemini',
    };
  }

  // Claude models (200K or 1M tokens)
  if (m.includes('claude-3-7') || m.includes('claude-3.7') || m.includes('claude-3-5') || m.includes('claude-sonnet') || m.includes('claude-opus')) {
    const is1M = m.includes('1m') || m.includes('extended');
    return {
      contextWindow: is1M ? 1000000 : 200000,
      maxTokens: 64000,
      inputPrice: 3.0,
      outputPrice: 15.0,
      cacheReadsPrice: 0.30,
      cacheWritesPrice: 3.75,
      supportsImages: true,
      supportsPromptCache: true,
      source: 'inferred-claude',
    };
  }

  // DeepSeek models (64K or 128K tokens)
  if (m.includes('deepseek')) {
    return {
      contextWindow: 131072,
      maxTokens: 8192,
      inputPrice: 0.14,
      outputPrice: 0.28,
      cacheReadsPrice: 0.014,
      cacheWritesPrice: 0.14,
      supportsImages: false,
      supportsPromptCache: true,
      source: 'inferred-deepseek',
    };
  }

  // OpenAI GPT-4o / GPT-4.5 / o1 / o3
  if (m.includes('gpt-4') || m.includes('o1') || m.includes('o3') || m.includes('chatgpt')) {
    return {
      contextWindow: 128000,
      maxTokens: 16384,
      inputPrice: 2.5,
      outputPrice: 10.0,
      cacheReadsPrice: 1.25,
      cacheWritesPrice: 0,
      supportsImages: true,
      supportsPromptCache: true,
      source: 'inferred-openai',
    };
  }

  // Moonshot Kimi
  if (m.includes('kimi')) {
    return {
      contextWindow: 262144,
      maxTokens: 8192,
      inputPrice: 0.6,
      outputPrice: 2.4,
      cacheReadsPrice: 0.15,
      cacheWritesPrice: 0,
      supportsImages: false,
      supportsPromptCache: true,
      source: 'inferred-kimi',
    };
  }

  // GLM
  if (m.includes('glm')) {
    return {
      contextWindow: 131072,
      maxTokens: 4096,
      inputPrice: 0.5,
      outputPrice: 1.0,
      cacheReadsPrice: 0.1,
      cacheWritesPrice: 0,
      supportsImages: false,
      supportsPromptCache: true,
      source: 'inferred-glm',
    };
  }

  return null;
}

/**
 * Multi-step model ID resolution:
 *  1. Exact key match
 *  2. Strip provider prefix (e.g. "postqode:google/gemini-3.7-flash" -> "google/gemini-3.7-flash")
 *  3. Strip :free suffix
 *  4. Strip ~ routing prefix
 *  5. Strip ~ and :free
 *  6. Bare name without provider prefix (e.g. "gemini-3.7-flash", "kimi-k2.6")
 *  7. Fuzzy substring matching
 *  8. Intelligent fallback inference
 */
function getModelInfo(modelId) {
  if (!modelId) return null;

  // Clean custom wrapper prefixes like "postqode:"
  let cleanId = modelId.replace(/^postqode:/i, '');

  // 1. Exact
  if (registry[cleanId]) return registry[cleanId];

  // 2. Strip :free
  const noFree = cleanId.replace(/:free$/, '');
  if (noFree !== cleanId && registry[noFree]) return registry[noFree];

  // 3. Strip ~ routing prefix
  const noTilde = cleanId.replace(/^~/, '');
  if (noTilde !== cleanId && registry[noTilde]) return registry[noTilde];

  // 4. Strip ~ + :free
  const clean = noTilde.replace(/:free$/, '');
  if (clean !== noTilde && registry[clean]) return registry[clean];

  // 5. Bare name without provider prefix (e.g. "gemini-3.7-flash", "kimi-k2.6", "gpt-5.4")
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

  // 7. Fallback to model family inference
  const inferred = inferModelFallback(cleanId);
  if (inferred) {
    // Cache inferred entry so future lookups are instant
    registry[cleanId] = inferred;
    // Trigger background refresh in case OpenRouter has updated specs
    fetchLiveOpenRouterModels().catch(() => {});
    return inferred;
  }

  return null;
}

function getAllModels() {
  return registry;
}

module.exports = { loadModelRegistry, getModelInfo, getAllModels, fetchLiveOpenRouterModels };
