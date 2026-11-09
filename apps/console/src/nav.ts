import type { PermissionCode } from '@wayfare/contracts';
import type { PlainKey } from './i18n/messages';

/** An icon the shell draws for an item, by its Lucide name (round 33's icon set). */
export type NavIcon =
  | 'house'
  | 'file-check'
  | 'user-check'
  | 'map-pin'
  | 'route'
  | 'tags'
  | 'layers'
  | 'audio-lines'
  | 'speech'
  | 'languages'
  | 'users'
  | 'life-buoy'
  | 'scroll-text'
  | 'store'
  | 'wallet'
  | 'bell'
  | 'package'
  | 'webhook'
  | 'chart-column';

/** One navigation item: its route, its label, and the read permission that shows it (K5). */
export interface NavItem {
  readonly href: string;
  readonly label: PlainKey;
  readonly icon: NavIcon;
  /** Any one of these shows it. */
  readonly anyOf: readonly PermissionCode[];
  /** The queue whose pending count it carries (K9). */
  readonly queue?: 'submissions' | 'registrations';
}

export interface NavGroup {
  readonly label: PlainKey;
  readonly items: readonly NavItem[];
}

/** The owner's group (C7): its items say "My", so two *Submissions* never sit side by side. */
const BUSINESS: NavGroup = {
  label: 'nav.group.business',
  items: [
    { href: '/owner/venues', label: 'nav.venues', icon: 'store', anyOf: ['owner.access'] },
    { href: '/owner/stats', label: 'nav.myStats', icon: 'chart-column', anyOf: ['owner.access'] },
    {
      href: '/owner/submissions',
      label: 'nav.mySubmissions',
      icon: 'file-check',
      anyOf: ['owner.access'],
    },
    { href: '/owner/billing', label: 'nav.billing', icon: 'wallet', anyOf: ['owner.access'] },
    {
      href: '/owner/notifications',
      label: 'nav.notifications',
      icon: 'bell',
      anyOf: ['owner.access'],
    },
  ],
};

/** The staff groups (C6), in the order of daily use: the queues first. */
const STAFF: readonly NavGroup[] = [
  {
    label: 'nav.group.review',
    items: [
      {
        href: '/submissions',
        label: 'nav.submissions',
        icon: 'file-check',
        anyOf: ['submission.read'],
        queue: 'submissions',
      },
      {
        href: '/registrations',
        label: 'nav.registrations',
        icon: 'user-check',
        anyOf: ['owner_registration.read'],
        queue: 'registrations',
      },
    ],
  },
  {
    label: 'nav.group.catalog',
    items: [
      { href: '/places', label: 'nav.places', icon: 'map-pin', anyOf: ['place.read'] },
      { href: '/tours', label: 'nav.tours', icon: 'route', anyOf: ['tour.manage'] },
      {
        href: '/categories',
        label: 'nav.categories',
        icon: 'tags',
        anyOf: ['catalog.taxonomy.manage'],
      },
      {
        href: '/areas',
        label: 'nav.areas',
        icon: 'layers',
        anyOf: ['catalog.taxonomy.manage', 'map_pack.manage'],
      },
    ],
  },
  {
    label: 'nav.group.narration',
    items: [
      {
        href: '/narration/jobs',
        label: 'nav.narrationJobs',
        icon: 'audio-lines',
        anyOf: ['narration.job.read'],
      },
      {
        href: '/narration/pronunciation',
        label: 'nav.pronunciation',
        icon: 'speech',
        anyOf: ['pronunciation.manage'],
      },
      {
        href: '/narration/corrections',
        label: 'nav.corrections',
        icon: 'languages',
        anyOf: ['localization.edit'],
      },
    ],
  },
  {
    label: 'nav.group.insights',
    items: [
      {
        href: '/analytics',
        label: 'nav.analytics',
        icon: 'chart-column',
        anyOf: ['analytics.read'],
      },
    ],
  },
  {
    label: 'nav.group.people',
    items: [
      { href: '/users', label: 'nav.users', icon: 'users', anyOf: ['user.read'] },
      {
        href: '/recoveries',
        label: 'nav.recoveries',
        icon: 'life-buoy',
        anyOf: ['user.email.recover.open', 'user.email.recover.approve'],
      },
      { href: '/audit', label: 'nav.audit', icon: 'scroll-text', anyOf: ['audit.read'] },
    ],
  },
  {
    label: 'nav.group.billing',
    items: [
      {
        href: '/billing/plans',
        label: 'nav.plans',
        icon: 'package',
        anyOf: ['billing.plan.manage'],
      },
      {
        href: '/billing/accounts',
        label: 'nav.billingAccounts',
        icon: 'wallet',
        anyOf: ['billing.account.read'],
      },
      {
        href: '/billing/events',
        label: 'nav.stripeEvents',
        icon: 'webhook',
        anyOf: ['billing.event.read'],
      },
    ],
  },
];

/**
 * Where an applicant's *Your business* stands until their registration is approved: no permission
 * gates it, since an applicant holds none — the ownership shows it (K1).
 */
const REGISTRATION: NavGroup = {
  label: 'nav.group.business',
  items: [{ href: '/owner/registration', label: 'nav.yourRegistration', icon: 'store', anyOf: [] }],
};

/** *Home*, always there. */
export const HOME: NavItem = { href: '/', label: 'nav.home', icon: 'house', anyOf: [] };

/** Every guarded route, for the server's own check (K5) and the C14 page's name. */
export const NAV_ITEMS: readonly NavItem[] = [
  ...BUSINESS.items,
  ...REGISTRATION.items,
  ...STAFF.flatMap((group) => group.items),
];

/** Whether the account is a venue owner: verified, applying, or neither (`/users/me`'s `owner`). */
export type Ownership = 'verified' | 'applicant' | null;

/**
 * An account's ownership in the console (K1): a verified owner; an *applicant* — one that has
 * applied, or holds no staff permission at all (a new account, a tourist), whose console is Home
 * and its registration; else staff, who never applied.
 */
export function ownershipOf(me: {
  readonly owner: unknown;
  readonly ownerVerified: boolean;
  readonly permissions: readonly string[];
}): Ownership {
  if (me.ownerVerified) return 'verified';
  const staff = me.permissions.some((code) => code !== 'owner.access');
  return me.owner !== null || !staff ? 'applicant' : null;
}

/**
 * The navigation a permission set shows (K5): an item without its permission is absent, not greyed
 * out; a group with no items is gone. *Your business* is an owner's — an admin holds its
 * permission without being one — and comes first for an owner who is also staff (C8a); an
 * applicant has their registration in its place.
 */
export function navigationFor(
  permissions: readonly string[],
  ownership: Ownership = null,
): NavGroup[] {
  const held = new Set(permissions);
  const business =
    ownership === 'verified' ? [BUSINESS] : ownership === 'applicant' ? [REGISTRATION] : [];
  return [...business, ...STAFF]
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.anyOf.length === 0 || item.anyOf.some((code) => held.has(code)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** The guarded item a path belongs to, if any. */
export function navItemFor(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => path === item.href || path.startsWith(`${item.href}/`));
}

/** Whether a permission set may open an item (K5). */
export function mayOpen(item: NavItem, permissions: readonly string[]): boolean {
  return item.anyOf.length === 0 || item.anyOf.some((code) => permissions.includes(code));
}
