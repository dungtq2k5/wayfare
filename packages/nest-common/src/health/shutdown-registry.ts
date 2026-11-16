import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { toErrorMessage } from '../errors/poison-message';

/**
 * Closes resources created outside Nest's container — the metrics listener — when the app shuts
 * down, so an open handle never keeps a stopping process alive.
 */
@Injectable()
export class ShutdownRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownRegistry.name);
  private readonly closers: (() => Promise<void> | void)[] = [];

  /** Registers a closer; closers run in reverse order. */
  add(closer: () => Promise<void> | void): void {
    this.closers.push(closer);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const closer of this.closers.toReversed()) {
      try {
        await closer();
      } catch (error) {
        this.logger.warn({ err: toErrorMessage(error) }, 'shutdown closer failed');
      }
    }
  }
}
