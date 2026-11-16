import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The HTTP request behind an execution context — the Express request for `http`, and the socket's
 * handshake request for `ws` (conventions §4.1). Guards and decorators use this, never
 * `switchToHttp()`, so the same code serves the WebSocket gateway.
 */
export function requestOf(context: ExecutionContext): Request {
  if (context.getType() === 'ws')
    return context.switchToWs().getClient<{ request: Request }>().request;
  return context.switchToHttp().getRequest<Request>();
}
