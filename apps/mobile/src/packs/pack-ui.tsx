import type { LucideIcon } from 'lucide-react-native';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  Headphones,
  Image as ImageIcon,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import type { Pack } from './db';
import type { Progress } from './engine';
import { formatSize, listeningTime } from './format';
import type { FileKind } from './plan';
import { FILE_KINDS } from './plan';
import type { PackPlan } from './use-pack-plan';

// ponytail: the spinners are a still LoaderCircle (the handoff's reduced-motion form), as in the
// rest of the app; the words carry every state.

type T = ReturnType<typeof useTourist>['t'];

const percent = (progress: Progress | undefined) =>
  progress === undefined || progress.total === 0
    ? 0
    : Math.floor((progress.done / progress.total) * 100);

/** The handoff's *Pack state*: one line, an icon and words; *Download* and *Update* read as actions. */
export function packStateOf(
  t: T,
  pack: Pack | null,
  progress: Progress | undefined,
  downloadSize: number | null,
): { icon: LucideIcon; color: SemanticColor; text: string; action: boolean } {
  const p = percent(progress);
  if (pack === null) {
    return {
      icon: Download,
      color: 'primary',
      text:
        downloadSize === null
          ? t('pack.offer.download')
          : t('pack.state.download', { size: formatSize(downloadSize) }),
      action: true,
    };
  }
  switch (pack.state) {
    case 'downloading':
      return {
        icon: LoaderCircle,
        color: 'primary',
        text: t('pack.state.downloading', { p }),
        action: false,
      };
    case 'paused':
      return {
        icon: Pause,
        color: 'muted-foreground',
        text: t('pack.state.paused', { p }),
        action: false,
      };
    case 'waiting-wifi':
      return {
        icon: WifiOff,
        color: 'muted-foreground',
        text: t('pack.state.waitingWifi'),
        action: false,
      };
    case 'waiting-connection':
      return {
        icon: WifiOff,
        color: 'muted-foreground',
        text: t('pack.state.waitingConnection'),
        action: false,
      };
    case 'checking':
      return { icon: ShieldCheck, color: 'primary', text: t('pack.state.checking'), action: false };
    case 'ready':
      return { icon: CircleCheck, color: 'primary', text: t('pack.state.ready'), action: false };
    case 'update':
      return {
        icon: RefreshCw,
        color: 'primary',
        text: t('pack.state.update', { size: formatSize(pack.update?.bytes ?? 0) }),
        action: true,
      };
    case 'damaged':
      return {
        icon: TriangleAlert,
        color: 'warning-foreground',
        text: t('pack.state.damaged'),
        action: false,
      };
    case 'failed':
      return {
        icon: CircleAlert,
        color: 'warning-foreground',
        text: t('pack.state.failed'),
        action: false,
      };
    case 'no-space':
      return {
        icon: TriangleAlert,
        color: 'warning-foreground',
        text: t('pack.state.noSpace'),
        action: false,
      };
  }
}

export function PackStateLine(props: {
  pack: Pack | null;
  progress: Progress | undefined;
  downloadSize?: number | null;
}) {
  const { t } = useTourist();
  const state = packStateOf(t, props.pack, props.progress, props.downloadSize ?? null);
  return (
    <View className="flex-row items-center gap-1">
      <Icon icon={state.icon} size="sm" color={state.color} />
      <Text className={`shrink text-label ${state.action ? 'text-primary' : 'text-foreground'}`}>
        {state.text}
      </Text>
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 justify-center px-3"
    >
      <Text className="text-label text-primary">{label}</Text>
    </Pressable>
  );
}

function FilledButton({
  label,
  icon,
  onPress,
  quiet = false,
  testID,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  quiet?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-4 ${quiet ? 'bg-secondary' : 'bg-primary'}`}
    >
      {icon !== undefined && (
        <Icon icon={icon} size="md" color={quiet ? 'secondary-foreground' : 'primary-foreground'} />
      )}
      <Text
        className={`text-label ${quiet ? 'text-secondary-foreground' : 'text-primary-foreground'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const STAGES: readonly (FileKind | 'checking')[] = [...FILE_KINDS, 'checking'];

/** The five stages under the bar: done (a check), the current one, and those to come. */
function Stages({ stage, finished }: { stage: Progress['stage']; finished: boolean }) {
  const { t } = useTourist();
  const at = STAGES.indexOf(stage);
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      {STAGES.map((name, index) => {
        const done = finished || index < at;
        return (
          <View key={name} className="flex-row items-center gap-1">
            <Icon
              icon={done ? CircleCheck : index === at ? LoaderCircle : Clock}
              size="xs"
              color={done || index === at ? 'primary' : 'muted-foreground'}
            />
            <Text className="text-caption text-muted-foreground">{t(`pack.stage.${name}`)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export interface ProgressActions {
  readonly pause: () => void;
  readonly resume: () => void;
  readonly cancel: () => void;
  readonly useMobileData: () => void;
  readonly tryAgain: () => void;
  readonly freeUp: () => void;
}

/**
 * The handoff's *Pack progress*: the pack screen's card through every stage and stall — one 8 dp
 * bar for the whole size, the stage in words, the five stages, and what the tourist can do.
 */
export function ProgressCard({
  pack,
  progress,
  actions,
}: {
  pack: Pack;
  progress: Progress | undefined;
  actions: ProgressActions;
}) {
  const { t } = useTourist();
  const p = percent(progress);
  const done = formatSize(progress?.done ?? 0);
  const size = formatSize(progress?.total ?? pack.bytes);
  const stage = progress?.stage ?? 'map';
  const cancel = <TextButton label={t('pack.progress.cancel')} onPress={actions.cancel} />;
  let icon: LucideIcon = LoaderCircle;
  let iconColor: SemanticColor = 'primary';
  let title = t('pack.progress.downloading', { p });
  const of = t('pack.progress.of', { done, size });
  let body = stage === 'checking' ? of : `${of} · ${t(`pack.progress.now.${stage}`)}`;
  let buttons: ReactNode = (
    <>
      {cancel}
      <FilledButton label={t('pack.progress.pause')} icon={Pause} quiet onPress={actions.pause} />
    </>
  );
  switch (pack.state) {
    case 'paused':
      icon = Pause;
      iconColor = 'muted-foreground';
      title = t('pack.progress.pausedTitle', { p });
      body = t('pack.progress.pausedBody', { done, size });
      buttons = (
        <>
          {cancel}
          <FilledButton label={t('pack.progress.resume')} icon={Play} onPress={actions.resume} />
        </>
      );
      break;
    case 'waiting-connection':
      icon = WifiOff;
      iconColor = 'muted-foreground';
      title = t('pack.progress.connectionTitle');
      body = t('pack.progress.connectionBody', { done, size });
      buttons = cancel;
      break;
    case 'waiting-wifi':
      icon = WifiOff;
      iconColor = 'muted-foreground';
      title = t('pack.progress.wifiTitle');
      body = t('pack.progress.wifiBody', { done, size });
      buttons = (
        <>
          {cancel}
          <FilledButton
            label={t('pack.progress.useMobileData')}
            quiet
            onPress={actions.useMobileData}
          />
        </>
      );
      break;
    case 'checking':
      icon = ShieldCheck;
      title = t('pack.progress.checkingTitle');
      body = t('pack.progress.checkingBody');
      buttons = cancel;
      break;
    case 'failed':
      icon = CircleAlert;
      iconColor = 'warning-foreground';
      title = t('pack.progress.failedTitle');
      body = t('pack.progress.failedBody', { done });
      buttons = (
        <>
          {cancel}
          <FilledButton
            label={t('pack.progress.tryAgain')}
            icon={RotateCw}
            onPress={actions.tryAgain}
          />
        </>
      );
      break;
    case 'no-space':
      icon = TriangleAlert;
      iconColor = 'warning-foreground';
      title = t('pack.progress.fullTitle');
      body = t('pack.progress.fullBody', {
        size: formatSize(Math.max((progress?.total ?? 0) - (progress?.done ?? 0), 0)),
      });
      buttons = (
        <>
          {cancel}
          <FilledButton label={t('pack.freeUp')} onPress={actions.freeUp} />
        </>
      );
      break;
    default:
      break;
  }
  const finished = pack.state === 'checking';
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4 elevation-1">
      <View className="flex-row gap-3">
        <Icon icon={icon} size="lg" color={iconColor} />
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {title}
          </Text>
          <Text className="text-label text-muted-foreground">{body}</Text>
        </View>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: finished ? 100 : p }}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <View
          style={{ width: `${finished ? 100 : p}%` }}
          className={`h-2 rounded-full ${pack.state === 'failed' || pack.state === 'no-space' ? 'bg-muted-foreground' : 'bg-primary'}`}
        />
      </View>
      <Stages stage={stage} finished={finished} />
      <View className="flex-row flex-wrap items-center justify-end gap-2">{buttons}</View>
    </View>
  );
}

/** "1 h 6 min" or "48 min". */
export function useListening() {
  const { t } = useTourist();
  return (ms: number) => {
    const { hours, minutes } = listeningTime(ms);
    return hours > 0
      ? t('pack.time.hours', { hours, minutes })
      : t('pack.time.minutes', { minutes });
  };
}

/** The parts of a pack, in the tourist's terms, with their sizes (the sheet and frame M2). */
export function PartsList({
  plan,
  counts,
  sizeOf,
  listeningLabel,
}: {
  plan: PackPlan;
  counts: { places: number; photos: number; stories: number; listeningMs: number };
  sizeOf: (kind: FileKind) => number;
  listeningLabel: (time: string) => string;
}) {
  const { t } = useTourist();
  const listening = useListening();
  const rows: { kind: FileKind; icon: LucideIcon; label: string }[] = [
    ...(plan.hasMap && sizeOf('map') > 0
      ? [{ kind: 'map' as const, icon: MapIcon, label: t('pack.part.map') }]
      : []),
    { kind: 'places', icon: MapPin, label: t('pack.part.places', { count: counts.places }) },
    ...(sizeOf('photo') > 0
      ? [
          {
            kind: 'photo' as const,
            icon: ImageIcon,
            label: t('pack.part.photos', { count: counts.photos }),
          },
        ]
      : []),
    {
      kind: 'audio',
      icon: Headphones,
      label: `${t('pack.part.stories', { count: counts.stories })} · ${listeningLabel(listening(counts.listeningMs))}`,
    },
  ];
  return (
    <View className="gap-1">
      {rows.map((row) => (
        <View key={row.kind} className="min-h-10 flex-row items-center gap-3">
          <Icon icon={row.icon} size="md" color="muted-foreground" />
          <Text className="flex-1 text-body text-foreground">{row.label}</Text>
          <Text className="text-label text-muted-foreground">{formatSize(sizeOf(row.kind))}</Text>
        </View>
      ))}
    </View>
  );
}

/** The *Download pill* on the Map, under the area switcher, while a download is not ready (frame D2b). */
export function DownloadPill({
  pack,
  progress,
  area,
  onPress,
}: {
  pack: Pack;
  progress: Progress | undefined;
  area: string;
  onPress: () => void;
}) {
  const { t } = useTourist();
  const p = percent(progress);
  const [icon, text]: [LucideIcon, string] =
    pack.state === 'paused' || pack.state === 'failed' || pack.state === 'no-space'
      ? [Pause, t('pack.pill.paused', { area })]
      : pack.state === 'waiting-wifi'
        ? [WifiOff, t('pack.pill.waitingWifi', { area })]
        : pack.state === 'waiting-connection'
          ? [WifiOff, t('pack.pill.waitingConnection', { area })]
          : pack.state === 'checking'
            ? [ShieldCheck, t('pack.pill.checking', { area })]
            : [LoaderCircle, t('pack.pill.downloading', { area, p })];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${t('pack.pill.label')}`}
      onPress={onPress}
      className="min-h-target flex-row items-center gap-2 self-start rounded-full border border-border bg-card px-3 py-2 elevation-1"
    >
      <Icon icon={icon} size="sm" color="primary" />
      <Text className="shrink text-label text-foreground">{text}</Text>
      <Icon icon={ChevronRight} size="sm" color="muted-foreground" />
    </Pressable>
  );
}

/** The offer (frame O1): a card under the area switcher, once per area, on Wi-Fi. */
export function OfferCard({
  area,
  size,
  places,
  onDownload,
  onNotNow,
}: {
  area: string;
  size: number;
  places: number;
  onDownload: () => void;
  onNotNow: () => void;
}) {
  const { t } = useTourist();
  return (
    <View className="gap-2 rounded-xl bg-card p-4 elevation-2">
      <View className="flex-row gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <Icon icon={Download} size="md" color="accent-foreground" />
        </View>
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {t('pack.offer.title', { area })}
          </Text>
          <Text className="text-label text-muted-foreground">
            {t('pack.offer.body', { size: formatSize(size), count: places })}
          </Text>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center justify-end gap-2">
        <TextButton label={t('pack.offer.notNow')} onPress={onNotNow} />
        <FilledButton label={t('pack.offer.download')} icon={Download} onPress={onDownload} />
      </View>
    </View>
  );
}

export { FilledButton, TextButton };
