import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { collectDefaultMetrics, register } from 'prom-client';

let defaultsCollected = false;

/**
 * Serves Prometheus `/metrics` on its own port — unreachable from the internet as a property of the
 * process, not of a proxy config (api-endpoints-plan §13). Resolves once listening.
 */
export async function startMetricsServer(port: number): Promise<Server> {
  if (!defaultsCollected) {
    collectDefaultMetrics();
    defaultsCollected = true;
  }
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': register.contentType }).end(body);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  return server;
}
