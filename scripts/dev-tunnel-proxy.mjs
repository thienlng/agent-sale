#!/usr/bin/env node
// Local-only reverse proxy so one HTTPS tunnel (e.g. `cloudflared tunnel --url http://127.0.0.1:4000`)
// can serve the whole dev stack for live Meta testing:
//   /api/channels/oauth/*  -> API  /api/v1/channels/oauth/*  (legacy redirect URI registered on the Meta app)
//   /api/*                 -> API  (PORT, default 3000)
//   /webhooks/*            -> webhook ingress (WEBHOOK_PORT, default 3001)
//   everything else        -> Vite dev server (WEB_PORT, default 5180)
// Usage: node scripts/dev-tunnel-proxy.mjs [listenPort=4000]
import http from 'node:http';
import net from 'node:net';
import process from 'node:process';

const listen = Number(process.argv[2] ?? process.env.PROXY_PORT ?? 4000);
const api = Number(process.env.API_PORT ?? 3000);
const webhook = Number(process.env.WEBHOOK_PORT ?? 3001);
const web = Number(process.env.WEB_PORT ?? 5180);

function route(url) {
  if (url.startsWith('/api/channels/oauth/'))
    return { port: api, path: url.replace('/api/channels/oauth/', '/api/v1/channels/oauth/') };
  if (url.startsWith('/api/')) return { port: api, path: url };
  if (url.startsWith('/webhooks/')) return { port: webhook, path: url };
  return { port: web, path: url };
}

const server = http.createServer((req, res) => {
  const target = route(req.url ?? '/');
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      path: target.path,
      method: req.method,
      // Vite only accepts known hosts; the public host is kept in X-Forwarded-Host.
      headers: {
        ...req.headers,
        host: `localhost:${target.port}`,
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': 'https',
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream unavailable');
  });
  req.pipe(upstream);
});

// Vite HMR websocket.
server.on('upgrade', (req, socket, head) => {
  const target = route(req.url ?? '/');
  const upstream = net.connect(target.port, '127.0.0.1', () => {
    const headers = Object.entries({ ...req.headers, host: `localhost:${target.port}` })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    upstream.write(`${req.method} ${target.path} HTTP/1.1\r\n${headers}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(listen, '127.0.0.1', () => {
  process.stdout.write(
    `dev tunnel proxy on 127.0.0.1:${listen} -> api:${api} webhook:${webhook} web:${web}\n`,
  );
});
