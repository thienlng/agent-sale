#!/usr/bin/env node
// Local-only reverse proxy so one HTTPS tunnel (e.g. `cloudflared tunnel --url http://127.0.0.1:4000`)
// can serve the whole dev stack for live Meta testing:
//   /api/channels/oauth/*  -> API  /api/v1/channels/oauth/*  (legacy redirect URI registered on the Meta app)
//   /api/*                 -> API  (PORT, default 3000)
//   /media/*               -> object storage (S3_PORT, default 9000) /<S3_BUCKET>/*, GET/HEAD only (public reads for Meta)
//   /webhooks/*            -> webhook ingress (WEBHOOK_PORT, default 3001)
//   / and its assets       -> marketing site (SITE_PORT, default 4323; `pnpm --filter @agent-sales/site serve:tunnel`)
//   everything else        -> Vite dev server (WEB_PORT, default 5180)
// Usage: node scripts/dev-tunnel-proxy.mjs [listenPort=4000]
import http from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';

const listen = Number(process.argv[2] ?? process.env.PROXY_PORT ?? 4000);
const api = Number(process.env.API_PORT ?? 3000);
const webhook = Number(process.env.WEBHOOK_PORT ?? 3001);
const web = Number(process.env.WEB_PORT ?? 5180);
const site = Number(process.env.SITE_PORT ?? 4323);
const s3 = Number(process.env.S3_PORT ?? 9000);
const bucket = process.env.S3_BUCKET || 'rapiz-local';

// The landing page owns the root and its static folders, as rapiz.vn does in production; the
// dashboard keeps every other path (/login, /signup, /app/…), as app.rapiz.vn does.
const SITE_PATH = /^\/(?:$|\?|index\.html|(?:images|fonts|_astro)\/)/;

// Public object reads: only a plain key is forwarded (no traversal, no empty or encoded-slash
// segments, no query such as ?list-type=2), re-encoded segment by segment.
function mediaRoute(url) {
  const denied = { rejected: true };
  let segments;
  try {
    const pathname = new URL(url, 'http://x').pathname;
    if (!pathname.startsWith('/media/')) return denied;
    segments = pathname
      .slice('/media/'.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return denied;
  }
  const unsafe = (segment) =>
    segment === '' || segment === '.' || segment === '..' || /[/\\]/.test(segment);
  if (segments.some(unsafe)) return denied;
  const key = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return { port: s3, path: `/${bucket}/${key}`, readOnly: true };
}

function route(url) {
  if (url.startsWith('/api/channels/oauth/'))
    return { port: api, path: url.replace('/api/channels/oauth/', '/api/v1/channels/oauth/') };
  if (url.startsWith('/api/')) return { port: api, path: url };
  if (url.startsWith('/media/')) return mediaRoute(url);
  if (url.startsWith('/webhooks/')) return { port: webhook, path: url };
  if (SITE_PATH.test(url)) return { port: site, path: url };
  return { port: web, path: url };
}

const server = http.createServer((req, res) => {
  const target = route(req.url ?? '/');
  if (target.rejected) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (target.readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }
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
  // Vite connects at /?token=... (vite-hmr, and vite-ping while it reconnects); only ordinary
  // HTTP root requests belong to the site.
  const hmr = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .some((protocol) => ['vite-hmr', 'vite-ping'].includes(protocol.trim()));
  const target = hmr ? { port: web, path: req.url ?? '/' } : route(req.url ?? '/');
  if (target.rejected) {
    socket.destroy();
    return;
  }
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
    `dev tunnel proxy on 127.0.0.1:${listen} -> api:${api} webhook:${webhook} web:${web} site:${site}\n`,
  );
});
