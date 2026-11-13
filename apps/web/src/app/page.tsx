import { redirect } from 'next/navigation';

/** The web app opens on the map (the handoff's §2): a Place arrives by its own link. */
export default function Home(): never {
  redirect('/map');
}
