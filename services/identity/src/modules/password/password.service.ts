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
import { actionTokenPurposeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { AccountLinksService } from '../account-links/account-links.service';
import { auditRecord } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { isPasswordTheEmail, zNewPassword } from '../tokens/domain/password';
import { TokensService } from '../tokens/tokens.service';

const zToken = z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH);
const RESET_PURPOSES = [ActionTokenPurpose.PASSWORD_RESET, ActionTokenPurpose.ACCOUNT_SETUP];

const forgotFields = z.object({ email: zEmail });
const tokenField = z.object({ token: zToken });
const resetFields = z.object({ token: zToken, newPassword: zNewPassword });
const changeFields = z.object({
  // Only the upper bound: a short current password is simply wrong.
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: zNewPassword,
});

const weakPassword = () =>
  rpcError('VALIDATION_FAILED', { issues: [{ path: '/newPassword', code: 'custom' }] });

/**
 * Password links and the signed-in change (api-endpoints-plan §1.2, rdm-spec I-9). Every flow
 * commits, answers, and only then sends (conventions §11.4).
 */
@Injectable()
export class PasswordService {
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
   * Always answers the same way. Both branches do the same database work — a lookup and a
   * transaction — and return before any send, so timing does not reveal the account.
   */
  async requestPasswordReset(
    request: identityGrpc.RequestPasswordResetRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RequestPasswordResetResponse> {
    const { email } = parseRpcRequest(forgotFields, request);
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true },
    });
    const pending = await this.prisma.$transaction(async (tx) => {
      const mail =
        user === null
          ? null
          : await this.links
              .mint(tx, {
                userId: user.id,
                purpose: ActionTokenPurpose.PASSWORD_RESET,
                targetEmail: user.email,
                origin: context.origin,
                now,
              })
              .then((link) =>
                this.email.prepare(tx, {
                  template: EmailTemplate.PASSWORD_RESET,
                  eventId: link.id,
                  recipient: { userId: user.id },
                  data: {},
                  links: { action: { path: 'resetPassword', token: link.token } },
                }),
              );
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.ANONYMOUS },
          action: AuditAction.PASSWORD_RESET_REQUESTED,
          resource: { type: AuditResourceType.USER, ...(user === null ? {} : { id: user.id }) },
          metadata: { after: { found: user !== null } },
          origin: context.origin,
          now,
        }),
      );
      return mail;
    });
    this.dispatcher.run([pending]);
    return {};
  }

  /** Whether a reset or setup link is live, so the page can choose its form. */
  async validateResetToken(
    request: identityGrpc.ValidateResetTokenRequest,
  ): Promise<identityGrpc.ValidateResetTokenResponse> {
    const { token } = parseRpcRequest(tokenField, request);
    const live = await this.links.inspect(this.prisma, token, RESET_PURPOSES);
    if (live === null) throw rpcError('TOKEN_EXPIRED');
    return {
      purpose: actionTokenPurposeProto.toProto(live.purpose),
      emailMasked: maskEmail(live.targetEmail),
    };
  }

  /**
   * Completes a reset or a setup link: sets the password, verifies the address the link proved,
   * and signs every session out. `credentials_changed_at` is stamped unless this is the first
   * password of a new account (rdm-spec I-1, I-9).
   */
  async completePasswordReset(
    request: identityGrpc.CompletePasswordResetRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CompletePasswordResetResponse> {
    const fields = parseRpcRequest(resetFields, request);
    const live = await this.links.inspect(this.prisma, fields.token, RESET_PURPOSES);
    if (live === null) throw rpcError('TOKEN_EXPIRED');
    if (isPasswordTheEmail(fields.newPassword, live.targetEmail)) throw weakPassword();
    // Hashed outside the transaction: argon2 is deliberately slow.
    const passwordHash = await this.tokens.hashPassword(fields.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const link = await this.links.consume(tx, fields.token, RESET_PURPOSES);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: link.userId },
        select: { passwordHash: true },
      });
      const hadPassword = user.passwordHash !== null;
      const firstSetup = link.purpose === ActionTokenPurpose.ACCOUNT_SETUP && !hadPassword;
      await tx.user.update({
        where: { id: link.userId },
        data: {
          passwordHash,
          isEmailVerified: true,
          ...(firstSetup ? {} : { credentialsChangedAt: now }),
        },
        select: { id: true },
      });
      const revokedFamilies = await this.sessions.revokeAllForUser(
        tx,
        link.userId,
        SessionRevokedReason.PASSWORD_CHANGED,
        { bumpCutoff: true, now },
      );
      await this.links.invalidate(tx, link.userId, RESET_PURPOSES, now);
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.USER, userId: link.userId },
          action: AuditAction.PASSWORD_RESET_COMPLETED,
          resource: { type: AuditResourceType.USER, id: link.userId },
          metadata: { after: { purpose: link.purpose, hadPassword, revokedFamilies } },
          origin: context.origin,
          now,
        }),
      );
    });
    return {};
  }

  /**
   * Changes the password of the signed-in account. Every other session ends; this one keeps
   * working, so there is no cutoff bump. Outstanding reset links die.
   */
  async changePassword(
    request: identityGrpc.ChangePasswordRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ChangePasswordResponse> {
    const account = requireAccountContext(context);
    const fields = parseRpcRequest(changeFields, request);
    const user = await this.prisma.user.findFirst({
      where: { id: account.userId, deletedAt: null },
      select: { email: true, passwordHash: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    if (!(await this.tokens.verifyPassword(user.passwordHash, fields.currentPassword))) {
      throw rpcError('CURRENT_PASSWORD_INCORRECT');
    }
    if (isPasswordTheEmail(fields.newPassword, user.email)) throw weakPassword();
    const passwordHash = await this.tokens.hashPassword(fields.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.userId },
        data: { passwordHash },
        select: { id: true },
      });
      const others = (await this.sessions.liveFamilies(tx, account.userId, now)).filter(
        (family) => family !== account.sessionId,
      );
      const revokedFamilies = await this.sessions.revokeFamilies(
        tx,
        account.userId,
        others,
        SessionRevokedReason.PASSWORD_CHANGED,
        now,
      );
      await this.links.invalidate(tx, account.userId, [ActionTokenPurpose.PASSWORD_RESET], now);
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.USER, userId: account.userId },
          action: AuditAction.PASSWORD_CHANGED,
          resource: { type: AuditResourceType.USER, id: account.userId },
          metadata: { after: { revokedFamilies } },
          origin: context.origin,
          now,
        }),
      );
    });
    return {};
  }
}
