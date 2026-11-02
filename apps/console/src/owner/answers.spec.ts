import { OwnerRegistrationStatus } from '@wayfare/contracts';
import type { OwnerRegistration } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { initialAnswers, registrationValues } from './answers';

const rejected: OwnerRegistration = {
  id: '0190a0b0-0000-7000-8000-000000000001',
  status: OwnerRegistrationStatus.REJECTED,
  businessName: 'Ốc Ngọc Vĩnh Khánh',
  businessAddress: '212 Vĩnh Khánh, Phường 10, Quận 4',
  businessRegistrationNo: null,
  contactName: 'Trần Bảo Ngọc',
  contactPhone: '+84908123456',
  nationalIdLast4: '0123',
  applicantNote: 'Since 2015.',
  decisionNote: 'Add the registration number.',
  submittedAt: '2026-10-30T08:00:00.000Z',
  reviewedAt: '2026-10-31T08:00:00.000Z',
};

describe('applying again (K2)', () => {
  it('fills the latest answers in, and never the national ID', () => {
    expect(initialAnswers(rejected)).toEqual({
      businessName: 'Ốc Ngọc Vĩnh Khánh',
      businessAddress: '212 Vĩnh Khánh, Phường 10, Quận 4',
      businessRegistrationNo: '',
      contactName: 'Trần Bảo Ngọc',
      contactPhone: '090 812 3456',
      nationalId: '',
      applicantNote: 'Since 2015.',
    });
    expect(
      initialAnswers({ ...rejected, status: OwnerRegistrationStatus.WITHDRAWN }).businessName,
    ).toBe('Ốc Ngọc Vĩnh Khánh');
  });

  it('starts empty for a first application, or while one waits', () => {
    expect(initialAnswers(null).businessName).toBe('');
    expect(
      initialAnswers({ ...rejected, status: OwnerRegistrationStatus.PENDING }).businessName,
    ).toBe('');
  });

  it('sends the phone in E.164 and leaves blank optional answers out', () => {
    const values = registrationValues({ ...initialAnswers(rejected), nationalId: '079201000123' });
    expect(values).toMatchObject({
      contactPhone: '+84908123456',
      nationalId: '079201000123',
      businessRegistrationNo: undefined,
    });
  });
});
