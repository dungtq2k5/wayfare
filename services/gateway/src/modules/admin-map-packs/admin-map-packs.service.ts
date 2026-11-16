import { Injectable } from '@nestjs/common';
import type { MapPack } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { PeopleNamesService } from '../people-names/people-names.service';
import { toMapPack, toRegisterMapPackRequest } from './admin-map-pack.mapper';
import type { RegisterMapPackDto } from './dto/admin-map-pack.dto';

/** Registration re-hashes every object of a pack (api-endpoints-plan §3.6): a minute, not 2 s. */
export const REGISTER_MAP_PACK_DEADLINE_MS = 60_000;

/** `/admin/map-packs`, backed by `catalog.MapPackAdminService`. */
@Injectable()
export class AdminMapPacksService {
  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly people: PeopleNamesService,
  ) {}

  async list(context: AccountContext, areaId: string | undefined): Promise<MapPack[]> {
    const response = await this.catalog.mapPackAdmin.call(
      'listMapPacks',
      areaId === undefined ? {} : { areaId },
      context,
    );
    const nameOf = await this.people.of(
      context,
      response.mapPacks.map((pack) => pack.createdById),
    );
    return response.mapPacks.map((pack) => toMapPack(pack, nameOf));
  }

  /** One pack, its registrar named by the rule. */
  private async named(
    context: AccountContext,
    pack: Parameters<typeof toMapPack>[0],
  ): Promise<{ mapPack: MapPack }> {
    const nameOf = await this.people.of(context, [pack?.createdById]);
    return { mapPack: toMapPack(pack, nameOf) };
  }

  async register(context: AccountContext, body: RegisterMapPackDto): Promise<{ mapPack: MapPack }> {
    const response = await this.catalog.mapPackAdmin.call(
      'registerMapPack',
      toRegisterMapPackRequest(body),
      context,
      { deadlineMs: REGISTER_MAP_PACK_DEADLINE_MS },
    );
    return this.named(context, response.mapPack);
  }

  async publish(context: AccountContext, mapPackId: string): Promise<{ mapPack: MapPack }> {
    const response = await this.catalog.mapPackAdmin.call('publishMapPack', { mapPackId }, context);
    return this.named(context, response.mapPack);
  }
}
