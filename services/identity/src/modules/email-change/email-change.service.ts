import { Injectable } from '@nestjs/common';
import {
  ActionTokenPurpose,
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
  maskEmail,
  MAX_PASSWORD_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  SessionRevokedReason,
  zEmail,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext, RequestOrigin } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { AccountLinksService } from '../account-links/account-links.service';
import { auditRecord } from '../audit/domain/audit-record';
import type { AuditFacts } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import type { PendingEmail } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';

const zToken = z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH);
const tokenField = z.object({ token: zToken });
const changeFields = z.object({
  newEmail: zEmail,
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/**
 * Address verification and change, with the seven-day revert (api-endpoints-plan §1.2, rdm-spec
 * I-9, ADR 0052). Every flow commits, answers, and only then sends.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly links: AccountLinksService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {}

  /**
   * Mints a verification link for the account's current address and prepares its mail. Shared by
   * registration and the re-send route; the caller commits and dispatches.
   */
  async prepareVerification(
    tx: Prisma.TransactionClient,
    user: { readonly id: string; readonly email: string },
    origin: RequestOrigin,
    now: Date,
  ): Promise<PendingEmail | null> {
    const link = await this.links.mint(tx, {
      userId: user.id,
      purpose: ActionTokenPurpose.EMAIL_VERIFICATION,
      targetEmail: user.email,
      origin,
      now,
    });
    return this.email.prepare(tx, {
      template: EmailTemplate.EMAIL_VERIFICATION,
      eventId: link.id,
      recipient: { userId: user.id },
      data: {},
      links: { action: { path: 'verifyEmail', token: link.token } },
    });
  }

  /** Re-sends verification; an already verified address sends nothing. */
  async requestEmailVerification(
    context: RequestContext,
  ): Promise<identityGrpc.RequestEmailVerificationResponse> {
    const account = requireAccountContext(context);
    const now = new Date();
    const pending = await this.prisma.$transaction(async (tx) => {
      const user = await this.liveUser(tx, account.userId);
      if (user.isEmailVerified) return null;
      return this.prepareVerification(tx, user, context.origin, now);
    });
    this.dispatcher.run([pending]);
    return {};
  }

  /**
   * Verifies the address the link was sent to. A link for an address the account no longer has is
   * simply not live. No cutoff bump: the client refreshes next.
   */
  async verifyEmail(
    request: identityGrpc.VerifyEmailRequest,
    context: RequestContext,
  ): Promise<identityGrpc.VerifyEmailResponse> {
    const { token } = parseRpcRequest(tokenField, request);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const link = await this.links.consume(tx, token, [ActionTokenPurpose.EMAIL_VERIFICATION]);
      await tx.user.update({
        where: { id: link.userId },
        data: { isEmailVerified: true, emailBouncedAt: null },
        select: { id: true },
      });
      await this.audit(tx, link.userId, AuditAction.EMAIL_VERIFIED, context.origin, now, {});
    });
    return {};
  }

  /**
   * Sends a confirmation link to the new address. `users.email` is untouched until it is used.
   */
  async requestEmailChange(
    request: identityGrpc.RequestEmailChangeRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RequestEmailChangeResponse> {
    const account = requireAccountContext(context);
    const fields = parseRpcRequest(changeFields, request);
    const user = await this.prisma.user.findFirst({
      where: { id: account.userId, deletedAt: null },
      select: { id: true, email: true, passwordHash: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    if (!(await this.tokens.verifyPassword(user.passwordHash, fields.currentPassword))) {
      throw rpcError('CURRENT_PASSWORD_INCORRECT');
    }
    const now = new Date();
    const pending = await this.prisma.$transaction(async (tx) => {
      if (await this.links.liveRevertFor(tx, { userId: user.id })) {
        throw rpcError('EMAIL_CHANGE_REVERT_PENDING');
      }
      if (fields.newEmail === user.email) {
        throw rpcError('INVALID_STATE', { status: 'SAME_ADDRESS' });
      }
      await this.requireAddressFree(tx, fields.newEmail);
      const link = await this.links.mint(tx, {
        userId: user.id,
        purpose: ActionTokenPurpose.EMAIL_CHANGE,
        targetEmail: fields.newEmail,
        origin: context.origin,
        now,
      });
      return this.email.prepare(tx, {
        template: EmailTemplate.EMAIL_CHANGE,
        eventId: link.id,
        recipient: { userId: user.id, email: fields.newEmail },
        data: {},
        links: { action: { path: 'confirmEmailChange', token: link.token } },
      });
    });
    this.dispatcher.run([pending]);
    return {};
  }

  /**
   * Moves the account to the confirmed address, kills every link that went to the old one, and
   * sends the old address a seven-day revert link. A taken or reserved address rolls the whole
   * transaction back, so the link stays usable once that clears.
   */
  async confirmEmailChange(
    request: identityGrpc.ConfirmEmailChangeRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ConfirmEmailChangeResponse> {
    const { token } = parseRpcRequest(tokenField, request);
    const now = new Date();
    const pending = await this.withAddressGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const link = await this.links.consume(tx, token, [ActionTokenPurpose.EMAIL_CHANGE]);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: link.userId },
          select: { email: true },
        });
        const oldAddress = user.email;
        const newAddress = link.targetEmail;
        await this.requireAddressFree(tx, newAddress);
        await tx.user.update({
          where: { id: link.userId },
          data: {
            email: newAddress,
            isEmailVerified: true,
            emailBouncedAt: null,
            credentialsChangedAt: now,
          },
          select: { id: true },
        });
        await this.links.invalidate(
          tx,
          link.userId,
          [
            ActionTokenPurpose.PASSWORD_RESET,
            ActionTokenPurpose.ACCOUNT_SETUP,
            ActionTokenPurpose.EMAIL_VERIFICATION,
          ],
          now,
        );
        const revert = await this.links.mint(tx, {
          userId: link.userId,
          purpose: ActionTokenPurpose.EMAIL_CHANGE_REVERT,
          targetEmail: oldAddress,
          origin: context.origin,
          now,
        });
        const notice = await this.email.prepare(tx, {
          template: EmailTemplate.EMAIL_CHANGED_NOTICE,
          eventId: revert.id,
          recipient: { userId: link.userId, email: oldAddress },
          data: {
            newEmailMasked: maskEmail(newAddress),
            ...(context.origin.ip === null ? {} : { requestIp: context.origin.ip }),
          },
          links: { action: { path: 'revertEmailChange', token: revert.token } },
        });
        await this.audit(tx, link.userId, AuditAction.EMAIL_CHANGED, context.origin, now, {});
        return notice;
      }),
    );
    this.dispatcher.run([pending]);
    return {};
  }

  /**
   * "This wasn't me": restores the reserved old address, signs everything out, and sends a reset
   * link there — the password is treated as compromised (ADR 0052). A deactivated account's revert
   * is not live; restoring that account is an admin's decision.
   */
  async revertEmailChange(
    request: identityGrpc.RevertEmailChangeRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RevertEmailChangeResponse> {
    const { token } = parseRpcRequest(tokenField, request);
    const now = new Date();
    const pending = await this.withAddressGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const link = await this.links.consume(tx, token, [ActionTokenPurpose.EMAIL_CHANGE_REVERT]);
        const restored = link.targetEmail;
        await tx.user.update({
          where: { id: link.userId },
          data: { email: restored, isEmailVerified: true, credentialsChangedAt: now },
          select: { id: true },
        });
        await this.links.invalidate(tx, link.userId, [ActionTokenPurpose.EMAIL_CHANGE], now);
        // LOGOUT_ALL: the nearest session reason; the audit row says why.
        const revokedFamilies = await this.sessions.revokeAllForUser(
          tx,
          link.userId,
          SessionRevokedReason.LOGOUT_ALL,
          { bumpCutoff: true, now },
        );
        const reset = await this.links.mint(tx, {
          userId: link.userId,
          purpose: ActionTokenPurpose.PASSWORD_RESET,
          targetEmail: restored,
          origin: context.origin,
          now,
        });
        const mail = await this.email.prepare(tx, {
          template: EmailTemplate.PASSWORD_RESET,
          eventId: reset.id,
          recipient: { userId: link.userId },
          data: {},
          links: { action: { path: 'resetPassword', token: reset.token } },
        });
        await this.audit(tx, link.userId, AuditAction.EMAIL_CHANGE_REVERTED, context.origin, now, {
          after: { revokedFamilies },
        });
        return mail;
      }),
    );
    this.dispatcher.run([pending]);
    return {};
  }

  /** `EMAIL_TAKEN` for an address in use, or reserved by a live revert (rdm-spec I-9). */
  private async requireAddressFree(tx: Prisma.TransactionClient, address: string): Promise<void> {
    const taken = await tx.user.findUnique({ where: { email: address }, select: { id: true } });
    if (taken !== null || (await this.links.liveRevertFor(tx, { email: address }))) {
      throw rpcError('EMAIL_TAKEN');
    }
  }

  /** The unique index is the guarantee; a race past the pre-check is still `EMAIL_TAKEN`. */
  private async withAddressGuard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('EMAIL_TAKEN');
      throw error;
    }
  }

  private async liveUser(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, isEmailVerified: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    return user;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: AuditAction,
    origin: RequestOrigin,
    now: Date,
    metadata: AuditFacts['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId },
        action,
        resource: { type: AuditResourceType.USER, id: userId },
        metadata,
        origin,
        now,
      }),
    );
  }
}
