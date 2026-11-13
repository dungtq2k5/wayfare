import { newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { toOwnerRegistration } from './owner-registration.mapper';
import type { OwnerRegistrationRow } from './owner-registration.mapper';

const row: OwnerRegistrationRow = {
  id: newId(),
  status: 'REJECTED',
  businessName: 'Quán Bún Chả',
  businessAddress: '12 Lê Lợi',
  businessRegistrationNo: null,
  contactName: 'An',
  contactPhone: '+84901234567',
  nationalIdLast4: null,
  applicantNote: null,
  decisionNote: 'Photo unreadable.',
  submittedAt: new Date('2026-09-01T00:00:00.000Z'),
  reviewedAt: new Date('2026-09-02T00:00:00.000Z'),
};

describe('toOwnerRegistration', () => {
  it('has no staff note key at all, even when the row carries one', () => {
    const withNote = { ...row, internalNote: 'Staff only.' } as OwnerRegistrationRow;
    const serialized = JSON.stringify(toOwnerRegistration(withNote));
    expect(serialized).not.toContain('internalNote');
    expect(serialized).not.toContain('Staff only.');
  });

  it('maps the status and leaves redacted and absent fields unset', () => {
    const view = toOwnerRegistration(row);
    expect(view.status).toBe(
      identityGrpc.OwnerRegistrationStatus.OWNER_REGISTRATION_STATUS_REJECTED,
    );
    expect(view).not.toHaveProperty('nationalIdLast4');
    expect(view).not.toHaveProperty('businessRegistrationNo');
    expect(view.decisionNote).toBe('Photo unreadable.');
  });
});
