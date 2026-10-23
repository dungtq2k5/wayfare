import { SYSTEM_ROLE_GRANTS, SystemRole } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { mayOpen, navItemFor, navigationFor } from './nav';
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
      ['nav.group.catalog', ['nav.places', 'nav.categories', 'nav.areas']],
      ['nav.group.narration', ['nav.narrationJobs', 'nav.pronunciation', 'nav.corrections']],
      ['nav.group.people', ['nav.users', 'nav.recoveries', 'nav.audit']],
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
    expect(labels(SYSTEM_ROLE_GRANTS[SystemRole.VENUE_OWNER], 'applicant')).toEqual([
      ['nav.group.business', ['registration.soonTitle']],
    ]);
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
