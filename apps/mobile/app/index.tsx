import { Redirect } from 'expo-router';

/** `/` has no screen of its own: the app opens on the Map tab (A1). */
export default function Index() {
  return <Redirect href="/map" />;
}
