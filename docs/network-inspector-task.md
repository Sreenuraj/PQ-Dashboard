# Network Inspector — Task Tracker

> **Branch:** `feature/request-breakpoints`  
> **Status:** ✅ Implementation Complete — Ready for Testing  
> **Created:** 2026-06-17  
> **Updated:** 2026-06-18 — Added Request Breakpoints feature

---

## Overview

Added a "Network Inspector" tab to the PQ Dashboard under the **Testing** section. This page allows users to capture and inspect live HTTP/HTTPS network traffic originating from VS Code extensions (PostQode) by running a built-in MITM proxy alongside the dashboard server.

---

## Files Created

| File | Purpose |
|------|---------|
| `server/proxy/index.js` | MITM proxy server — intercepts HTTP/HTTPS, tags by AI provider, stores + broadcasts |
| `server/proxy/store.js` | In-memory circular buffer (500 max, FIFO eviction) with filtering |
| `server/proxy/ws.js` | WebSocket server for real-time streaming to dashboard |
| `server/routes/network.js` | REST API — status, paginated requests, detail, clear, HAR export |
| `src/js/views/network.js` | Frontend view — setup guide, toolbar, request table, detail panel |

## Files Modified

| File | Changes |
|------|---------|
| `server/index.js` | Wired proxy, WebSocket, and network routes |
| `src/js/app.js` | Added `network` route |
| `src/js/api.js` | Added `networkStatus`, `networkRequests`, `networkRequest`, `networkClear` |
| `src/index.html` | Added 📡 Network nav item in sidebar |
| `src/css/index.css` | Added ~480 lines of Network Inspector styles |
| `vite.config.js` | Added `/ws/network` WebSocket proxy |
| `pq-config.yaml` | Added `proxy:` config section |
| `start.sh` | Added proxy port to startup output |
| `package.json` | Added `http-mitm-proxy`, `ws` dependencies |
| `README.md` | Added Network Inspector docs, API reference, troubleshooting |

---

## How to Test

### 1. Start the Dashboard

```bash
./start.sh
# Or manually:
npm start          # Backend on :3456, proxy on :3457
npm run dev        # Frontend on :5173
```

### 2. Configure VS Code

Add to your VS Code `settings.json`:

```json
{
  "http.proxy": "http://localhost:3457",
  "http.proxyStrictSSL": false,
  "http.noProxy": [
    "localhost",
    "127.0.0.1"
  ]
}
```

Because many extensions (and VS Code login services) run in separate processes that ignore strict SSL configurations, proxying authentication traffic can cause SSL handshake errors (alert 46) or log you out.

To resolve this, choose one of these options:

- **Option A (Bypass Auth Proxying - Easiest but selective)**: Add `"api.postqode.ai"` to your `"http.noProxy"` array in VS Code settings. This lets VS Code connect to PostQode's servers directly for login and heartbeats.
  > [!IMPORTANT]
  > If you configure the **'PostQode'** API Provider to route AI calls in VS Code (instead of direct OpenAI/Anthropic keys), bypassing `"api.postqode.ai"` will prevent the proxy from capturing those requests. If so, use Option B instead.

- **Option B (Recommended / Trust Certificate System-Wide)**: Add the proxy's self-signed CA cert to your system's trust store to trust it globally for all processes:
  - **macOS (Terminal)**:
    ```bash
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "<workspace-path>/data/proxy-certs/certs/ca.pem"
    ```
    *(Or double-click the `ca.pem` file at `data/proxy-certs/certs/ca.pem` to open in Keychain Access, double-click the cert, expand **Trust**, and select **Always Trust**).*
  - **Windows (Admin PowerShell)**:
    ```powershell
    Import-Certificate -FilePath "<workspace-path>\data\proxy-certs\certs\ca.pem" -CertStoreLocation Cert:\LocalMachine\Root
    ```
- **Option C (Launch with Node Trust)**: Launch VS Code from terminal instructing Node.js to trust the certificate path:
  - **macOS**:
    ```bash
    NODE_EXTRA_CA_CERTS="<workspace-path>/data/proxy-certs/certs/ca.pem" code
    ```
  - **Windows (PowerShell)**:
    ```powershell
    $env:NODE_EXTRA_CA_CERTS="<workspace-path>\data\proxy-certs\certs\ca.pem"; code
    ```
- **Option D (Launch with Node Bypass)**: Launch VS Code from terminal with validation bypassed:
  - **macOS**:
    ```bash
    NODE_TLS_REJECT_UNAUTHORIZED=0 code
    ```
  - **Windows (PowerShell)**:
    ```powershell
    $env:NODE_TLS_REJECT_UNAUTHORIZED=0; code
    ```
- **Option E (Extension Developers)**: If debugging the extension in VS Code, add this to your `.vscode/launch.json`:
  ```json
  "env": {
    "NODE_TLS_REJECT_UNAUTHORIZED": "0"
  }
  ```

### 3. Open Network Tab

Navigate to `http://localhost:5173/#/network` — you should see:
- ✅ Setup instructions panel with copy-paste config
- ✅ Toolbar with Record/Pause/Clear/Export controls
- ✅ Domain filter chips (All, OpenAI, Anthropic, Google, etc.)
- ✅ Request table (will populate as PostQode makes API calls)
- ✅ Status indicator (green dot when WebSocket is connected)

### 4. Verify Live Capture

Use PostQode in VS Code → requests should appear in real-time in the table. Click any row to see headers, request body, response body, and timing.

### 5. Quick Smoke Test (no VS Code needed)

```bash
# Route a request through the proxy
curl -x http://localhost:3457 http://httpbin.org/get

# Check it was captured
curl http://localhost:3456/api/network/requests | head

# Check proxy status
curl http://localhost:3456/api/network/status
```

### 6. Verify Latest Enhancements

- **PostQode Domain Tag:** Verify the "PostQode" domain filter chip is present and filters for `api.postqode.ai` requests.
- **Payload Decompression:** Verify that request and response bodies (specifically from `api.postqode.ai` or other gzip-compressed APIs) are shown as readable JSON text instead of gibberish.
- **Row Limits & Scrolling:** Click the row limit dropdown in the toolbar. Change it to `Last 5` and verify the table only displays the 5 most recent requests. Change it to `All` and verify that scrollbars appear if the list overflows, with the headers remaining sticky at the top.
- **Right-Click Context Menu:** Right-click on any row in the request table. Verify that the custom menu appears with the options to:
  - **Replay Request:** Click this option and verify that the replayed request is executed and appears live at the top of the table marked with a grey `REPLAY` badge.
  - **Filter by path:** Verify it populates the search bar and filters the list.
  - **Filter by host:** Verify it populates the search bar and filters the list.
  - **Copy URL:** Verify it copies the full URL to the clipboard.

## Files Modified (Request Breakpoints)

| File | Changes |
|------|---------|
| `server/proxy/index.js` | Added intercept/breakpoint system: pending queue, timeout handling, filter matching, resolve/drop/forward-all |
| `server/proxy/ws.js` | Added WebSocket handlers for `intercept_forward`, `intercept_drop`, `intercept_forward_all` |
| `server/routes/network.js` | Added REST endpoints: `GET/PUT /intercept`, `POST /intercept/:id/forward`, `POST /intercept/:id/drop`, `POST /intercept/forward-all` |
| `server/index.js` | Wired intercept functions into router |
| `src/js/api.js` | Added `networkIntercept`, `networkSetIntercept`, `networkInterceptForward`, `networkInterceptDrop`, `networkInterceptForwardAll` |
| `src/js/views/network.js` | Added breakpoint panel, pending queue, edit modal, WebSocket integration, intercept badges in table |
| `src/css/index.css` | Added ~450 lines of intercept panel, pending queue, edit modal, toggle switch, and badge styles |
| `README.md` | Added breakpoint feature docs and API reference |
| `docs/network-inspector-task.md` | This file — updated with breakpoint docs |

---

## How to Test — Request Breakpoints

### 1. Enable Intercept Mode

Navigate to `http://localhost:5173/#/network` and click the 🛑 button in the toolbar. Toggle the **Enable Intercept Mode** switch.

### 2. Intercept a Request

```bash
# Send a request through the proxy
curl -x http://localhost:3457 http://httpbin.org/get
```

The request should appear in the **Pending Queue** inside the breakpoint panel with a live timer.

### 3. Test Forward

Click ✅ on a pending request to forward it as-is. The response should appear in the main request table.

### 4. Test Edit & Send

1. Click ✏️ on a pending request to open the edit modal
2. Modify the URL, headers, or body
3. Click "Send Modified" — the modified request should be forwarded and appear in the table with an `EDITED` badge

### 5. Test Drop

Click ❌ on a pending request. The request should be dropped and appear in the table with a `DROPPED` badge and status code `499`.

### 6. Test Forward All

When multiple requests are pending, click "Forward All" to release all at once.

### 7. Test URL Filters

Add a URL filter pattern (e.g. `httpbin.org`). Only matching requests should be intercepted; non-matching requests should pass through normally.

### 8. Test Timeout

Enable intercept mode, send a request, and wait 5 minutes. The request should auto-drop with a timeout event.

---

## Phase 2 Roadmap — Advanced Observability & Mocking

The following roadmap outlines plans to expand the Network Inspector into a comprehensive observability, testing, and simulation suite:

### 1. ~~Request Interception & Mocking Rules~~ ✅ Complete
- **Mock Responses:** ✅ Rules builder UI to intercept specific API calls and return custom mock JSON responses.
- **Error Simulation:** ✅ Simulate API failures (HTTP 500, HTTP 429 Rate Limits) or inject network delays.
- **Request Breakpoints:** ✅ Intercept mode that pauses each request for user review — forward, edit & send, or drop. URL pattern filtering and bulk forward-all support.

### 2. Token Counting & Cost Estimation
- **Parse Payloads:** Extract token counts (input/completion tokens) directly from the API response bodies of known LLM providers.
- **Cost Benchmarks:** Calculate real-time financial cost (in USD) using dynamic model rate sheets, rendering cost summaries per-request and per-session.

### 3. Curl & Fetch Code Generator
- **Copy Actions:** Expand right-click context menu options to generate copyable code snippets:
  - **Copy as cURL**
  - **Copy as Fetch (NodeJS)**
  - **Copy as Fetch (Browser)**

### 4. Side-by-Side Prompt/Response Diff Tool
- **Payload Diffing:** Allow selecting any two request entries and running a visual diff comparison (line-by-side or inline) comparing prompt content (system instructions, user messages, parameters like temperature) and response text.

### 5. Latency & TTFB Benchmarks
- **Performance Analytics:** Add benchmark charts tracking Average TTFB (Time to First Byte), throughput, and bandwidth categorized by AI provider or specific models.

### 6. Network Throttling Simulator
- **Condition Presets:** Emulate limited bandwidth networks (e.g., Slow 3G, Fast 3G, Offline) to verify extension UI responsiveness.

### 7. Named Session Recordings
- **Trace Bundling:** Group sequences of captured requests into named sessions, saving or exporting/importing them for sharing or running regression suites.
