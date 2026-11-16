import type { Entitlements } from '@wayfare/contracts';
import { analyticsLevelProto, narrationLanguageScopeProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';

/** An enum this build cannot read is billing's fault, never the owner's. */
function known<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`billing sent an unknown ${what}`);
  return value;
}

/** billing's grant set; an absent optional becomes `null` (conventions §6.3). */
export function toEntitlements(grants: billingGrpc.Entitlements | undefined): Entitlements {
  if (grants === undefined) throw new Error('billing sent no grants');
  return {
    maxPlaces: grants.maxPlaces,
    autoNarration: grants.autoNarration,
    narrationLanguageScope: known(
      narrationLanguageScopeProto.fromProto(grants.narrationLanguageScope),
      'narration scope',
    ),
    maxPhotosPerPlace: grants.maxPhotosPerPlace,
    maxMenuItemsPerPlace: grants.maxMenuItemsPerPlace,
    discoveryBoostSlots: grants.discoveryBoostSlots,
    aiCreditsPerDay: grants.aiCreditsPerDay,
    analyticsLevel: known(analyticsLevelProto.fromProto(grants.analyticsLevel), 'analytics level'),
    canSellVouchers: grants.canSellVouchers,
    voucherCommissionBps: grants.voucherCommissionBps ?? null,
  };
}
