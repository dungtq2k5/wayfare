import { Injectable } from '@nestjs/common';
import { effectiveLimit, PlaceKind, zUuidV7 } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, requireAccountContext } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { BillingPortService } from '../billing-port/billing-port.service';
import { editableHash } from '../places/domain/editable-hash';
import { snapshotOfPlace } from '../places/domain/submission-diff';
import { PlacesService } from '../places/places.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { toOwnerPlace } from './owner-place.mapper';

const placeIdField = z.object({ placeId: zUuidV7 });

/**
 * A verified owner's own Venues (api-endpoints-plan §3.1): the list, a Venue beside its pending
 * submission, the plan's limits, and visibility. Another owner's Venue is not found.
 */
@Injectable()
export class OwnerPlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly places: PlacesService,
    private readonly submissions: SubmissionsService,
    private readonly billing: BillingPortService,
  ) {}

  /** Every Venue of the caller, every status, oldest first. */
  async listMyPlaces(context: RequestContext): Promise<catalogGrpc.ListMyPlacesResponse> {
    const owner = requireAccountContext(context);
    const rows = await this.prisma.place.findMany({
      where: { ownerUserId: owner.userId, kind: PlaceKind.VENUE, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const places: catalogGrpc.OwnerPlace[] = [];
    for (const { id } of rows) {
      const view = await this.places.placeView(this.prisma, id);
      places.push(toOwnerPlace(view, await this.submissions.pendingUpdateFor(this.prisma, id)));
    }
    return { places };
  }

  /** The live Venue with its `editableHash`, and the pending submission beside it. */
  async getMyPlace(
    request: catalogGrpc.GetMyPlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetMyPlaceResponse> {
    const owner = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const place = await this.places.ownedVenue(this.prisma, placeId, owner.userId);
    return {
      place,
      editableHash: editableHash(snapshotOfPlace(place)),
      pendingSubmission: await this.submissions.pendingUpdateFor(this.prisma, placeId),
    };
  }

  /** The effective limits and what uses them; `ENTITLEMENTS_UNAVAILABLE` when billing cannot say. */
  async getMyLimits(context: RequestContext): Promise<catalogGrpc.GetMyLimitsResponse> {
    const owner = requireAccountContext(context);
    const grants = await this.billing.getEntitlements(owner.userId);
    const usage = await this.places.placeLimitUsage(this.prisma, owner.userId);
    return {
      maxPlaces: effectiveLimit('maxPlaces', grants),
      used: usage.used,
      reservedByPendingSubmissions: usage.reserved,
      maxPhotosPerPlace: effectiveLimit('maxPhotosPerPlace', grants),
      maxMenuItemsPerPlace: effectiveLimit('maxMenuItemsPerPlace', grants),
      narrationLanguageScope: grants.narrationLanguageScope,
      autoNarration: grants.autoNarration,
    };
  }

  async deactivateMyPlace(
    request: catalogGrpc.DeactivateMyPlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.DeactivateMyPlaceResponse> {
    const owner = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    return { place: await this.places.deactivateByOwner(placeId, owner) };
  }

  /** Back through the gate when the plan has room: the plan is read first, at the moment. */
  async reactivateMyPlace(
    request: catalogGrpc.ReactivateMyPlaceRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ReactivateMyPlaceResponse> {
    const owner = requireAccountContext(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const grants = await this.billing.getEntitlements(owner.userId);
    return {
      place: await this.places.reactivateByOwner(
        placeId,
        owner,
        effectiveLimit('maxPlaces', grants),
      ),
    };
  }
}
