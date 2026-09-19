import { OutboxService, rpcError } from '@wayfare/nest-common';
import type { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import { PendingUploadsReapJob } from '../../src/modules/jobs/pending-uploads-reap.job';
import { PhotoObjectsCleanupJob } from '../../src/modules/jobs/photo-objects-cleanup.job';
import { LocalizationSourcesService } from '../../src/modules/localization-sources/localization-sources.service';
import { LocalizationsService } from '../../src/modules/localizations/localizations.service';
import { OwnerEntitlementsService } from '../../src/modules/owner-entitlements/owner-entitlements.service';
import { PlaceQueriesService } from '../../src/modules/place-queries/place-queries.service';
import { PlacesService } from '../../src/modules/places/places.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { SharpImageProcessor } from '../../src/providers/image/sharp.image-processor';
import { GcsStorageProvider } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { testConfig } from './database';

/** The emulator's test bucket, as the services see it. */
export function testStorage(): GcsStorageProvider {
  const config = testConfig();
  return new GcsStorageProvider({
    bucket: config.get('GCS_BUCKET_MEDIA', { infer: true }),
    apiEndpoint: config.get('GCS_API_ENDPOINT', { infer: true }),
    keyFilename: config.get('GOOGLE_APPLICATION_CREDENTIALS', { infer: true }),
  });
}

/** billing, unreachable: every call fails closed, as the real port does when billing is down. */
const UNREACHABLE_BILLING = {
  countLiveVouchers: () => Promise.reject(rpcError('UPSTREAM_UNAVAILABLE')),
} as unknown as BillingPortService;

/** catalog's services, wired by hand the way the modules wire them. */
export function catalogServices(
  prisma: PrismaService,
  options: {
    storage?: StorageProvider;
    billing?: Pick<BillingPortService, 'countLiveVouchers'>;
  } = {},
) {
  const config = testConfig();
  const outbox = new OutboxService();
  const storage = options.storage ?? testStorage();
  const uploads = new UploadsService(prisma, config, storage, new SharpImageProcessor());
  const ownerEntitlements = new OwnerEntitlementsService();
  const places = new PlacesService(
    prisma,
    outbox,
    uploads,
    (options.billing as BillingPortService | undefined) ?? UNREACHABLE_BILLING,
    ownerEntitlements,
    config,
  );
  const sync = new SyncService(prisma);
  return {
    config,
    storage,
    uploads,
    places,
    ownerEntitlements,
    sources: new LocalizationSourcesService(prisma),
    sync,
    queries: new PlaceQueriesService(prisma, sync, config),
    localizations: new LocalizationsService(prisma, outbox, places),
    reap: new PendingUploadsReapJob(prisma, storage),
    cleanup: new PhotoObjectsCleanupJob(prisma, storage),
  };
}
