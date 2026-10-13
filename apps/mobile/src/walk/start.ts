import * as Location from 'expo-location';
import { CircleCheck } from 'lucide-react-native';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { tourist } from '../i18n';
import { useAppStore } from '../state/app-store';
import { showToast } from '../ui/toast';
import { applyBackgroundPermission, dispatch } from './controller';
import { markWalkFlag, useWalkFlags } from './flags';
import { grantBackground, runStartFlow } from './permissions';
import type { PermissionDeps } from './permissions';
import { askWalkPrompt } from './prompt';
import { useWalkStore } from './store';
import { WALK_CARD_LIFT } from './toast-lift';
import { refreshPermission } from '../location/location-store';

/** The platform behind the start flow: Android's permissions and the tourist's answers. */
export const platformDeps: PermissionDeps = {
  foreground: async () => {
    const { granted, canAskAgain } = await Location.getForegroundPermissionsAsync();
    return { granted, canAskAgain };
  },
  requestForeground: async () => {
    const { granted, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    void refreshPermission();
    return { granted, canAskAgain };
  },
  background: async () => (await Location.getBackgroundPermissionsAsync()).granted,
  requestBackground: async () => {
    await Location.requestBackgroundPermissionsAsync();
    return (await Location.getBackgroundPermissionsAsync()).granted;
  },
  // Android 13 and later ask; before that, and once granted, there is nothing to ask.
  notificationsNeedAsking: async () =>
    Platform.OS === 'android' &&
    Number(Platform.Version) >= 33 &&
    !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)),
  requestNotifications: async () => {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  },
  openAppSettings: () => void Linking.openSettings(),
  ask: askWalkPrompt,
  flags: () => useWalkFlags.getState(),
  mark: markWalkFlag,
};

/** *Start walk*: the permission sequence, then the walk. A second tap while it runs does nothing. */
export async function startWalk(): Promise<void> {
  const { phase } = useWalkStore.getState().walk;
  if (phase !== 'off' && phase !== 'ended') return;
  useWalkStore.setState({ simulated: false });
  dispatch({ type: 'begin', areaId: useAppStore.getState().currentAreaId });
  const outcome = await runStartFlow(platformDeps);
  if (outcome.kind === 'abandoned') {
    dispatch({ type: 'abandon' });
    return;
  }
  dispatch({ type: 'ready', background: outcome.background });
  if (outcome.background)
    showToast(tourist().t('walk.toast.on'), undefined, undefined, {
      icon: CircleCheck,
      lift: WALK_CARD_LIFT,
    });
}

/** Settings › *Location during a walk* when background is not yet granted (W2 again). */
export async function allowBackground(): Promise<boolean> {
  const granted = await grantBackground(platformDeps, true);

  applyBackgroundPermission(granted);
  return granted;
}
