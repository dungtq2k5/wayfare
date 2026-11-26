import { OwnerRegistrationStatus } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toListRegistrationsRequest,
  toOwnerRegistrationAdmin,
  toOwnerRegistrationAdminItem,
} from './admin-owner-registration.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const status = (s: OwnerRegistrationStatus) => ownerRegistrationStatusProto.toProto(s);
const registration = {
  id: 'r1',
  status: status(OwnerRegistrationStatus.PENDING),
  businessName: 'Phở Hà',
  businessAddress: '1 Lê Lợi',
  contactName: 'Hà',
  contactPhone: '0900000000',
  submittedAt: ts,
} as identityGrpc.OwnerRegistration;

describe('the registration queue', () => {
  it('asks by status, with a search only when given', () => {
    const query = { page: 1, pageSize: 20, status: OwnerRegistrationStatus.PENDING };
    expect(toListRegistrationsRequest(query as never)).toEqual({
      page: { page: 1, pageSize: 20, sort: '' },
      status: status(OwnerRegistrationStatus.PENDING),
    });
    expect(toListRegistrationsRequest({ ...query, q: 'phở' })).toMatchObject({
      page: { q: 'phở' },
    });
  });

  it('reads a row’s absent note, reviewer and applicant name as null', () => {
    expect(
      toOwnerRegistrationAdminItem({
        registration,
        piiRedacted: false,
        applicant: { id: 'u1', email: 'ha@wayfare.test' },
      }),
    ).toMatchObject({
      internalNote: null,
      reviewedById: null,
      applicant: { id: 'u1', fullName: null },
    });
  });

  it('refuses a row without its applicant', () => {
    expect(() =>
      toOwnerRegistrationAdminItem({ registration } as identityGrpc.OwnerRegistrationAdminItem),
    ).toThrow('without its applicant');
  });
});

describe('the review detail', () => {
  const applicant = {
    id: 'u1',
    email: 'ha@wayfare.test',
    createdAt: ts,
    emailVerified: true,
    ownerVerified: false,
    isLocked: false,
    deactivated: false,
  };

  it('reads the prior applications, a reviewed one with its date, and redaction when done', () => {
    expect(
      toOwnerRegistrationAdmin({
        registration,
        piiRedacted: true,
        piiRedactedAt: ts,
        internalNote: 'n',
        reviewedById: 's1',
        applicant: { ...applicant, fullName: 'Hà' },
        priorApplications: [
          {
            id: 'r0',
            status: status(OwnerRegistrationStatus.REJECTED),
            submittedAt: ts,
            reviewedAt: ts,
          },
          { id: 'r00', status: status(OwnerRegistrationStatus.PENDING), submittedAt: ts },
        ],
      } as identityGrpc.OwnerRegistrationAdmin),
    ).toMatchObject({
      internalNote: 'n',
      reviewedById: 's1',
      piiRedactedAt: at.toISOString(),
      applicant: { fullName: 'Hà', createdAt: at.toISOString() },
      priorApplications: [
        { status: OwnerRegistrationStatus.REJECTED, reviewedAt: at.toISOString() },
        { reviewedAt: null },
      ],
    });
  });

  it('refuses a detail without its applicant, or none at all', () => {
    expect(() => toOwnerRegistrationAdmin(undefined)).toThrow('without its registration');
    expect(() =>
      toOwnerRegistrationAdmin({
        registration,
        priorApplications: [],
      } as unknown as identityGrpc.OwnerRegistrationAdmin),
    ).toThrow('without its registration');
  });
});
