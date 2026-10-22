// Minimal VLESS-over-WebSocket proxy for Cloudflare Workers (free tier).
// Client subscription format:
//   vless://<UUID>@<HOST>:443?encryption=none&security=tls&sni=<HOST>&type=ws&host=<HOST>&path=%2F8abbca25477ce773#CF-VLESS
//
// Deploy: Workers & Pages -> Create Worker -> paste this file -> Deploy.
// The worker is served with TLS on <name>.<account>.workers.dev.

import { connect } from 'cloudflare:sockets';

const UUID = '4ee8d288-6291-4373-be3d-11239709d8c2';
const WS_PATH = '/8abbca25477ce773';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket' && url.pathname === WS_PATH) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      handleConnection(server).catch(() => { try { server.close(); } catch (_) {} });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not Found', { status: 404 });
  },
};

function uuidToString(bytes) {
  const h = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
}

async function handleConnection(ws) {
  let remote = null;
  let writer = null;
  let headerDone = false;

  const closeAll = () => {
    try { ws.close(); } catch (_) {}
    try { if (writer) writer.releaseLock(); } catch (_) {}
    try { if (remote) remote.close(); } catch (_) {}
  };

  ws.addEventListener('close', closeAll);
  ws.addEventListener('error', closeAll);

  ws.addEventListener('message', async (event) => {
    try {
      const buf = new Uint8Array(event.data);
      if (!headerDone) {
        // ---- parse VLESS request header ----
        if (buf.length < 24) { closeAll(); return; }
        const version = buf[0];
        if (uuidToString(buf.slice(1, 17)) !== UUID.toLowerCase()) { closeAll(); return; }
        const addonLen = buf[17];
        const cmd = buf[18 + addonLen];
        if (cmd !== 0x01) { closeAll(); return; } // TCP only
        const port = (buf[19 + addonLen] << 8) | buf[20 + addonLen];
        const atyp = buf[21 + addonLen];
        let addrLen, host;
        if (atyp === 0x01) {
          // IPv4
          addrLen = 4;
          host = `${buf[22 + addonLen]}.${buf[23 + addonLen]}.${buf[24 + addonLen]}.${buf[25 + addonLen]}`;
        } else if (atyp === 0x02) {
          // domain
          addrLen = buf[22 + addonLen];
          host = new TextDecoder().decode(buf.slice(23 + addonLen, 23 + addonLen + addrLen));
        } else if (atyp === 0x03) {
          // IPv6
          addrLen = 16;
          const parts = [];
          for (let i = 0; i < 16; i += 2) {
            parts.push(((buf[22 + addonLen + i] << 8) | buf[23 + addonLen + i]).toString(16));
          }
          host = parts.join(':');
        } else { closeAll(); return; }
        const headerLen = 22 + addonLen + addrLen;

        // ---- open outbound TCP ----
        remote = connect({ hostname: host, port });
        writer = remote.writable.getWriter();

        // VLESS response header: [version, 0]
        ws.send(new Uint8Array([version, 0]));

        // remote -> ws
        (async () => {
          const reader = remote.readable.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              ws.send(value);
            }
          } catch (_) {} finally {
            try { reader.releaseLock(); } catch (_) {}
            closeAll();
          }
        })();

        headerDone = true;
        const first = buf.slice(headerLen);
        if (first.length > 0) await writer.write(first);
      } else {
        if (writer) await writer.write(buf);
      }
    } catch (_) {
      closeAll();
    }
  });
}
