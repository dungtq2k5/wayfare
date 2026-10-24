import { notFound } from 'next/navigation';
import { mayOpen, navItemFor } from '../../../nav';
import { currentUser, requestPath } from '../../../server/api';
import { SectionView } from '../../../shell/pages';
import { NoPermission } from '../../../states/states';

/**
 * Every navigation section until its round builds it (rounds 35–36): the route checks its own
 * permission on the server (K5) — C14 when it is missing, never a page with data missing — then says
 * the section is on its way. A path under no section is Next.js's not-found (C15).
 */
export default async function SectionPage() {
  const path = (await requestPath()).split('?')[0] ?? '/';
  const item = navItemFor(path);
  if (item === undefined) notFound();
  const me = await currentUser();
  if (!mayOpen(item, me.permissions)) return <NoPermission page={item.label} />;
  if (path !== item.href) notFound();
  return <SectionView label={item.label} />;
}
