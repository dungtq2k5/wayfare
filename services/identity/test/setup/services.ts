// The identity use cases wired by hand over the test database — the same graph Nest builds,
// without a gRPC server, a broker or Redis.
import { OutboxService } from '@wayfare/nest-common';
import { AccessService } from '../../src/modules/access/access.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { DevicesService } from '../../src/modules/devices/devices.service';
import { LegalService } from '../../src/modules/legal/legal.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { TokensService } from '../../src/modules/tokens/tokens.service';
import { UsersService } from '../../src/modules/users/users.service';
import { testConfig } from './database';

/** Every identity use case over one Prisma client; `outbox` may be replaced to inject failures. */
export function identityServices(
  prisma: PrismaService,
  outbox: Pick<OutboxService, 'add'> = new OutboxService(),
) {
  const config = testConfig();
  const tokens = new TokensService(config);
  const access = new AccessService();
  const legal = new LegalService();
  const sessions = new SessionsService(outbox, access, tokens);
  const devices = new DevicesService(prisma, outbox, tokens, legal, sessions);
  const auth = new AuthService(prisma, outbox, tokens, access, legal, sessions, devices);
  const users = new UsersService(prisma, access, legal, devices);
  return { config, tokens, access, legal, sessions, devices, auth, users };
}
