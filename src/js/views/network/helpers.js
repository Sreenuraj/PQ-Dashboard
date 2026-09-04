export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function methodClass(m) {
  const map = { GET: 'green', POST: 'blue', PUT: 'yellow', PATCH: 'yellow', DELETE: 'red', OPTIONS: 'grey', HEAD: 'grey' };
  return map[(m || '').toUpperCase()] || 'grey';
}

export function statusClass(code) {
  if (!code || code === 0) return 'red';
  if (code < 300) return 'green';
  if (code < 400) return 'blue';
  if (code < 500) return 'yellow';
  return 'red';
}

export function tagLabel(tag) {
  const labels = {
    postqode: 'PostQode',
    openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', cohere: 'Cohere',
    mistral: 'Mistral', groq: 'Groq', deepseek: 'DeepSeek', together: 'Together',
    fireworks: 'Fireworks', github: 'GitHub', copilot: 'Copilot', other: 'Other',
  };
  return labels[tag] || tag || 'Other';
}

export function tagColorClass(tag) {
  const map = {
    postqode: 'accent',
    openai: 'green', anthropic: 'purple', google: 'blue', cohere: 'cyan',
    mistral: 'yellow', groq: 'accent', copilot: 'cyan', github: 'grey',
  };
  return map[tag] || 'grey';
}

export function prettyJson(str) {
  if (!str) return '';
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

export function syntaxHighlight(json) {
  if (!json) return '';
  if (json.length > 60000) {
    return escHtml(json);
  }
  return escHtml(json)
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "(.*?)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

export function getByteLength(str) {
  if (!str) return 0;
  if (typeof str !== 'string') return 0;
  try {
    return (new TextEncoder().encode(str)).length;
  } catch {
    return str.length;
  }
}

export function truncateUrl(url, maxLen = 80) {
  if (!url) return '';
  let clean = url.replace(/^https?:\/\//, '');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '…';
}

export function getEndpointTail(url, maxLen = 32) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const search = u.search ? (u.search.length > 10 ? '?...' : u.search) : '';
    const fullTarget = pathname + search;

    if (fullTarget.length <= maxLen) return fullTarget;

    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length) return u.host;

    if (segments.length <= 2) {
      const short = '/' + segments.join('/') + search;
      return short.length <= maxLen ? short : '…' + short.slice(-(maxLen - 1));
    }

    let accumulated = '';
    for (let i = segments.length - 1; i >= 0; i--) {
      const candidate = '/' + segments.slice(i).join('/') + (accumulated === '' ? search : '');
      if (candidate.length > maxLen - 2) {
        if (accumulated) return '…' + accumulated;
        return '…' + candidate.slice(-(maxLen - 2));
      }
      accumulated = candidate;
    }
    return '…' + accumulated;
  } catch {
    return url.length > maxLen ? '…' + url.slice(-(maxLen - 1)) : url;
  }
}

export function getParsedOrRawBody(bodyStr) {
  if (!bodyStr) return null;
  try {
    return JSON.parse(bodyStr);
  } catch {
    return bodyStr;
  }
}

export function generateCurl(r) {
  let cmd = `curl -X ${r.method} "${r.url}"`;
  
  if (r.requestHeaders) {
    Object.entries(r.requestHeaders).forEach(([name, val]) => {
      const safeVal = String(val).replace(/"/g, '\\"');
      cmd += ` \\\n  -H "${name}: ${safeVal}"`;
    });
  }
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    let bodyData = typeof parsed === 'object' ? JSON.stringify(parsed) : parsed;
    const safeBody = String(bodyData).replace(/"/g, '\\"');
    cmd += ` \\\n  -d "${safeBody}"`;
  }
  
  return cmd;
}

export function generateNodeFetch(r) {
  const headers = { ...r.requestHeaders };
  delete headers['host'];
  delete headers['connection'];
  delete headers['content-length'];
  delete headers['accept-encoding'];

  let code = `const response = await fetch("${r.url}", {\n`;
  code += `  method: "${r.method}",\n`;
  code += `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`;
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    const bodyStr = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : `\`${parsed}\``;
    code += `,\n  body: ${bodyStr.replace(/\n/g, '\n  ')}`;
  }
  code += `\n});\nconst data = await response.json();\nconsole.log(data);`;
  return code;
}

export function generateBrowserFetch(r) {
  const headers = { ...r.requestHeaders };
  delete headers['host'];
  delete headers['connection'];
  
  let code = `fetch("${r.url}", {\n`;
  code += `  method: "${r.method}",\n`;
  code += `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`;
  
  if (r.requestBody && r.method !== 'GET' && r.method !== 'HEAD') {
    let parsed = getParsedOrRawBody(r.requestBody);
    const bodyStr = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : `\`${parsed}\``;
    code += `,\n  body: ${bodyStr.replace(/\n/g, '\n  ')}`;
  }
  code += `\n})\n.then(res => res.json())\n.then(data => console.log(data));`;
  return code;
}

export function sortObjectKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted = {};
  Object.keys(obj).sort().forEach(k => {
    sorted[k] = sortObjectKeys(obj[k]);
  });
  return sorted;
}

export function getPrettified(val) {
  if (!val) return '';
  try {
    const obj = JSON.parse(val);
    return JSON.stringify(obj, null, 2);
  } catch {
    return val;
  }
}

export function diffLines(lines1, lines2) {
  const n = lines1.length;
  const m = lines2.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n;
  let j = m;
  const diff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      diff.unshift({ type: 'unchanged', left: lines1[i - 1], right: lines2[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'added', left: null, right: lines2[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'removed', left: lines1[i - 1], right: null });
      i--;
    }
  }
  return diff;
}

export function extractSystemPromptStart(bodyStr) {
  if (!bodyStr || typeof bodyStr !== 'string') return null;
  try {
    const parsed = JSON.parse(bodyStr);
    if (Array.isArray(parsed.messages) && parsed.messages[0]?.role === 'system') {
      const c = parsed.messages[0].content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        return c.map(b => (typeof b === 'string' ? b : (b?.text || ''))).join('\n');
      }
    }
    if (typeof parsed.system === 'string') return parsed.system;
    if (Array.isArray(parsed.system)) {
      return parsed.system.map(b => (typeof b === 'string' ? b : (b?.text || ''))).join('\n');
    }
  } catch (e) {
    const m = bodyStr.match(/"role"\s*:\s*"system"[\s\S]*?"content"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|\[\s*\{\s*"(?:type"\s*:\s*"text"\s*,\s*"text|"text)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)")/i);
    if (m) {
      const raw = m[1] || m[2];
      try { return JSON.parse('"' + raw + '"'); } catch { return raw; }
    }
    const mSys = bodyStr.match(/"system"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)")/i);
    if (mSys) {
      try { return JSON.parse('"' + mSys[1] + '"'); } catch { return mSys[1]; }
    }
    const mYouAre = bodyStr.match(/"(You are [^"\r\n\\]+)/i);
    if (mYouAre) {
      return mYouAre[1];
    }
  }
  return null;
}

export function extractAgentLabel(systemText) {
  if (!systemText || typeof systemText !== 'string') return null;

  let cleanText = systemText.trim();
  const identityMatch = cleanText.match(/<identity>([\s\S]*?)<\/identity>/i);
  if (identityMatch) {
    cleanText = identityMatch[1].trim();
  }

  const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const firstLine = lines[0].replace(/^[#*_\s-]+/, '').replace(/[*_]+$/, '').trim();

  // 1. PostQode Subagent check (MUST be on the first line / identity)
  if (/^you are (?:the )?postqode subagent\b/i.test(firstLine) || /^postqode subagent\b/i.test(firstLine)) {
    return 'PostQode Subagent';
  }

  // 2. Generic Subagent declared on the first line
  if (/^you are (?:an? )?(?:autonomous )?(?:specialized )?([a-z0-9_-]+\s+subagent|subagent)\b/i.test(firstLine)) {
    const m = firstLine.match(/^you are (?:an? )?(?:autonomous )?(?:specialized )?([a-z0-9_-]+\s+subagent|subagent)\b/i);
    return m ? m[1].replace(/\b\w/g, c => c.toUpperCase()) : 'Subagent';
  }

  // 3. PostQode Main Agent check (MUST be at the start of the first line)
  if (/^you are postqode\b/i.test(firstLine) || /^postqode\b/i.test(firstLine)) {
    return 'PostQode';
  }

  // 4. Explicit Role/Agent/Identity keywords on line 1
  const roleMatch = firstLine.match(/^(?:role|agent|identity|system|persona|name):\s*([^,.\n]+)/i);
  if (roleMatch) {
    return roleMatch[1].trim();
  }

  // 5. 'You are [Name], a/an...' on line 1
  const youAreMatch = firstLine.match(/^you are (?:an? )?([^,.]+)/i);
  if (youAreMatch) {
    const raw = youAreMatch[1].trim();
    if (/^helpful (?:ai )?assistant/i.test(raw)) return 'Assistant';
    if (/^autonomous specialized ai worker/i.test(raw)) return 'Subagent';
    if (raw && !/^(?:ai|model|llm|large language model)\b/i.test(raw) && raw.length < 35) {
      return raw.replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  return null;
}
