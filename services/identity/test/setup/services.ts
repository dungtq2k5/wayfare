// The identity use cases wired by hand over the test database — the same graph Nest builds,
// without a gRPC server, a broker or Redis.
import { MAX_ROLE_HOLDERS_PER_CHANGE } from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import { AccessService } from '../../src/modules/access/access.service';
import { AdminUsersService } from '../../src/modules/admin-users/admin-users.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import { DevicesService } from '../../src/modules/devices/devices.service';
import { LegalService } from '../../src/modules/legal/legal.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { TokensService } from '../../src/modules/tokens/tokens.service';
import { UsersService } from '../../src/modules/users/users.service';
import { testConfig } from './database';

/**
 * Every identity use case over one Prisma client. `outboxOverride` replaces outbox methods to
 * inject failures; `options` replaces the billing port and the role-holder limit.
 */
export function identityServices(
  prisma: PrismaService,
  outboxOverride: Partial<OutboxService> = {},
  options: { billing?: BillingPortService; roleHoldersLimit?: number } = {},
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
  const auth = new AuthService(prisma, outbox, tokens, access, legal, sessions, devices);
  const users = new UsersService(prisma, access, legal, devices);
  const billing = options.billing ?? new BillingPortService();
  const adminUsers = new AdminUsersService(prisma, outbox, access, sessions, billing);
  const roles = new RolesService(
    prisma,
    outbox,
    access,
    sessions,
    options.roleHoldersLimit ?? MAX_ROLE_HOLDERS_PER_CHANGE,
  );
  return { config, tokens, access, legal, sessions, devices, auth, users, adminUsers, roles };
}
