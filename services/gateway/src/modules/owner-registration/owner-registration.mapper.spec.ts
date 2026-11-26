import { OwnerRegistrationStatus } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toOwnerRegistration, toSubmitRegistrationRequest } from './owner-registration.mapper';

const registration = (over: Partial<identityGrpc.OwnerRegistration> = {}) =>
  ({
    id: 'r1',
    status: ownerRegistrationStatusProto.toProto(OwnerRegistrationStatus.PENDING),
    businessName: 'Phở Hà',
    businessAddress: '1 Lê Lợi',
    contactName: 'Hà',
    contactPhone: '0900000000',
    submittedAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    ...over,
  }) as identityGrpc.OwnerRegistration;

describe('the applicant’s registration', () => {
  it('reads absent optionals as null, present ones as themselves', () => {
    expect(toOwnerRegistration(registration())).toMatchObject({
      status: OwnerRegistrationStatus.PENDING,
      businessRegistrationNo: null,
      nationalIdLast4: null,
      applicantNote: null,
      decisionNote: null,
      reviewedAt: null,
    });
    expect(
      toOwnerRegistration(registration({ nationalIdLast4: '1234', businessRegistrationNo: 'B1' })),
    ).toMatchObject({ nationalIdLast4: '1234', businessRegistrationNo: 'B1' });
  });

  it('refuses no registration, and a status this build doesn’t know', () => {
    expect(() => toOwnerRegistration(undefined)).toThrow('without its registration');
    expect(() => toOwnerRegistration(registration({ status: 99 as never }))).toThrow(
      'unknown status',
    );
  });

  it('submits only the optional fields the body carries', () => {
    const body = {
      businessName: 'Phở Hà',
      businessAddress: '1 Lê Lợi',
      contactName: 'Hà',
      contactPhone: '0900000000',
      nationalId: '012345678901',
      ownerAgreementVersion: '2026-01',
    };
    expect(toSubmitRegistrationRequest(body)).toEqual(body);
    expect(
      toSubmitRegistrationRequest({ ...body, businessRegistrationNo: 'B1', applicantNote: 'n' }),
    ).toEqual({ ...body, businessRegistrationNo: 'B1', applicantNote: 'n' });
  });
});
