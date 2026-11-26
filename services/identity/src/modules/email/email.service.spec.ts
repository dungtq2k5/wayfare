import type { ConfigService } from '@nestjs/config';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema';
import type { EmailProvider } from '../../providers/email/email-provider';
import type { PrismaService } from '../prisma/prisma.service';
import { EmailService, linkAppOf } from './email.service';

const config = (values: Partial<Record<keyof Env, unknown>>) =>
  ({
    get: (key: keyof Env) =>
      ({
        EMAIL_FROM: 'Wayfare <no-reply@wayfare.test>',
        EMAIL_HASH_KEY: Buffer.alloc(32),
        CONSOLE_URL: 'https://console.wayfare.test',
        WEB_URL: 'https://wayfare.test',
        ...values,
      })[key],
  }) as unknown as ConfigService<Env, true>;

const build = (values: Partial<Record<keyof Env, unknown>>) =>
  new EmailService({} as PrismaService, {} as EmailProvider, config(values));

describe('where a mail’s links open', () => {
  it('opens the console for a console request, and leaves anything else to the recipient', () => {
    expect(linkAppOf(identityGrpc.SessionClient.SESSION_CLIENT_CONSOLE)).toBe('console');
    expect(linkAppOf(identityGrpc.SessionClient.SESSION_CLIENT_MOBILE)).toBeUndefined();
    expect(linkAppOf(undefined)).toBeUndefined();
  });
});

describe('the delivery policy', () => {
  it('sends anywhere when open, and to an allowlist with a catch-all when restricted', () => {
    expect(() => build({ EMAIL_DELIVERY_MODE: 'open' })).not.toThrow();
    expect(() =>
      build({
        EMAIL_DELIVERY_MODE: 'restricted',
        EMAIL_NONPROD_ALLOWLIST: ['*@example.com'],
        EMAIL_NONPROD_CATCHALL: 'team@wayfare.local',
      }),
    ).not.toThrow();
  });

  it('refuses to start restricted without both an allowlist and a catch-all', () => {
    for (const missing of [
      { EMAIL_NONPROD_CATCHALL: 'team@wayfare.local' },
      { EMAIL_NONPROD_ALLOWLIST: ['*@example.com'] },
    ]) {
      expect(() => build({ EMAIL_DELIVERY_MODE: 'restricted', ...missing })).toThrow(
        'Restricted delivery needs an allowlist and a catch-all',
      );
    }
  });
});
