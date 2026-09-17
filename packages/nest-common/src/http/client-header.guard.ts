import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLIENT_HEADER, isWayfareClient } from '@wayfare/contracts';
import type { Request } from 'express';
import { AppHttpException } from './app-http.exception';
import { SKIP_CLIENT_HEADER } from './skip-client-header.decorator';

/**
 * Requires `X-Wayfare-Client: console | web | mobile` on every HTTP request (api-endpoints-plan §0.3).
 * Global and first in the guard chain; also the CSRF defence for cookie sessions.
 */
@Injectable()
export class ClientHeaderGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CLIENT_HEADER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (!isWayfareClient(request.header(CLIENT_HEADER))) {
      throw new AppHttpException('CLIENT_HEADER_REQUIRED');
    }
    return true;
  }
}
