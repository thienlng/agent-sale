import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { test } from 'node:test';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function upstream(name) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name, path: req.url, host: req.headers.host }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Test-Upstream: ${name}\r\nX-Test-Path: ${req.url}\r\nX-Test-Host: ${req.headers.host}\r\n\r\n`,
    );
  });
  return {
    port: await listen(server),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function read(port, path) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    signal: globalThis.AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function upgrade(port, path, protocol) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        ...(protocol ? { 'sec-websocket-protocol': protocol } : {}),
      },
    });
    request.setTimeout(5000, () => request.destroy(new Error('Upgrade did not complete')));
    request.on('error', reject);
    request.on('response', (response) => {
      response.resume();
      reject(new Error(`Expected HTTP 101, received ${response.statusCode}`));
    });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.headers);
    });
    request.end();
  });
}

test('development tunnel preserves HTTP routing and dispatches WebSocket upgrades', async (t) => {
  const services = {};
  for (const name of ['site', 'web', 'api', 'webhook']) services[name] = await upstream(name);
  const reservation = net.createServer();
  const proxyPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const proxy = spawn(
    process.execPath,
    [fileURLToPath(new URL('./dev-tunnel-proxy.mjs', import.meta.url)), String(proxyPort)],
    {
      env: {
        ...process.env,
        SITE_PORT: String(services.site.port),
        WEB_PORT: String(services.web.port),
        API_PORT: String(services.api.port),
        WEBHOOK_PORT: String(services.webhook.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  t.after(async () => {
    const stopped = once(proxy, 'exit');
    proxy.kill('SIGTERM');
    await stopped;
    await Promise.all(Object.values(services).map((service) => service.close()));
  });
  await once(proxy.stdout, 'data');

  await t.test('root and root query remain marketing HTTP requests', async () => {
    for (const path of ['/', '/?campaign=qa', '/images/qa.png', '/_astro/qa.js']) {
      const response = await read(proxyPort, path);
      assert.equal(response.name, 'site');
      assert.equal(response.path, path);
    }
  });

  await t.test('root Vite HMR upgrades reach dashboard with token and path intact', async () => {
    for (const path of ['/', '/?token=synthetic-hmr-token']) {
      const response = await upgrade(proxyPort, path, 'vite-hmr');
      assert.equal(response['x-test-upstream'], 'web');
      assert.equal(response['x-test-path'], path);
      assert.equal(response['x-test-host'], `localhost:${services.web.port}`);
    }
  });

  await t.test('Vite HMR is recognized in a comma-separated protocol list', async () => {
    const response = await upgrade(proxyPort, '/?token=synthetic-hmr-token', 'other, vite-hmr');
    assert.equal(response['x-test-upstream'], 'web');
  });

  await t.test('API WebSocket upgrades retain their API route', async () => {
    const response = await upgrade(proxyPort, '/api/realtime', 'qa-realtime');
    assert.equal(response['x-test-upstream'], 'api');
    assert.equal(response['x-test-path'], '/api/realtime');
  });

  await t.test('dashboard, API, legacy OAuth and webhook HTTP routes stay intact', async () => {
    for (const [path, name, target] of [
      ['/login', 'web', '/login'],
      ['/app/inbox', 'web', '/app/inbox'],
      ['/api/v1/health', 'api', '/api/v1/health'],
      ['/api/channels/oauth/facebook', 'api', '/api/v1/channels/oauth/facebook'],
      ['/webhooks/meta', 'webhook', '/webhooks/meta'],
    ]) {
      const response = await read(proxyPort, path);
      assert.equal(response.name, name);
      assert.equal(response.path, target);
    }
  });
});
