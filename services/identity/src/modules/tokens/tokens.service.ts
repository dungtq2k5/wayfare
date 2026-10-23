import { createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCOUNT_ACCESS_TOKEN_TTL_MS,
  compareStrings,
  DEVICE_ACCESS_TOKEN_TTL_MS,
  TOKEN_TYPES,
} from '@wayfare/contracts';
import type { PROOF_TOKEN_TYPES } from '@wayfare/contracts';
import { signJws, verifyJws } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { dummyPasswordHash, hashPassword, verifyPassword } from './domain/password';

/** A signed access token and when it expires. */
export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** What an account access token asserts (api-endpoints-plan §0.1). */
export interface AccountTokenSubject {
  readonly userId: string;
  readonly sessionId: string;
  readonly deviceId: string | null;
  readonly permissions: readonly string[];
  readonly ownerVerified: boolean;
  readonly emailVerified: boolean;
}

/**
 * Signs access tokens and hashes passwords. identity is the only signer; the gateway holds the
 * public key only (ADR 0043).
 */
@Injectable()
export class TokensService implements OnModuleInit {
  private readonly privateKey: KeyObject;
  private readonly keyId: string;
  private readonly publicKeys: ReadonlyMap<string, KeyObject>;

  constructor(config: ConfigService<Env, true>) {
    this.privateKey = config.get('JWT_PRIVATE_KEY', { infer: true });
    this.keyId = config.get('JWT_KEY_ID', { infer: true });
    this.publicKeys = new Map([[this.keyId, createPublicKey(this.privateKey)]]);
  }

  /** Computes the dummy hash at boot, so the first unknown-email login is not the slow one. */
  async onModuleInit(): Promise<void> {
    await dummyPasswordHash();
  }

  /** A device access token (`typ: device`). */
  signDeviceToken(deviceId: string, now: Date): IssuedToken {
    return this.sign({ typ: TOKEN_TYPES.device, sub: deviceId }, DEVICE_ACCESS_TOKEN_TTL_MS, now);
  }

  /** An account access token (`typ: user`), with millisecond issue time and the session family. */
  signAccountToken(subject: AccountTokenSubject, now: Date): IssuedToken {
    return this.sign(
      {
        typ: TOKEN_TYPES.user,
        sub: subject.userId,
        iatMs: now.getTime(),
        sid: subject.sessionId,
        ...(subject.deviceId === null ? {} : { did: subject.deviceId }),
        perms: subject.permissions.toSorted(compareStrings),
        ov: subject.ownerVerified,
        ev: subject.emailVerified,
      },
      ACCOUNT_ACCESS_TOKEN_TTL_MS,
      now,
    );
  }

  hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  /** Verifies a password; with no stored hash, verifies against the dummy and returns false. */
  async verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
    if (passwordHash === null) {
      await verifyPassword(await dummyPasswordHash(), password);
      return false;
    }
    return verifyPassword(passwordHash, password);
  }

  /**
   * One of identity's short-lived proofs (a Google confirmation, a link ticket), signed like an
   * access token but of a type no bearer check accepts.
   */
  signProof(
    typ: ProofTokenType,
    claims: Readonly<Record<string, string>>,
    ttlMs: number,
    now: Date,
  ): IssuedToken {
    return this.sign({ ...claims, typ }, ttlMs, now);
  }

  /** A proof's claims when it is one of identity's, of this type; or why not. */
  verifyProof(
    typ: ProofTokenType,
    token: string,
    now: Date,
  ): { ok: true; claims: Record<string, unknown> } | { ok: false; expired: boolean } {
    const result = verifyJws(token, { publicKeys: this.publicKeys, now });
    if (!result.ok) return { ok: false, expired: result.reason === 'expired' };
    return result.claims.typ === typ ? result : { ok: false, expired: false };
  }

  private sign(claims: Record<string, unknown>, ttlMs: number, now: Date): IssuedToken {
    return signJws(claims, {
      privateKey: this.privateKey,
      keyId: this.keyId,
      ttlMs,
      now,
    });
  }
}

/** A proof's type. */
export type ProofTokenType = (typeof PROOF_TOKEN_TYPES)[keyof typeof PROOF_TOKEN_TYPES];
