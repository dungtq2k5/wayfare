import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * The socket server over Redis pub/sub (ADR 0020, conventions §7.4): every gateway replica sees
 * every room, and services with no socket server reach them through the same Redis. CORS is the
 * HTTP API's, with credentials; WebSocket is the only transport.
 */
export class RedisIoAdapter extends IoAdapter {
  private redisAdapter: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: readonly string[],
  ) {
    super(app);
  }

  /** Opens the publish and subscribe connections; resolves to their closer. */
  async connect(redisUrl: string): Promise<() => Promise<void>> {
    const publisher = new Redis(redisUrl, { lazyConnect: true, connectionName: 'gateway-io-pub' });
    const subscriber = publisher.duplicate({ connectionName: 'gateway-io-sub' });
    await Promise.all([publisher.connect(), subscriber.connect()]);
    this.redisAdapter = createAdapter(publisher, subscriber);
    return async () => {
      await Promise.all([publisher.quit(), subscriber.quit()]).catch(() => undefined);
    };
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: [...this.corsOrigins], credentials: true },
      transports: ['websocket'],
    }) as Server;
    if (this.redisAdapter !== null) server.adapter(this.redisAdapter);
    return server;
  }
}
