// The identity use cases wired by hand over the test database — the same graph Nest builds,
// without a gRPC server, a broker or Redis.
import { MAX_ROLE_HOLDERS_PER_CHANGE } from '@wayfare/contracts';
import type { SocketEventKey, SocketPayload } from '@wayfare/contracts';
import { OutboxService, rpcError } from '@wayfare/nest-common';
import { AccessService } from '../../src/modules/access/access.service';
import { AccountLinksService } from '../../src/modules/account-links/account-links.service';
import { AdminUsersService } from '../../src/modules/admin-users/admin-users.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import { DevicesService } from '../../src/modules/devices/devices.service';
import { EmailChangeService } from '../../src/modules/email-change/email-change.service';
import { EmailDispatcher } from '../../src/modules/email/email.module';
import { EmailService } from '../../src/modules/email/email.service';
import { LegalService } from '../../src/modules/legal/legal.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OwnerRegistrationsService } from '../../src/modules/owner-registrations/owner-registrations.service';
import { OwnerReviewService } from '../../src/modules/owner-review/owner-review.service';
import { PasswordService } from '../../src/modules/password/password.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { TokensService } from '../../src/modules/tokens/tokens.service';
import { UsersService } from '../../src/modules/users/users.service';
import { testConfig } from './database';
import { RecordingEmailProvider } from './email';

/**
 * Every identity use case over one Prisma client. `outboxOverride` replaces outbox methods to
 * inject failures; `options` replaces the billing port and the role-holder limit.
 */
export function identityServices(
  prisma: PrismaService,
  outboxOverride: Partial<OutboxService> = {},
  options: {
    billing?: Pick<BillingPortService, 'getLiveObligations'>;
    roleHoldersLimit?: number;
    mailbox?: RecordingEmailProvider;
  } = {},
) {
  const real = new OutboxService();
  const outbox: OutboxService = {
    add: outboxOverride.add ?? real.add.bind(real),
    addMany: outboxOverride.addMany ?? real.addMany.bind(real),
  };
  const config = testConfig();
  const tokens = new TokensService(config);
  const access = new AccessService();
  const legal = new LegalService();
  const sessions = new SessionsService(outbox, access, tokens);
  const devices = new DevicesService(prisma, outbox, tokens, legal, sessions);
  const mailbox = options.mailbox ?? new RecordingEmailProvider();
  const email = new EmailService(prisma, mailbox, config);
  const dispatcher = new EmailDispatcher(email);
  const links = new AccountLinksService();
  const emailChange = new EmailChangeService(
    prisma,
    outbox,
    tokens,
    sessions,
    links,
    email,
    dispatcher,
  );
  const passwords = new PasswordService(prisma, outbox, tokens, sessions, links, email, dispatcher);
  const auth = new AuthService(
    prisma,
    outbox,
    tokens,
    access,
    legal,
    sessions,
    devices,
    links,
    emailChange,
    dispatcher,
  );
  const registrations = new OwnerRegistrationsService(prisma, outbox, legal, config);
  const users = new UsersService(prisma, access, legal, devices, registrations);
  // billing, unreachable unless a spec says otherwise: every call fails closed, as the port does.
  const billing = (options.billing ?? {
    getLiveObligations: () => Promise.reject(rpcError('UPSTREAM_UNAVAILABLE')),
  }) as BillingPortService;
  const adminUsers = new AdminUsersService(
    prisma,
    outbox,
    access,
    sessions,
    billing,
    links,
    email,
    dispatcher,
  );
  const roles = new RolesService(
    prisma,
    outbox,
    access,
    sessions,
    options.roleHoldersLimit ?? MAX_ROLE_HOLDERS_PER_CHANGE,
  );
  const frames = new FrameRecorder();
  const notifications = new NotificationsService(prisma, frames);
  const ownerReview = new OwnerReviewService(
    prisma,
    outbox,
    access,
    sessions,
    notifications,
    email,
    dispatcher,
    config,
  );
  return {
    config,
    tokens,
    access,
    legal,
    sessions,
    devices,
    auth,
    users,
    adminUsers,
    roles,
    mailbox,
    email,
    dispatcher,
    links,
    emailChange,
    passwords,
    frames,
    notifications,
    registrations,
    ownerReview,
  };
}

/** The socket emitter, recording the frames it would send. */
export class FrameRecorder {
  readonly frames: { room: string; event: SocketEventKey; payload: unknown }[] = [];

  toRoom<K extends SocketEventKey>(
    room: string | readonly string[],
    event: K,
    payload: SocketPayload<K>,
  ): void {
    for (const one of typeof room === 'string' ? [room] : room)
      this.frames.push({ room: one, event, payload });
  }

  of(event: SocketEventKey): unknown[] {
    return this.frames.filter((frame) => frame.event === event).map((frame) => frame.payload);
  }
}
