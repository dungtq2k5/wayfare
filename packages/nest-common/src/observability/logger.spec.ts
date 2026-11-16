import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { afterEach, describe, expect, it } from 'vitest';
import { loggerParams } from './logger';

/** Every line the HTTP logger writes for one request, its body parsed as the framework would. */
async function linesFor(body: object, status: number): Promise<string> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const params = loggerParams('info').pinoHttp as Parameters<typeof pinoHttp>[0];
  const middleware = pinoHttp({ ...(params as object), logger: pino({ level: 'info' }, stream) });
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      (req as typeof req & { body: unknown }).body = JSON.parse(raw);
      middleware(req, res);
      // A handler's own error line, with the request, as the error filter writes it.
      if (status >= 400) req.log.error({ req, err: new Error('refused') }, 'request failed');
      res.statusCode = status;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await fetch(`http://127.0.0.1:${port}/api/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await new Promise((resolve) => setImmediate(resolve));
  return lines.join('');
}

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('the HTTP logger and the analytics id (ADR 0042)', () => {
  const analyticsDeviceId = '7c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c';

  it('writes no request body — the analytics id never meets the device id in a log line', async () => {
    for (const status of [202, 400]) {
      const logged = await linesFor({ analyticsDeviceId, events: [{ cell: 'w3gv2cp' }] }, status);
      expect(logged).toContain('/api/v1/analytics/events');
      expect(logged).not.toContain(analyticsDeviceId);
      expect(logged).not.toContain('w3gv2cp');
    }
  });
});
