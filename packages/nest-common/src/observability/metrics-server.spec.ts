import type { AddressInfo } from 'node:net';
import { register } from 'prom-client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startMetricsServer } from './metrics-server';

describe('the metrics port (api-endpoints-plan §13)', async () => {
  const server = await startMetricsServer(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('serves Prometheus metrics on GET /metrics, the defaults included', async () => {
    const answer = await fetch(`${base}/metrics`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe(register.contentType);
    expect(await answer.text()).toContain('process_cpu_user_seconds_total');
  });

  it('serves nothing else', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('answers 500 when the registry can’t be read', async () => {
    vi.spyOn(register, 'metrics').mockRejectedValueOnce(new Error('collector threw'));
    expect((await fetch(`${base}/metrics`)).status).toBe(500);
  });

  it('refuses a port already taken', async () => {
    const port = (server.address() as AddressInfo).port;
    await expect(startMetricsServer(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
