import { Injectable } from '@nestjs/common';
import { NarrationLanguageScope, parseEnum } from '@wayfare/contracts';
import type { BILLING_ENTITLEMENTS_CHANGED, EventPayload } from '@wayfare/contracts';
import type { CatalogTx } from '../sync/sync.service';

/** What catalog keeps of an owner's grants (rdm-spec C-18). */
export interface OwnerEntitlementView {
  readonly version: number;
  readonly autoNarration: boolean;
  readonly narrationLanguageScope: NarrationLanguageScope;
  readonly maxPlaces: number;
}

/**
 * catalog's projection of each owner's entitlements (rdm-spec C-18): the version guard for the
 * `billing.entitlements.changed` consumer, and where a Venue's languages and its initial
 * auto-narration are read. It is never a limit check — those ask billing (api-endpoints-plan §12.2).
 */
@Injectable()
export class OwnerEntitlementsService {
  /** The owner's projection, or null when no event has been applied yet. */
  async current(db: CatalogTx, ownerUserId: string): Promise<OwnerEntitlementView | null> {
    const row = await db.ownerEntitlement.findUnique({ where: { ownerUserId } });
    if (row === null) return null;
    return {
      version: Number(row.entitlementsVersion),
      autoNarration: row.autoNarration,
      narrationLanguageScope: parseEnum(NarrationLanguageScope, row.narrationLanguageScope),
      maxPlaces: row.maxPlaces,
    };
  }

  /** The owner's narration scope; `BASIC` before any grant arrived. */
  async scopeOf(db: CatalogTx, ownerUserId: string): Promise<NarrationLanguageScope> {
    return (
      (await this.current(db, ownerUserId))?.narrationLanguageScope ?? NarrationLanguageScope.BASIC
    );
  }

  /** Whether the owner's Venues are narrated automatically; off before any grant arrived. */
  async autoNarrationOf(db: CatalogTx, ownerUserId: string): Promise<boolean> {
    return (await this.current(db, ownerUserId))?.autoNarration ?? false;
  }

  /** Stores an event's grants unless a newer version is already stored. Returns whether it did. */
  async record(
    db: CatalogTx,
    event: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>,
  ): Promise<boolean> {
    const { entitlements } = event;
    const written = await db.$executeRaw`
      INSERT INTO owner_entitlements
        (owner_user_id, entitlements_version, auto_narration, narration_language_scope, max_places,
         updated_at)
      VALUES (${event.ownerUserId}::uuid, ${event.entitlementsVersion}, ${entitlements.autoNarration},
              ${entitlements.narrationLanguageScope}, ${entitlements.maxPlaces}, now())
      ON CONFLICT (owner_user_id) DO UPDATE SET
        entitlements_version = EXCLUDED.entitlements_version,
        auto_narration = EXCLUDED.auto_narration,
        narration_language_scope = EXCLUDED.narration_language_scope,
        max_places = EXCLUDED.max_places,
        updated_at = now()
      WHERE owner_entitlements.entitlements_version < EXCLUDED.entitlements_version`;
    return written > 0;
  }
}
