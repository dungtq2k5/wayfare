import { colors } from '@wayfare/design-tokens/tokens';
import * as Notifications from 'expo-notifications';
import { tourist } from '../i18n';
import { areaName } from './area-name';
import type { PackState } from './db';
import type { Progress } from './engine';
import { formatSize } from './format';

const CHANNEL = 'downloads';
/** The text is updated at most this often (K11). */
const EVERY_MS = 5_000;

let channelReady: Promise<unknown> | null = null;
const lastShown = new Map<string, number>();

const identifier = (areaId: string, lang: string) => `pack-${areaId}-${lang}`;

async function show(areaId: string, lang: string, content: Notifications.NotificationContentInput) {
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL, {
    name: tourist().t('pack.notification.channel'),
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    lightColor: colors.light.primary,
  });
  await channelReady;
  await Notifications.scheduleNotificationAsync({
    identifier: identifier(areaId, lang),
    content: { ...content, data: { pack: { areaId, lang } } },
    trigger: { channelId: CHANNEL },
  });
}

/**
 * Android's download notification (N1): text only — the notification library offers no progress
 * bar or actions we can rely on in the background — updated at most every 5 s; *Done* and
 * *Stopped* replace it and can be swiped away; a pause or a delete removes it. A tap opens the pack.
 */
export function notifyPack(
  areaId: string,
  lang: string,
  state: PackState | 'progress' | null,
  progress?: Progress,
): void {
  const { t } = tourist();
  const key = identifier(areaId, lang);
  const run = async () => {
    const area = areaName(areaId);
    if (state === 'progress' && progress !== undefined) {
      const now = Date.now();
      if (now - (lastShown.get(key) ?? 0) < EVERY_MS) return;
      lastShown.set(key, now);
      await show(areaId, lang, {
        title: t('pack.notification.downloading', { area }),
        body: t('pack.notification.progress', {
          done: formatSize(progress.done),
          size: formatSize(progress.total),
          stage: t(`pack.stage.${progress.stage}`),
        }),
        sticky: true,
        autoDismiss: false,
      });
    } else if (state === 'waiting-wifi') {
      await show(areaId, lang, {
        title: t('pack.notification.waitingWifi', { area }),
        body: t('pack.notification.waitingWifiBody'),
      });
    } else if (state === 'ready') {
      await show(areaId, lang, {
        title: t('pack.notification.ready', { area }),
        body: t('pack.notification.readyBody', { size: formatSize(progress?.total ?? 0) }),
      });
    } else if (state === 'failed') {
      await show(areaId, lang, {
        title: t('pack.notification.stopped'),
        body: t('pack.notification.stoppedBody', { area }),
      });
    } else if (state !== 'downloading' && state !== 'checking' && state !== 'waiting-connection') {
      lastShown.delete(key);
      await Notifications.dismissNotificationAsync(key);
    }
  };
  // No permission, no notification: the pack screen and the pill say the same.
  run().catch(() => undefined);
}
