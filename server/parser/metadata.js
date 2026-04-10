const fs = require('fs');

function parseMetadata(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const env = data.environment_history?.[0] || {};
    const models = (data.model_usage || []).map(m => ({
      ts: m.ts,
      model_id: m.model_id,
      provider_id: m.model_provider_id,
      mode: m.mode,
    }));
    return {
      models,
      environment: {
        os: `${env.os_name} ${env.os_version}`,
        arch: env.os_arch,
        host: env.host_name,
        host_version: env.host_version,
        pq_version: env.postqode_version,
      },
      files_in_context: (data.files_in_context || []).length,
    };
  } catch {
    return {};
  }
}

function parseFocusChain(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const total = (raw.match(/- \[[ x]\]/g) || []).length;
    const done = (raw.match(/- \[x\]/gi) || []).length;
    return total > 0 ? Math.round((done / total) * 100) : null;
  } catch {
    return null;
  }
}

module.exports = { parseMetadata, parseFocusChain };
