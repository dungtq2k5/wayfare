import { SYSTEM_ROLE_GRANTS, SystemRole } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { mayOpen, navItemFor, navigationFor, ownershipOf } from './nav';
import type { Ownership } from './nav';

const labels = (permissions: readonly string[], ownership: Ownership = null) =>
  navigationFor(permissions, ownership).map((group) => [
    group.label,
    group.items.map((item) => item.label),
  ]);

describe('the navigation (K5)', () => {
  it('gives an admin every staff group, queues first (C6)', () => {
    expect(labels(SYSTEM_ROLE_GRANTS[SystemRole.ADMIN])).toEqual([
      ['nav.group.review', ['nav.submissions', 'nav.registrations']],
      ['nav.group.catalog', ['nav.places', 'nav.tours', 'nav.categories', 'nav.areas']],
      ['nav.group.narration', ['nav.narrationJobs', 'nav.pronunciation', 'nav.corrections']],
      ['nav.group.people', ['nav.users', 'nav.recoveries', 'nav.audit']],
      ['nav.group.billing', ['nav.billingAccounts', 'nav.stripeEvents']],
    ]);
  });

  it('gives a super admin *Plans* too, last group (K11)', () => {
    expect(labels(SYSTEM_ROLE_GRANTS[SystemRole.SUPER_ADMIN]).at(-1)).toEqual([
      'nav.group.billing',
      ['nav.plans', 'nav.billingAccounts', 'nav.stripeEvents'],
    ]);
  });

  it('gives an owner its business only (C7)', () => {
    expect(labels(SYSTEM_ROLE_GRANTS[SystemRole.VENUE_OWNER], 'verified')).toEqual([
      [
        'nav.group.business',
        ['nav.venues', 'nav.mySubmissions', 'nav.billing', 'nav.notifications'],
      ],
    ]);
  });

  it('gives an applicant their registration in its place, and an admin no business', () => {
    expect(labels([], 'applicant')).toEqual([['nav.group.business', ['nav.yourRegistration']]]);
    expect(labels(SYSTEM_ROLE_GRANTS[SystemRole.ADMIN]).map(([group]) => group)).not.toContain(
      'nav.group.business',
    );
  });

  it('puts the business first for an owner who is also staff (C8a)', () => {
    expect(
      labels([...SYSTEM_ROLE_GRANTS[SystemRole.VENUE_OWNER], 'submission.read'], 'verified').map(
        ([group]) => group,
      ),
    ).toEqual(['nav.group.business', 'nav.group.review']);
  });

  it('leaves out what a narrow role lacks, and the groups it empties (C8b)', () => {
    expect(labels(['submission.read'])).toEqual([['nav.group.review', ['nav.submissions']]]);
    expect(labels(['user.email.recover.approve'])).toEqual([
      ['nav.group.people', ['nav.recoveries']],
    ]);
    expect(labels([])).toEqual([]);
  });

  it('finds the guarded item of a path, and whether it may be opened', () => {
    const places = navItemFor('/places/0190a0b0-0000-7000-8000-000000000000');
    expect(places?.label).toBe('nav.places');
    expect(mayOpen(places!, ['submission.read'])).toBe(false);
    expect(mayOpen(places!, ['place.read'])).toBe(true);
    expect(navItemFor('/account')).toBeUndefined();
  });
});

describe("an account's ownership (K1)", () => {
  const owner = { status: 'PENDING' };
  it('makes an applicant of any account without staff permissions, applied or not', () => {
    expect(ownershipOf({ owner: null, ownerVerified: false, permissions: [] })).toBe('applicant');
    expect(ownershipOf({ owner, ownerVerified: false, permissions: [] })).toBe('applicant');
    expect(ownershipOf({ owner, ownerVerified: false, permissions: ['submission.read'] })).toBe(
      'applicant',
    );
  });

  it('keeps a verified owner and staff who never applied apart', () => {
    expect(
      ownershipOf({ owner, ownerVerified: true, permissions: ['owner.access', 'place.read'] }),
    ).toBe('verified');
    expect(ownershipOf({ owner: null, ownerVerified: false, permissions: ['place.read'] })).toBe(
      null,
    );
  });

  it('shows an applicant Home and *Your registration*, a verified owner *Your business*', () => {
    expect(labels([], ownershipOf({ owner: null, ownerVerified: false, permissions: [] }))).toEqual(
      [['nav.group.business', ['nav.yourRegistration']]],
    );
    expect(labels(['owner.access', 'place.read'], 'verified').map(([group]) => group)).toEqual([
      'nav.group.business',
      'nav.group.catalog',
    ]);
  });
});
