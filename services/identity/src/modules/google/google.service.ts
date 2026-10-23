import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionTokenPurpose,
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
  GOOGLE_CONFIRMATION_TTL_MS,
  GOOGLE_LINK_TICKET_TTL_MS,
  GOOGLE_NONCE_TTL_MS,
  GoogleOutcome,
  IdentityProvider,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  LegalParty,
  MAX_FULL_NAME_LENGTH,
  MAX_GOOGLE_TOKEN_LENGTH,
  newId,
  normalizeEmail,
  normalizeText,
  PROOF_TOKEN_TYPES,
  SessionClient,
  SessionRevokedReason,
  SystemRole,
  zEmail,
  zLanguage,
} from '@wayfare/contracts';
import { googleOutcomeProto, sessionClientProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  deviceIdOf,
  generateToken,
  hashToken,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { AccessService } from '../access/access.service';
import { AccountLinksService } from '../account-links/account-links.service';
import { auditRecord } from '../audit/domain/audit-record';
import { AuthService } from '../auth/auth.service';
import { toSession } from '../auth/session.mapper';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { LegalService } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SESSION_ACCOUNT_SELECT, SessionsService } from '../sessions/sessions.service';
import type { OpenedSession } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';
import { isLockActive } from '../users/domain/account-state';
import {
  checkIdToken,
  idTokenKeyId,
  isGoogleAuthoritative,
  signFakeIdToken,
} from './domain/id-token';
import type { GoogleClaims } from './domain/id-token';
import { proveItsYou } from './domain/prove-its-you';
import type { GoogleKeys } from './domain/google-keys';

/** Injection token for the verifier's key source: Google's, or the fake issuer's. */
export const GOOGLE_KEYS = Symbol('GOOGLE_KEYS');

/** The audience a fake token carries when no server client id is configured. */
const FAKE_AUDIENCE = 'wayfare-fake-server-client';

const zGoogleToken = z.string().min(1).max(MAX_GOOGLE_TOKEN_LENGTH);
const signInFields = z.object({ idToken: zGoogleToken, preferredLocale: zLanguage });
const mintFields = z.object({
  email: zEmail,
  name: z.string().max(MAX_FULL_NAME_LENGTH).optional(),
  sub: z.string().min(1).max(255).optional(),
  emailVerified: z.boolean(),
  hd: z.string().max(253).optional(),
  nonce: z.string().min(1).max(256),
});

const ACCOUNT_SELECT = {
  ...SESSION_ACCOUNT_SELECT,
  passwordHash: true,
  deletedAt: true,
  isLocked: true,
  lockedUntil: true,
} as const satisfies Prisma.UserSelect;

/** The roles a Google sign-in may serve; anyone holding another is staff (ADR 0063). */
const GOOGLE_ROLES: ReadonlySet<string> = new Set([SystemRole.USER, SystemRole.VENUE_OWNER]);

const nonceKey = (nonce: string) => `identity:google-nonce:${hashToken(nonce)}`;

/**
 * Continue with Google (ADRs 0062–0064, api-endpoints-plan §1.2): one verified ID token, carrying a
 * nonce this service gave the caller's device, signs in, creates, links — or, for an address
 * Google does not own, asks for the Wayfare password first. Never for staff.
 */
@Injectable()
export class GoogleService {
  private readonly audience: string;
  private readonly fake: KeyObject | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
    private readonly legal: LegalService,
    private readonly sessions: SessionsService,
    private readonly links: AccountLinksService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
    private readonly auth: AuthService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(GOOGLE_KEYS) private readonly keys: GoogleKeys,
    config: ConfigService<Env, true>,
  ) {
    const fake = config.get('GOOGLE_ISSUER', { infer: true }) === 'fake';
    this.fake = fake ? (config.get('GOOGLE_FAKE_SIGNING_KEY', { infer: true }) ?? null) : null;
    this.audience =
      config.get('GOOGLE_SERVER_CLIENT_ID', { infer: true }) ?? (fake ? FAKE_AUDIENCE : '');
  }

  /** A nonce for the caller's device, for the next ID token it asks Google for. */
  async nonce(context: RequestContext): Promise<identityGrpc.GoogleNonceResponse> {
    const deviceId = deviceIdOf(context);
    if (deviceId === null) throw rpcError('UNAUTHENTICATED');
    const nonce = generateToken();
    await this.redis.set(nonceKey(nonce), deviceId, 'PX', GOOGLE_NONCE_TTL_MS);
    return { nonce };
  }

  /** K6: every edge between a password and Google, one transaction each. */
  async signIn(
    request: identityGrpc.GoogleSignInRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GoogleSignInResponse> {
    const fields = parseRpcRequest(signInFields, request);
    const client = requireProtoEnum(sessionClientProto, request.client, '/client');
    const deviceId = deviceIdOf(context);
    if (deviceId === null) throw rpcError('UNAUTHENTICATED');
    const claims = await this.verify(fields.idToken, deviceId);
    const email = normalizeEmail(claims.email);
    const now = new Date();

    const linked = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: IdentityProvider.GOOGLE, subject: claims.sub } },
      select: { user: { select: ACCOUNT_SELECT } },
    });
    if (linked !== null) {
      const user = linked.user;
      await this.requireUsable(user, now);
      const session = await this.prisma.$transaction(async (tx) => {
        await this.touchLogin(tx, user, now);
        const opened = await this.auth.signIn(tx, user, client, context, now);
        await this.audit(tx, user.id, AuditAction.USER_LOGIN, context, now, {
          client,
          deviceClaimed: opened.deviceClaimed,
        });
        return opened.session;
      });
      return this.answer(session, GoogleOutcome.SIGNED_IN);
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { ...ACCOUNT_SELECT, isEmailVerified: true },
    });
    if (existing === null)
      return this.create(claims, email, fields.preferredLocale, client, context);

    // Never a link to a closed account; never to staff; one Google account per Wayfare account.
    if (existing.deletedAt !== null) throw rpcError('ACCOUNT_DEACTIVATED');
    await this.requireNotStaff(existing.id);
    const other = await this.prisma.userIdentity.findUnique({
      where: { userId_provider: { userId: existing.id, provider: IdentityProvider.GOOGLE } },
      select: { id: true },
    });
    if (other !== null) throw rpcError('GOOGLE_ACCOUNT_ALREADY_LINKED');
    // ADR 0064: only where Google owns the mailbox does the link make itself.
    if (!isGoogleAuthoritative(email, claims.hd)) {
      const ticket = this.tokens.signProof(
        PROOF_TOKEN_TYPES.googleLinkTicket,
        { sub: claims.sub, email, did: deviceId },
        GOOGLE_LINK_TICKET_TTL_MS,
        now,
      );
      throw rpcError('GOOGLE_LINK_NEEDS_PASSWORD', { linkTicket: ticket.token });
    }
    if (isLockActive(existing, now)) throw rpcError('ACCOUNT_LOCKED');

    const passwordRemoved = !existing.isEmailVerified;
    const { session, notice } = await this.prisma.$transaction(async (tx) => {
      await tx.userIdentity.create({
        data: {
          userId: existing.id,
          provider: IdentityProvider.GOOGLE,
          subject: claims.sub,
          emailAtLink: email,
        },
        select: { id: true },
      });
      let revokedFamilies = 0;
      let removed = null;
      if (passwordRemoved) {
        // The address was never confirmed: whoever set its password never proved the mailbox.
        await tx.user.update({
          where: { id: existing.id },
          data: { isEmailVerified: true, passwordHash: null, credentialsChangedAt: now },
          select: { id: true },
        });
        revokedFamilies = await this.sessions.revokeAllForUser(
          tx,
          existing.id,
          SessionRevokedReason.PASSWORD_CHANGED,
          { bumpCutoff: true, now },
        );
        await this.links.invalidate(
          tx,
          existing.id,
          [
            ActionTokenPurpose.PASSWORD_RESET,
            ActionTokenPurpose.EMAIL_VERIFICATION,
            ActionTokenPurpose.EMAIL_CHANGE,
            ActionTokenPurpose.EMAIL_CHANGE_REVERT,
          ],
          now,
        );
        removed = await this.email.prepare(tx, {
          template: EmailTemplate.GOOGLE_PASSWORD_REMOVED,
          eventId: newId(),
          recipient: { userId: existing.id, email },
          data: {},
          links: {},
        });
      } else {
        await tx.user.update({
          where: { id: existing.id },
          data: { credentialsChangedAt: now },
          select: { id: true },
        });
      }
      await this.touchLogin(tx, existing, now);
      const opened = await this.auth.signIn(
        tx,
        { ...existing, isEmailVerified: true },
        client,
        context,
        now,
      );
      await this.audit(tx, existing.id, AuditAction.GOOGLE_LINKED, context, now, {
        client,
        passwordRemoved,
        revokedFamilies,
      });
      return { session: opened.session, notice: removed };
    });
    this.dispatcher.run([notice]);
    return this.answer(
      session,
      passwordRemoved ? GoogleOutcome.LINKED_PASSWORD_REMOVED : GoogleOutcome.LINKED,
    );
  }

  /** K5: a fresh token for the caller's own linked Google account, in place of the password. */
  async confirm(
    request: identityGrpc.GoogleConfirmRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GoogleConfirmResponse> {
    const account = requireAccountContext(context);
    const idToken = parseRpcRequest(zGoogleToken, request.idToken);
    if (account.deviceId === null) throw rpcError('UNAUTHENTICATED');
    const claims = await this.verify(idToken, account.deviceId);
    const link = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: IdentityProvider.GOOGLE, subject: claims.sub } },
      select: { userId: true },
    });
    if (link?.userId !== account.userId) throw rpcError('GOOGLE_ACCOUNT_MISMATCH');
    const proof = this.tokens.signProof(
      PROOF_TOKEN_TYPES.googleConfirmation,
      { sub: account.userId, sid: account.sessionId },
      GOOGLE_CONFIRMATION_TTL_MS,
      new Date(),
    );
    return { confirmation: proof.token };
  }

  /** K22: links the ticket's Google account to the caller, signed in with the password just now. */
  async link(
    request: identityGrpc.GoogleLinkRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GoogleLinkResponse> {
    const account = requireAccountContext(context);
    const ticket = parseRpcRequest(zGoogleToken, request.linkTicket);
    const now = new Date();
    const proof = this.tokens.verifyProof(PROOF_TOKEN_TYPES.googleLinkTicket, ticket, now);
    const claims = proof.ok ? proof.claims : null;
    if (
      claims === null ||
      typeof claims.sub !== 'string' ||
      typeof claims.email !== 'string' ||
      claims.did !== account.deviceId
    ) {
      throw rpcError('CONFIRMATION_EXPIRED');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: account.userId, deletedAt: null },
      select: { email: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    if (user.email !== claims.email) throw rpcError('GOOGLE_ACCOUNT_MISMATCH');
    await this.requireNotStaff(account.userId);
    const subject = claims.sub;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.userIdentity.create({
          data: {
            userId: account.userId,
            provider: IdentityProvider.GOOGLE,
            subject,
            emailAtLink: user.email,
          },
          select: { id: true },
        });
        await tx.user.update({
          where: { id: account.userId },
          data: { credentialsChangedAt: now },
          select: { id: true },
        });
        await this.audit(tx, account.userId, AuditAction.GOOGLE_LINKED, context, now, {
          passwordRemoved: false,
        });
      });
    } catch (error) {
      // Either side already linked: one Google account per Wayfare account, and back.
      if (isUniqueConstraintViolation(error)) throw rpcError('GOOGLE_ACCOUNT_ALREADY_LINKED');
      throw error;
    }
    return {};
  }

  /**
   * K8: removes the Google link, with the password or a confirmation. Never from an account with no
   * password — it would have no way in. Every other session ends; this one stays.
   */
  async unlink(
    request: identityGrpc.UnlinkGoogleRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UnlinkGoogleResponse> {
    const account = requireAccountContext(context);
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: { id: account.userId, deletedAt: null },
      select: { passwordHash: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    const link = await this.prisma.userIdentity.findUnique({
      where: { userId_provider: { userId: account.userId, provider: IdentityProvider.GOOGLE } },
      select: { id: true },
    });
    if (link === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'USER_IDENTITY' });
    if (user.passwordHash === null) throw rpcError('PASSWORD_REQUIRED');
    await proveItsYou(
      this.tokens,
      request,
      { userId: account.userId, sessionId: account.sessionId, passwordHash: user.passwordHash },
      now,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.userIdentity.delete({ where: { id: link.id }, select: { id: true } });
      await tx.user.update({
        where: { id: account.userId },
        data: { credentialsChangedAt: now },
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
      await this.audit(tx, account.userId, AuditAction.GOOGLE_UNLINKED, context, now, {
        revokedFamilies,
      });
    });
    return {};
  }

  /** Development only (ADR 0063): a token from the fake issuer, as Google would sign it. */
  mintFake(
    request: identityGrpc.MintFakeGoogleTokenRequest,
  ): identityGrpc.MintFakeGoogleTokenResponse {
    if (this.fake === null)
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'FAKE_GOOGLE_ISSUER' });
    const fields = parseRpcRequest(mintFields, request);
    const sub =
      fields.sub ?? `fake-${createHash('sha256').update(fields.email).digest('hex').slice(0, 21)}`;
    const idToken = signFakeIdToken(
      this.fake,
      {
        sub,
        email: fields.email,
        emailVerified: fields.emailVerified,
        name: fields.name ?? null,
        hd: fields.hd ?? null,
        nonce: fields.nonce,
      },
      { audience: this.audience, now: new Date() },
    );
    return { idToken };
  }

  /**
   * Verifies an ID token (K2) and spends its nonce, which must be one this service gave the
   * caller's device: a captured token is good neither on another device nor twice.
   */
  private async verify(idToken: string, deviceId: string): Promise<GoogleClaims> {
    const keyId = idTokenKeyId(idToken);
    const key = keyId === null ? undefined : await this.keys.key(keyId);
    if (key === 'unavailable') throw rpcError('GOOGLE_UNAVAILABLE');
    const check = checkIdToken(idToken, key, { audience: this.audience, now: new Date() });
    if (!check.ok) throw rpcError('INVALID_GOOGLE_TOKEN', { reason: check.reason });
    const { nonce } = check.claims;
    const owner = nonce === null ? null : await this.redis.getdel(nonceKey(nonce));
    if (owner !== deviceId) throw rpcError('INVALID_GOOGLE_TOKEN', { reason: 'NONCE' });
    return check.claims;
  }

  /** K6's `CREATED`: a verified, password-less account, its terms accepted by continuing. */
  private async create(
    claims: GoogleClaims,
    email: string,
    preferredLocale: string,
    client: SessionClient,
    context: RequestContext,
  ): Promise<identityGrpc.GoogleSignInResponse> {
    // An address a live revert reserves is taken, as register answers (rdm-spec I-9).
    if (await this.links.liveRevertFor(this.prisma, { email })) throw rpcError('EMAIL_TAKEN');
    const fullName =
      claims.name === null
        ? null
        : normalizeText(claims.name).slice(0, MAX_FULL_NAME_LENGTH) || null;
    const now = new Date();
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: null, isEmailVerified: true, fullName, preferredLocale },
          select: SESSION_ACCOUNT_SELECT,
        });
        await this.access.assignRole(tx, user.id, SystemRole.USER);
        await this.legal.record(
          tx,
          { party: LegalParty.USER, userId: user.id },
          LegalDocument.TERMS_OF_SERVICE,
          LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
          context.origin.ip,
        );
        await tx.userIdentity.create({
          data: {
            userId: user.id,
            provider: IdentityProvider.GOOGLE,
            subject: claims.sub,
            emailAtLink: email,
          },
          select: { id: true },
        });
        await this.audit(tx, user.id, AuditAction.USER_REGISTERED, context, now, {
          preferredLocale,
          client,
        });
        await this.audit(tx, user.id, AuditAction.GOOGLE_LINKED, context, now, {
          client,
          passwordRemoved: false,
        });
        return (await this.auth.signIn(tx, user, client, context, now)).session;
      });
      return this.answer(session, GoogleOutcome.CREATED);
    } catch (error) {
      // Another sign-in took the address or the Google account in the meantime.
      if (isUniqueConstraintViolation(error)) throw rpcError('EMAIL_TAKEN');
      throw error;
    }
  }

  /** A linked account must be open, unlocked and no staff member's. */
  private async requireUsable(
    user: { id: string; deletedAt: Date | null; isLocked: boolean; lockedUntil: Date | null },
    now: Date,
  ): Promise<void> {
    if (user.deletedAt !== null) throw rpcError('ACCOUNT_DEACTIVATED');
    await this.requireNotStaff(user.id);
    if (isLockActive(user, now)) throw rpcError('ACCOUNT_LOCKED');
  }

  /** ADR 0063: Google sign-in is for tourists and owners, never staff. */
  private async requireNotStaff(userId: string): Promise<void> {
    const { roles } = await this.access.accessOf(this.prisma, userId);
    if (roles.some((role) => !GOOGLE_ROLES.has(role))) throw rpcError('GOOGLE_SIGN_IN_NOT_ALLOWED');
  }

  /** As login does: the time, and a lapsed lock cleared. */
  private async touchLogin(
    tx: Prisma.TransactionClient,
    user: { id: string; isLocked: boolean },
    now: Date,
  ): Promise<void> {
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        ...(user.isLocked ? { isLocked: false, lockedUntil: null, lockReason: null } : {}),
      },
      select: { id: true },
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: AuditAction,
    context: RequestContext,
    now: Date,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId },
        action,
        resource: { type: AuditResourceType.USER, id: userId },
        metadata: { after },
        origin: context.origin,
        now,
      }),
    );
  }

  private answer(
    session: OpenedSession,
    outcome: GoogleOutcome,
  ): identityGrpc.GoogleSignInResponse {
    return { session: toSession(session), outcome: googleOutcomeProto.toProto(outcome) };
  }
}
