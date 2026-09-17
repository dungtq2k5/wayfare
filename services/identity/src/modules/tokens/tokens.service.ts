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
import { signJws } from '@wayfare/nest-common';
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

  constructor(config: ConfigService<Env, true>) {
    this.privateKey = config.get('JWT_PRIVATE_KEY', { infer: true });
    this.keyId = config.get('JWT_KEY_ID', { infer: true });
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

  private sign(claims: Record<string, unknown>, ttlMs: number, now: Date): IssuedToken {
    return signJws(claims, {
      privateKey: this.privateKey,
      keyId: this.keyId,
      ttlMs,
      now,
    });
  }
}
