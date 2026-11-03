import { Globe, MapPinned, Navigation, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translator } from '../i18n/messages';

/** Directions, Google Maps, Call, Website (WQ1): each opens the phone's own app or the browser. */
export function QuickActions({
  location,
  name,
  phone,
  website,
  t,
}: {
  location: { lat: number; lng: number };
  name: string;
  phone: string | null;
  website: string | null;
  t: Translator['t'];
}) {
  const point = `${location.lat},${location.lng}`;
  const action = (href: string, label: string, icon: ReactNode, external: boolean) => (
    <li className="flex min-w-0 flex-1">
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="flex w-full flex-col items-center gap-1 rounded-md py-1 text-center text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </span>
        {label}
      </a>
    </li>
  );
  return (
    <ul className="flex gap-2">
      {action(
        `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}`,
        t('place.directions'),
        <Navigation aria-hidden className="size-6" />,
        true,
      )}
      {action(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${point}`)}`,
        t('place.googleMaps'),
        <MapPinned aria-hidden className="size-6" />,
        true,
      )}
      {phone === null
        ? null
        : action(`tel:${phone}`, t('place.call'), <Phone aria-hidden className="size-6" />, false)}
      {website === null
        ? null
        : action(website, t('place.website'), <Globe aria-hidden className="size-6" />, true)}
    </ul>
  );
}
