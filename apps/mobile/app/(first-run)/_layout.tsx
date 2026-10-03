import { Stack } from 'expo-router';

// The group has no index: without this, Expo Router opens it on whichever route sorts first, and a
// fresh install skipped the picker. Language comes before the privacy notice (product J1).
export const unstable_settings = { initialRouteName: 'language' };

export default function FirstRunLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
