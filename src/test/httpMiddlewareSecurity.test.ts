import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import compression from 'compression';
import http, { type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

let server: Server;
let port: number;
const text = 'AyahX compressed response '.repeat(1000);
beforeAll(async () => {
  const app = express();
  app.use(compression({ threshold: 1024 }));
  app.get('/compressed', (_req, res) => res.type('text').send(text));
  app.get('/stream', (_req, res) => {
    res.type('text');
    res.write(text);
    res.flush();
    const timer = setInterval(() => { res.write(text); res.flush(); }, 20);
    res.once('close', () => clearInterval(timer));
  });
  const narrow = express();
  // GHSA-jqcg-44mw-7w3h: this short mapped prefix must not trust every IPv4 peer.
  narrow.set('trust proxy', ['::ffff:10.0.0.0/8']);
  narrow.get('/', (req, res) => res.json({ ip: req.ip }));
  app.use('/untrusted', narrow);
  const trusted = express();
  trusted.set('trust proxy', 1);
  trusted.get('/', (req, res) => res.json({ ip: req.ip }));
  app.use('/railway-hop', trusted);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') port = addr.port;
      resolve();
    });
  });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('patched production HTTP middleware', () => {
  it('preserves gzip contents and negotiation', async () => {
    const result = await new Promise<{ encoding: string | undefined; bytes: Buffer }>((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/compressed', headers: { 'Accept-Encoding': 'gzip' } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ encoding: response.headers['content-encoding'], bytes: Buffer.concat(chunks) }));
        response.on('error', reject);
      }).on('error', reject);
    });
    expect(result.encoding).toBe('gzip');
    expect(gunzipSync(result.bytes).toString()).toBe(text);
  });
  it('handles an interrupted compressed response and subsequent request', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port, path: '/stream', headers: { 'Accept-Encoding': 'gzip' } }, response => {
        response.once('data', () => { response.destroy(); request.destroy(); });
        response.once('close', resolve);
      });
      request.on('error', reject);
    });
    expect(await (await fetch(`http://127.0.0.1:${port}/compressed`)).text()).toBe(text);
  });
  it('rejects a spoofed forwarded IP from an untrusted mapped-prefix peer', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/untrusted`, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
    expect(await response.json()).toEqual({ ip: '127.0.0.1' });
  });
  it('preserves the configured single Railway proxy hop', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/railway-hop`, { headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7' } });
    expect(await response.json()).toEqual({ ip: '198.51.100.7' });
  });
});
