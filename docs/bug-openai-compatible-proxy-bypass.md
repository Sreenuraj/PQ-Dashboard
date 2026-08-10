# Bug — OpenAI-Compatible provider bypasses VSCode HTTP proxy (Network Inspector cannot capture)

**Status:** Open
**Filed:** 2026-06-25
**Component:** PostQode VSCode extension — API provider HTTP client (OpenAI-Compatible path)
**Severity:** Medium — breaks Network Inspector for any non-PostQode provider; users cannot inspect / debug / mock LLM calls when using OpenAI-compatible endpoints (Azure OpenAI, OpenRouter, self-hosted, Ollama, LM Studio, etc.)

---

## Summary

When the PostQode VSCode extension is configured with the **OpenAI Compatible** API provider, the LLM HTTP requests do **not** flow through VSCode's configured `http.proxy`. As a result, the PQ Dashboard's Network Inspector (MITM proxy on `127.0.0.1:3457`) cannot see, capture, mock, or intercept those requests.

The **PostQode** API provider works correctly — its requests are captured. So this is provider-specific to the OpenAI-Compatible code path, not a general proxy configuration problem.

---

## Expected vs Actual

| | Expected | Actual |
|---|---|---|
| API Provider = PostQode | Captured in Network Inspector | ✅ Captured |
| API Provider = OpenAI Compatible | Captured in Network Inspector | ❌ Not captured |
| Other VSCode traffic (telemetry, marketplace, copilot, extensions) | Routed through proxy when configured | ✅ Routed through proxy |

The expectation is reasonable: VSCode's `http.proxy` setting is the standard, documented way to route HTTP/HTTPS traffic through an MITM proxy. PostQode itself honours it. Other extensions and VSCode itself honour it. Only the OpenAI-Compatible provider does not.

---

## Reproduction Steps

1. Start the PQ Dashboard (`./start.sh`) — proxy listens on `http://127.0.0.1:3457`.
2. Trust the dashboard's CA cert system-wide via Keychain (or use `NODE_EXTRA_CA_CERTS` at launch). Other captures already work, so this is verified working.
3. Open VSCode Insiders with the following `settings.json`:
   ```json
   {
     "http.proxy": "http://localhost:3457",
     "http.proxyStrictSSL": false,
     "http.noProxy": [
       "localhost",
       "127.0.0.1",
       "us.i.posthog.com",
       "mobile.events.data.microsoft.com",
       "main.vscode-cdn.net"
     ]
   }
   ```
4. Open the PostQode extension. In Settings → Model:
   - API Provider: **OpenAI Compatible**
   - Base URL: `https://pq-postqode-resource.services.ai.azure.com/openai/v1`
   - API key: (valid)
   - Model ID: `gpt-5.4`
5. Open the PQ Dashboard → Network Inspector. Click the **All** chip.
6. In VSCode, send a chat message through the OpenAI-Compatible provider.

**Expected:** The chat completion HTTP request appears as a new row in the Network Inspector.

**Actual:** No row appears. Other VSCode traffic continues to be captured normally during the same window, confirming the proxy is alive and working.

7. Switch the API Provider back to **PostQode** in the extension. Send another chat message.

**Result:** The PostQode chat completion request is captured immediately. This confirms VSCode's `http.proxy` setting *is* being honoured by VSCode itself — the OpenAI-Compatible code path inside the extension just doesn't use it.

---

## What we tried (all failed to fix capture)

| # | Attempt | Outcome |
|---|---|---|
| 1 | Verified `settings.json` has `http.proxy: http://localhost:3457`, `http.proxyStrictSSL: false`, and Azure host is **not** in `http.noProxy`. | ✅ Settings correct. Still not captured. |
| 2 | Verified the dashboard MITM cert for `pq-postqode-resource.services.ai.azure.com` exists at `data/proxy-certs/certs/pq-postqode-resource.services.ai.azure.com.pem` — so MITM TLS for that host would succeed. | ✅ Cert present. Still not captured. |
| 3 | Confirmed other VSCode traffic (PostQode provider, telemetry, marketplace) is being captured by the inspector during the same session. | ✅ Confirms proxy is alive and reachable. Other traffic flows. |
| 4 | Fully quit VSCode Insiders (Cmd+Q) and relaunched from terminal with proxy env vars to force the SDK to read them: <pre>HTTPS_PROXY=http://127.0.0.1:3457 \\<br>HTTP_PROXY=http://127.0.0.1:3457 \\<br>NO_PROXY=localhost,127.0.0.1,... \\<br>NODE_EXTRA_CA_CERTS="/Users/sreenuraj/PQ-Dashboard/data/proxy-certs/certs/ca.pem" \\<br>code-insiders</pre> | ❌ Still not captured. This is the key signal — see Root Cause below. |
| 5 | Reviewed the dashboard proxy source (`server/proxy/index.js`) to rule out provider-side filtering. The proxy captures **every** host that reaches it; unknown hosts get tagged `other` but are still stored and broadcast. Provider/host filtering is purely a frontend UI concern. | ✅ Dashboard is not filtering. Confirms the request never reaches the proxy. |

---

## Root Cause (high confidence)

The OpenAI-Compatible provider inside the extension uses an HTTP client that ignores **both**:
- VSCode's `http.proxy` workspace setting
- Standard `HTTPS_PROXY` / `HTTP_PROXY` environment variables

The most likely culprit is the **OpenAI Node SDK v4+**, which uses the platform's native `fetch` (Node 18+'s `undici`). Native `fetch` in Node does **not** read `HTTPS_PROXY` env vars and is **not** affected by Node's global `https.Agent`. Proxies must be wired in explicitly via an `undici` `Dispatcher` (e.g. `ProxyAgent`) passed in through a custom `fetch` function.

Because the extension does not pass a custom `fetch`/`dispatcher` to the OpenAI client for the OpenAI-Compatible provider, the SDK opens a direct TLS connection to the target host and bypasses the MITM proxy entirely. Nothing reaches `127.0.0.1:3457`, so nothing can be captured.

The PostQode provider works because that code path uses a different HTTP client (or explicitly wires the proxy in) that *does* honour the VSCode proxy setting.

---

## Suggested Fix (extension-side)

The fix has to land in the PostQode extension. Pseudocode using `undici` (built into Node 18+, no new dependency for an Electron-based VSCode runtime):

```ts
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import OpenAI from 'openai';
import * as vscode from 'vscode';

function getProxyDispatcher(): ProxyAgent | undefined {
  const httpCfg = vscode.workspace.getConfiguration('http');
  const proxy = httpCfg.get<string>('proxy')
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY;
  if (!proxy) return undefined;

  const strictSSL = httpCfg.get<boolean>('proxyStrictSSL') ?? true;
  return new ProxyAgent({
    uri: proxy,
    requestTls: { rejectUnauthorized: strictSSL },
  });
}

const dispatcher = getProxyDispatcher();

const client = new OpenAI({
  baseURL: cfg.baseURL,
  apiKey: cfg.apiKey,
  fetch: dispatcher
    ? ((input, init) => undiciFetch(input, { ...init, dispatcher } as any)) as any
    : undefined,
});
```

Notes:
- This must be applied to **every** non-PostQode provider that uses the OpenAI SDK (OpenAI, OpenAI-Compatible, Azure, OpenRouter, Together, Fireworks, Groq, DeepSeek, Mistral, etc.). Likely a single helper that all providers share.
- Anthropic SDK has a similar story — verify whether the Anthropic provider also bypasses the proxy.
- Respect `http.noProxy` if possible (skip the dispatcher when the target host matches).

---

## Workaround for users (none reliable)

There is no purely user-side workaround. `HTTPS_PROXY` env var does not work (attempt #4 above). Network Inspector simply will not capture OpenAI-Compatible / non-PostQode traffic until the extension is fixed.

The only practical workaround today is to use the **PostQode** API provider when you need Network Inspector visibility.

---

## Dashboard-side follow-ups (separate, smaller tickets)

These don't fix the bug, but improve UX when the bug *is* fixed and the traffic starts flowing:

- Add Azure OpenAI hosts (`*.openai.azure.com`, `*.services.ai.azure.com`) and common OpenAI-compatible hosts (`openrouter.ai`, `api.together.xyz`, `api.fireworks.ai`, `api.groq.com`, `api.deepseek.com`, `api.mistral.ai`) to `DOMAIN_TAGS` in `server/proxy/index.js` so captured requests get a meaningful tag instead of `other`.
- Add a note to the Network Inspector setup card explaining that some provider SDKs may bypass `http.proxy` and that this is a known extension-side limitation for non-PostQode providers.

---

## Environment

- **OS:** macOS Tahoe
- **VSCode:** Insiders build
- **PQ Dashboard:** workspace `/Users/sreenuraj/PQ-Dashboard`, commit `8b52dd48`
- **Proxy:** `http://127.0.0.1:3457`, MITM via `http-mitm-proxy`
- **Dashboard proxy file under review:** `server/proxy/index.js`
- **CA cert location:** `/Users/sreenuraj/PQ-Dashboard/data/proxy-certs/certs/ca.pem`

---

## Owner / Next Action

- Hand this to the **PostQode VSCode extension team** to wire `ProxyAgent` into the OpenAI-Compatible provider's HTTP client.
- Verify fix by re-running the reproduction steps above and confirming the request appears in the Network Inspector.
