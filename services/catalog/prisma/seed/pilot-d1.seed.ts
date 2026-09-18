// pnpm seed:dev — the District 1 pilot (ADR 0001, ADR 0002): its area and its Editorial Places,
// written through catalog's own services as the seed editor. Run it through turbo only
// (`pnpm seed:dev`, optionally `--filter=@wayfare/catalog`): identity's seed must create the seed
// editor first, or every audit event from this one is refused and dead-lettered. Calling this
// package script directly is unsupported. Never in production; idempotent; never deletes.
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { newId } from '@wayfare/contracts';
import { SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { packageRoot, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { AppModule } from '../../src/app.module';
import { AreasService } from '../../src/modules/areas/areas.service';
import { PlacesService } from '../../src/modules/places/places.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { loadPilotCorpus } from './pilot-corpus';
import { describeReport, PilotSeeder } from './pilot-seeder';

/** The seed editor, as catalog's services see the caller. */
export const SEED_EDITOR_CONTEXT: AccountContext = {
  kind: 'account',
  userId: SEED_EDITOR_USER_ID,
  sessionId: newId(),
  deviceId: null,
  permissions: [],
  ownerVerified: false,
  emailVerified: true,
  origin: SYSTEM_ORIGIN,
};

/** Throws in production — called before anything boots or connects (ADR 0002). */
export function assertNotProduction(env: Readonly<Record<string, string | undefined>>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production (ADR 0002)');
  }
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  if (process.env.PRISMA_DB === 'test') process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

  const corpus = loadPilotCorpus();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const seeder = new PilotSeeder(
      {
        places: app.get(PlacesService),
        uploads: app.get(UploadsService),
        areas: app.get(AreasService),
        prisma: app.get(PrismaService),
      },
      SEED_EDITOR_CONTEXT,
    );
    const report = await seeder.run(corpus);
    for (const line of describeReport(report)) console.log(line);
    if (report.stopped !== null || report.rows.some((row) => row.outcome === 'failed')) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
