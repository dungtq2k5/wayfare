import { Injectable } from '@nestjs/common';
import {
  isCurrentLegalVersion,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  LegalParty,
  parseEnum,
} from '@wayfare/contracts';
import { rpcError } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** One party's newest acceptance of one document. */
export interface LegalAcceptanceView {
  readonly party: LegalParty;
  readonly document: LegalDocument;
  readonly version: string;
  readonly acceptedAt: Date;
  readonly current: boolean;
}

/** The party an acceptance belongs to: an account or an install. */
export type LegalPartyRef =
  | { readonly party: LegalParty.USER; readonly userId: string }
  | { readonly party: LegalParty.DEVICE; readonly deviceId: string };

/** The only writer of I-12 (rdm-spec). Append-only: the current acceptance is the newest per party and document. */
@Injectable()
export class LegalService {
  /** Refuses a version that is not the document's current one (`LEGAL_VERSION_OUTDATED`). */
  requireCurrent(document: LegalDocument, version: string): void {
    if (!isCurrentLegalVersion(document, version)) {
      throw rpcError('LEGAL_VERSION_OUTDATED', {
        document,
        currentVersion: LEGAL_DOCUMENT_VERSIONS[document],
      });
    }
  }

  /** Records a current acceptance and returns it. */
  async record(
    tx: Prisma.TransactionClient,
    who: LegalPartyRef,
    document: LegalDocument,
    version: string,
    ip: string | null,
  ): Promise<LegalAcceptanceView> {
    this.requireCurrent(document, version);
    const row = await tx.legalAcceptance.create({
      data: {
        userId: who.party === LegalParty.USER ? who.userId : null,
        deviceId: who.party === LegalParty.DEVICE ? who.deviceId : null,
        document,
        version,
        ip,
      },
      select: { acceptedAt: true },
    });
    return { party: who.party, document, version, acceptedAt: row.acceptedAt, current: true };
  }

  /**
   * Records the account's acceptance of the current `version` unless it already has one — an
   * application that carries its agreement needs no second request (rdm-spec I-12).
   */
  async acceptIfMissing(
    tx: Prisma.TransactionClient,
    userId: string,
    document: LegalDocument,
    version: string,
    ip: string | null,
  ): Promise<boolean> {
    this.requireCurrent(document, version);
    const existing = await tx.legalAcceptance.findFirst({
      where: { userId, document, version },
      select: { id: true },
    });
    if (existing !== null) return false;
    await this.record(tx, { party: LegalParty.USER, userId }, document, version, ip);
    return true;
  }

  /** The newest acceptance per document for each given party. Different parties are never merged. */
  async latest(
    tx: Prisma.TransactionClient,
    parties: readonly LegalPartyRef[],
  ): Promise<LegalAcceptanceView[]> {
    const views: LegalAcceptanceView[] = [];
    for (const who of parties) {
      const rows = await tx.legalAcceptance.findMany({
        where: who.party === LegalParty.USER ? { userId: who.userId } : { deviceId: who.deviceId },
        orderBy: [{ document: 'asc' }, { acceptedAt: 'desc' }],
        distinct: ['document'],
        select: { document: true, version: true, acceptedAt: true },
      });
      for (const row of rows) {
        const document = parseEnum(LegalDocument, row.document);
        views.push({
          party: who.party,
          document,
          version: row.version,
          acceptedAt: row.acceptedAt,
          current: isCurrentLegalVersion(document, row.version),
        });
      }
    }
    return views;
  }
}
