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
    res.setHeader('cache-control', 'public, max-age=60');
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
  for (const name of ['site', 'web', 'api', 'webhook', 's3']) services[name] = await upstream(name);
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
        S3_PORT: String(services.s3.port),
        S3_BUCKET: 'rapiz-test',
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

  await t.test('the Vite reconnect ping (vite-ping) also reaches the dashboard', async () => {
    const response = await upgrade(proxyPort, '/?token=synthetic-hmr-token', 'vite-ping');
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

  await t.test('/media reads go to the object storage bucket; writes are refused', async () => {
    const response = await read(proxyPort, '/media/products/ws/pic.jpg');
    assert.equal(response.name, 's3');
    assert.equal(response.path, '/rapiz-test/products/ws/pic.jpg');
    const put = await globalThis.fetch(`http://127.0.0.1:${proxyPort}/media/products/ws/pic.jpg`, {
      method: 'PUT',
      body: 'x',
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(put.status, 405);
    const head = await globalThis.fetch(`http://127.0.0.1:${proxyPort}/media/products/ws/pic.jpg`, {
      method: 'HEAD',
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(head.status, 200);
  });

  await t.test('/media passes content headers and refuses unsafe keys or queries', async () => {
    const ok = await globalThis.fetch(`http://127.0.0.1:${proxyPort}/media/products/ws/pic.jpg`);
    assert.equal(ok.headers.get('content-type'), 'application/json');
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
    assert.ok(ok.headers.get('content-length'));
    // The client normalizes literal dot segments, so those are sent as raw requests.
    const raw = (path) =>
      new Promise((resolve, reject) => {
        const socket = net.connect(proxyPort, '127.0.0.1', () =>
          socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
        );
        let data = '';
        socket.on('data', (chunk) => (data += chunk));
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
      });
    for (const path of [
      '/media/../x',
      '/media/%2e%2e/x',
      '/media/a/%2F../b',
      '/media/a/%2f/b',
      '/media/a//b',
      '/media/a/b%5Cc',
      '/media/',
    ]) {
      assert.match(await raw(path), /^HTTP\/1\.1 404/, path);
    }
    const query = await raw('/media/a/b.png?list-type=2&x=1');
    assert.match(query, /^HTTP\/1\.1 200/);
    assert.match(query, /"path":"\/rapiz-test\/a\/b\.png"/);
    const encoded = await raw('/media/a/b%20c.png');
    assert.match(encoded, /"path":"\/rapiz-test\/a\/b%20c\.png"/);
  });
});
