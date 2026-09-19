import { OutboxService, rpcError } from '@wayfare/nest-common';
import { AnalyticsLevel, NarrationLanguageScope } from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { AreasService } from '../../src/modules/areas/areas.service';
import { CategoriesService } from '../../src/modules/categories/categories.service';
import { TaxonomyAdminService } from '../../src/modules/taxonomy-admin/taxonomy-admin.service';
import type { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import type {
  IdentityPortService,
  OwnerVerification,
} from '../../src/modules/identity-port/identity-port.service';
import { OwnerPlacesService } from '../../src/modules/owner-places/owner-places.service';
import { SubmissionReviewService } from '../../src/modules/submission-review/submission-review.service';
import { SubmissionsService } from '../../src/modules/submissions/submissions.service';
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

/**
 * billing as the ports see it: grants per owner (Growth-like by default), and every call failing
 * closed while `down`, as the real port does when billing is down. Vouchers are unreachable unless
 * a spec answers them.
 */
export class FakeBilling {
  down = false;
  readonly grants = new Map<string, Entitlements>();
  countLiveVouchers: (placeId: string) => Promise<number> = () =>
    Promise.reject(rpcError('UPSTREAM_UNAVAILABLE'));

  getEntitlements(ownerUserId: string): Promise<Entitlements> {
    if (this.down) return Promise.reject(rpcError('ENTITLEMENTS_UNAVAILABLE'));
    return Promise.resolve(this.grants.get(ownerUserId) ?? GROWTH_GRANTS);
  }
}

/** identity as catalog asks it: every owner verified and live unless a spec says otherwise. */
export class FakeIdentity {
  down = false;
  readonly owners = new Map<string, OwnerVerification>();

  getOwnerVerification(userId: string): Promise<OwnerVerification> {
    if (this.down) return Promise.reject(rpcError('UPSTREAM_UNAVAILABLE'));
    return Promise.resolve(this.owners.get(userId) ?? { verified: true, live: true });
  }
}

/** A Growth-like plan: ten Venues, eight photos, the launch languages. */
export const GROWTH_GRANTS: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

/** catalog's services, wired by hand the way the modules wire them. */
export function catalogServices(
  prisma: PrismaService,
  options: {
    storage?: StorageProvider;
    billing?: Pick<BillingPortService, 'countLiveVouchers'>;
  } = {},
) {
  const billing = new FakeBilling();
  if (options.billing !== undefined) {
    const answer = options.billing;
    billing.countLiveVouchers = (placeId) => answer.countLiveVouchers(placeId);
  }
  const identity = new FakeIdentity();
  const billingPort = billing as unknown as BillingPortService;
  const config = testConfig();
  const outbox = new OutboxService();
  const storage = options.storage ?? testStorage();
  const uploads = new UploadsService(prisma, config, storage, new SharpImageProcessor());
  const ownerEntitlements = new OwnerEntitlementsService();
  const frames = new FrameRecorder();
  const places = new PlacesService(
    prisma,
    outbox,
    uploads,
    billingPort,
    ownerEntitlements,
    config,
    frames,
  );
  const sync = new SyncService(prisma);
  const areas = new AreasService(prisma, outbox);
  const categories = new CategoriesService(prisma, outbox);
  const submissions = new SubmissionsService(prisma, outbox, places, billingPort);
  return {
    billing,
    identity,
    submissions,
    review: new SubmissionReviewService(
      prisma,
      outbox,
      places,
      billingPort,
      identity as unknown as IdentityPortService,
    ),
    ownerPlaces: new OwnerPlacesService(prisma, places, submissions, billingPort),
    areas,
    categories,
    taxonomy: new TaxonomyAdminService(categories, areas),
    config,
    storage,
    uploads,
    places,
    ownerEntitlements,
    frames,
    sources: new LocalizationSourcesService(prisma),
    sync,
    queries: new PlaceQueriesService(prisma, sync, config),
    localizations: new LocalizationsService(prisma, outbox, places),
    reap: new PendingUploadsReapJob(prisma, storage),
    cleanup: new PhotoObjectsCleanupJob(prisma, storage),
  };
}

/** The socket emitter, recording the frames it would send. */
export class FrameRecorder {
  readonly sent: { room: string | readonly string[]; event: string; payload: unknown }[] = [];

  toRoom(room: string | readonly string[], event: string, payload: unknown): void {
    this.sent.push({ room, event, payload });
  }
}
