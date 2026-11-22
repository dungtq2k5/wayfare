import { LegalDocument, LegalParty } from '@wayfare/contracts';
import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toLegalAcceptanceStatusResponseDto,
  toMeResponseDto,
  toUpdateMeRequest,
  toUserResponseDto,
} from './user.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const user = {
  id: 'u1',
  email: 'an@wayfare.test',
  preferredLocale: 'en',
  isEmailVerified: true,
  emailBounced: false,
  createdAt: ts,
} as identityGrpc.SessionUser;

describe('/users/me', () => {
  it('a tourist: no name, no owner, sign-in methods false where identity sends none', () => {
    expect(
      toMeResponseDto({
        user,
        roles: [],
        permissions: [],
        ownerVerified: false,
      } as unknown as identityGrpc.GetMeResponse),
    ).toMatchObject({
      user: { fullName: null },
      signIn: { password: false, google: false, googleEmail: null },
      owner: null,
    });
  });

  it('an owner with a pending registration, signed in with Google', () => {
    expect(
      toMeResponseDto({
        user: { ...user, fullName: 'An' },
        roles: ['OWNER'],
        permissions: [],
        ownerVerified: false,
        signIn: { password: true, google: true, googleEmail: 'an@gmail.test' },
        owner: { pendingRegistration: { id: 'r1', submittedAt: ts } },
      }),
    ).toMatchObject({
      user: { fullName: 'An' },
      signIn: { password: true, google: true, googleEmail: 'an@gmail.test' },
      owner: {
        billingSummary: null,
        pendingRegistration: { id: 'r1', submittedAt: at.toISOString() },
      },
    });
  });

  it('an owner with nothing pending', () => {
    expect(
      toMeResponseDto({
        user,
        roles: [],
        permissions: [],
        ownerVerified: true,
        owner: {},
      } as unknown as identityGrpc.GetMeResponse).owner,
    ).toEqual({ billingSummary: null, pendingRegistration: null });
  });

  it('refuses an answer without its user', () => {
    expect(() => toUserResponseDto(undefined)).toThrow('without its user');
  });

  it('updates only what the body carries', () => {
    expect(toUpdateMeRequest({})).toEqual({});
    expect(toUpdateMeRequest({ fullName: 'An', preferredLocale: 'vi' })).toEqual({
      fullName: 'An',
      preferredLocale: 'vi',
    });
  });
});

describe('a legal acceptance’s status', () => {
  const acceptance = {
    party: legalPartyProto.toProto(LegalParty.USER),
    document: legalDocumentProto.toProto(LegalDocument.TERMS_OF_SERVICE),
    version: '2026-01',
    acceptedAt: ts,
    current: true,
  } as identityGrpc.LegalAcceptance;

  it('reads the party and document, and refuses either when this build doesn’t know it', () => {
    expect(toLegalAcceptanceStatusResponseDto(acceptance)).toEqual({
      party: LegalParty.USER,
      document: LegalDocument.TERMS_OF_SERVICE,
      version: '2026-01',
      acceptedAt: at.toISOString(),
      current: true,
    });
    expect(() => toLegalAcceptanceStatusResponseDto({ ...acceptance, party: 99 as never })).toThrow(
      'unknown enum value',
    );
    expect(() =>
      toLegalAcceptanceStatusResponseDto({ ...acceptance, document: 99 as never }),
    ).toThrow('unknown enum value');
  });
});
