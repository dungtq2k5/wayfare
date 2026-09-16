import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AnonymousContext, RequestContext } from '../context/request-context';

const CONTEXT_KEY = Symbol('wayfare:request-context');

type RequestWithContext = Request & { [CONTEXT_KEY]?: RequestContext };

/**
 * Resolves the request's caller once. Token verification does not exist yet, so every request is
 * anonymous; `origin` is what the gateway observed, with `trust proxy` applied to `req.ip`.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const context: AnonymousContext = {
    kind: 'anonymous',
    origin: { ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 512) ?? null },
  };
  (req as RequestWithContext)[CONTEXT_KEY] = context;
  next();
}

/** Injects the caller's `RequestContext`. Declare the narrowest variant the handler needs. */
export const Ctx = createParamDecorator(
  (_data: unknown, host: ExecutionContext): RequestContext => {
    const context = host.switchToHttp().getRequest<RequestWithContext>()[CONTEXT_KEY];
    if (context === undefined) throw new Error('requestContextMiddleware is not installed');
    return context;
  },
);
