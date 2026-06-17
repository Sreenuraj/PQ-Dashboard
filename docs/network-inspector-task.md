# Network Inspector — Task Tracker

> **Branch:** `feature/network-inspector`  
> **Status:** ✅ Implementation Complete — Ready for Testing  
> **Created:** 2026-06-17

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

---

## Architecture

```
VS Code (with PostQode)
  │
  │  http.proxy = http://localhost:3457
  ▼
┌──────────────────────┐     ┌───────────────────────┐
│  MITM Proxy (:3457)  │────▶│  In-Memory Store      │
│  http-mitm-proxy     │     │  (500 req circular)   │
└──────────────────────┘     └───────────┬───────────┘
  │                                      │
  │ forwards to actual servers           │ broadcast
  ▼                                      ▼
┌──────────────────────┐     ┌───────────────────────┐
│  api.openai.com      │     │  WebSocket (/ws/net)   │
│  api.anthropic.com   │     │  + REST API (/api/net) │
│  etc.                │     └───────────┬───────────┘
└──────────────────────┘                 │
                                         ▼
                              ┌───────────────────────┐
                              │  Dashboard Frontend    │
                              │  Network Inspector Tab │
                              └───────────────────────┘
```
