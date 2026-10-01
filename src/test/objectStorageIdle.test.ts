// @vitest-environment node
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
const settings = vi.hoisted(() => ({ storage: { bucket: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', region: 'us-east-1', forcePathStyle: true, endpoint: '' } }));
vi.mock('../../server/config', () => ({ config: settings }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('closes API object-storage TCP sockets after each completed request', async () => {
  vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
  const server = createServer((_req, res) => { res.writeHead(204); res.end(); });
  const sockets = new Set<any>();
  let connections = 0;
  server.on('connection', socket => { connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  settings.storage.endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const { deleteStoredRender } = await import('../../server/services/objectStorage');
    await deleteStoredRender('s3://fixture/a.mp4');
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    await deleteStoredRender('s3://fixture/b.mp4');
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    expect(connections).toBe(2);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
