import { colors } from '@wayfare/design-tokens/tokens';
import * as Notifications from 'expo-notifications';
import { tourist } from '../i18n';

const CHANNEL = 'walk';

/** The "Walk" channel the idle-end notification uses; created before its first use. */
async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: tourist().t('walk.notification.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: null,
    lightColor: colors.light.primary,
  });
}

// In the app the walk notice says the same; a banner on top of it would double it.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

/** The final, dismissible notification of an idle end (N1); opening it lands on the Map. */
export async function notifyWalkEnded(heardCount: number): Promise<void> {
  const { t } = tourist();
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('walk.notification.ended'),
        body: t('walk.notification.endedBody', { count: heardCount }),
        data: { walkEnded: true },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        channelId: CHANNEL,
      },
    });
  } catch {
    // No permission, no notification: the notice in the app says the same.
  }
}
