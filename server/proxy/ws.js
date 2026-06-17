/**
 * WebSocket server for real-time network request streaming.
 * Attaches to the Express HTTP server on path /ws/network.
 */

const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

/**
 * Initialize WebSocket server attached to an HTTP server.
 * @param {http.Server} server - The HTTP server to attach to
 */
function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws/network' });

  wss.on('connection', (ws) => {
    const client = { ws, paused: false };
    clients.add(client);
    console.log(`[Network WS] Client connected (${clients.size} total)`);

    // Send initial status
    ws.send(JSON.stringify({ type: 'connected', clients: clients.size }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'pause':
            client.paused = true;
            ws.send(JSON.stringify({ type: 'status', paused: true }));
            break;
          case 'resume':
            client.paused = false;
            ws.send(JSON.stringify({ type: 'status', paused: false }));
            break;
          default:
            break;
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      console.log(`[Network WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });

  return wss;
}

/**
 * Broadcast a captured request record to all connected, non-paused clients.
 * @param {Object} record - The captured request record
 */
function broadcast(record) {
  const msg = JSON.stringify({ type: 'request', data: record });
  for (const client of clients) {
    if (!client.paused && client.ws.readyState === client.ws.OPEN) {
      try {
        client.ws.send(msg);
      } catch (e) {
        // Client will be cleaned up on close
      }
    }
  }
}

/**
 * Get the count of connected clients.
 */
function getClientCount() {
  return clients.size;
}

module.exports = { initWebSocket, broadcast, getClientCount };
