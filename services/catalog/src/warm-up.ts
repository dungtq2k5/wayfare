import type { INestApplication } from '@nestjs/common';
import { PlaceStatus } from '@wayfare/contracts';
import { WARM_UP_ID, warmUpAccount, warmUpDevice } from '@wayfare/nest-common';
import type { WarmUpStep } from '@wayfare/nest-common';
import { PlaceQueriesGrpcController } from './modules/place-queries/place-queries-grpc.controller';
import { PlacesGrpcController } from './modules/places/places-grpc.controller';
import { PrismaService } from './modules/prisma/prisma.service';

/** District 1's centre: where the nearby read looks. */
const CENTRE = { lat: 10.7769, lng: 106.7009 };

/**
 * Catalog's hot reads (`warmUp`): the tourist's nearby, sync page, a Place's detail by id and by
 * code, and the console's Place search. On a live Place when there is one, so every query on the
 * path runs, not just the first.
 */
export async function catalogWarmUp(app: INestApplication): Promise<WarmUpStep[]> {
  const queries = app.get(PlaceQueriesGrpcController);
  const places = app.get(PlacesGrpcController);
  const live = await app.get(PrismaService).place.findFirst({
    where: { status: PlaceStatus.ACTIVE, deletedAt: null },
    select: { id: true, publicCode: true, areaId: true },
  });
  const place = live ?? { id: WARM_UP_ID, publicCode: 'AAAAAAAA', areaId: WARM_UP_ID };
  const lang = 'en';
  return [
    {
      name: 'nearby',
      run: () =>
        queries.nearbyPlaces({ ...CENTRE, radiusM: 1_000, lang, limit: 20 }, warmUpDevice()),
    },
    {
      name: 'sync page',
      run: () => queries.syncPlaces({ areaId: place.areaId, lang, since: '' }, warmUpDevice()),
    },
    { name: 'detail', run: () => queries.getPlace({ placeId: place.id, lang }, warmUpDevice()) },
    {
      name: 'by code',
      run: () => queries.getPlaceByCode({ publicCode: place.publicCode, lang }, warmUpDevice()),
    },
    {
      name: 'search',
      run: () =>
        places.listPlaces(
          {
            page: { page: 1, pageSize: 20, sort: '-updatedAt', q: 'warm' },
            includeDeleted: false,
            processingBefore: undefined,
          },
          warmUpAccount(),
        ),
    },
  ];
}
