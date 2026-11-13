import { Injectable } from '@nestjs/common';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument, LegalParty } from '@wayfare/contracts';
import type { BillingOverview, Invoice, Plan } from '@wayfare/contracts';
import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import { AppHttpException } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { toBillingOverview, toInvoice, toPlan } from '../billing/billing.mapper';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { CheckoutSessionDto } from './dto/owner-billing.dto';

/**
 * The three routes billing answers by calling Stripe: a first checkout makes two Stripe calls (the
 * customer, then the session), each allowed 10 s by billing, so the 2 s default would cut a slow
 * but successful Stripe answer short.
 */
const STRIPE_BACKED_DEADLINE_MS = 25_000;

/** `/owner/billing`, backed by `billing.BillingService` (api-endpoints-plan §5.1). */
@Injectable()
export class OwnerBillingService {
  constructor(
    private readonly billing: BillingServiceGrpcClient,
    private readonly identity: IdentityServiceGrpcClient,
  ) {}

  async overview(context: AccountContext): Promise<BillingOverview> {
    return toBillingOverview(await this.billing.billing.call('getOverview', {}, context));
  }

  async plans(context: AccountContext): Promise<Plan[]> {
    const response = await this.billing.billing.call('listPurchasablePlans', {}, context);
    return response.plans.map(toPlan);
  }

  /**
   * The current owner agreement first — billing holds no legal data, so the gateway asks identity
   * (api-endpoints-plan §5.1) — then a Checkout Session, the route's key forwarded to Stripe.
   */
  async checkout(
    context: AccountContext,
    body: CheckoutSessionDto,
    idempotencyKey: string,
  ): Promise<{ url: string }> {
    await this.requireOwnerAgreement(context);
    return this.billing.billing.call(
      'createCheckoutSession',
      { planPriceId: body.planPriceId, idempotencyKey },
      context,
      { deadlineMs: STRIPE_BACKED_DEADLINE_MS },
    );
  }

  portal(context: AccountContext): Promise<{ url: string }> {
    return this.billing.billing.call('createPortalSession', {}, context, {
      deadlineMs: STRIPE_BACKED_DEADLINE_MS,
    });
  }

  async invoices(context: AccountContext): Promise<Invoice[]> {
    const response = await this.billing.billing.call('listInvoices', {}, context, {
      deadlineMs: STRIPE_BACKED_DEADLINE_MS,
    });
    return response.invoices.map(toInvoice);
  }

  /** `409 LEGAL_VERSION_OUTDATED` unless the account accepted the current owner agreement. */
  private async requireOwnerAgreement(context: AccountContext): Promise<void> {
    const { acceptances } = await this.identity.users.call('listLegalAcceptances', {}, context);
    const accepted = acceptances.some(
      (acceptance) =>
        legalPartyProto.fromProto(acceptance.party) === LegalParty.USER &&
        legalDocumentProto.fromProto(acceptance.document) === LegalDocument.OWNER_AGREEMENT &&
        acceptance.current,
    );
    if (!accepted) {
      throw new AppHttpException('LEGAL_VERSION_OUTDATED', {
        document: LegalDocument.OWNER_AGREEMENT,
        currentVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.OWNER_AGREEMENT],
      });
    }
  }
}
