/** Loads the same dynamic model catalogs the server uses (extension cache files + live OpenRouter list). */
const { loadModelRegistry, fetchLiveOpenRouterModels } = require('../server/model-registry');
const { loadConfig } = require('../server/config');

async function bootRegistry({ live = true } = {}) {
  const cfg = loadConfig();
  loadModelRegistry(cfg.sources);
  if (live) { try { await fetchLiveOpenRouterModels(); } catch { /* offline: local catalogs only */ } }
}
module.exports = { bootRegistry };
