/** The five screens the start flow can show before a walk is on (W2–W5b). */
export type PermissionScreen =
  | 'background-explainer'
  | 'settings-step'
  | 'notifications-explainer'
  | 'location-denied'
  | 'location-denied-forever';

/** What the tourist chose on a screen: its main button, or its quiet one (*Not now*). */
export type Answer = 'primary' | 'secondary';

export interface ForegroundStatus {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

/** Everything the flow asks of the platform and of the tourist, injected so a spec can script it. */
export interface PermissionDeps {
  foreground(): Promise<ForegroundStatus>;
  requestForeground(): Promise<ForegroundStatus>;
  background(): Promise<boolean>;
  /** Android 11+ opens its settings page and returns when the tourist comes back. */
  requestBackground(): Promise<boolean>;
  /** Notifications need a question only on Android 13 and later. */
  notificationsNeedAsking(): Promise<boolean>;
  requestNotifications(): Promise<void>;
  openAppSettings(): void;
  ask(screen: PermissionScreen): Promise<Answer>;
  flags(): {
    readonly backgroundExplained: boolean;
    readonly notificationsExplained: boolean;
  };
  mark(flag: 'backgroundExplained' | 'notificationsExplained'): void;
}

export type StartOutcome =
  /** The walk may run; `background` is whether it can listen with the screen off. */
  | { readonly kind: 'ready'; readonly background: boolean }
  /** No walk: the tourist left, or location was refused (W5, W5b). */
  | { readonly kind: 'abandoned' };

/**
 * The first-walk sequence of D8, one answer at a time: foreground location, then the background
 * explainer and Android's settings step, then notifications. Every refusal degrades: no foreground
 * means no walk; no background means a foreground-only walk; no notifications changes nothing.
 */
export async function runStartFlow(deps: PermissionDeps): Promise<StartOutcome> {
  let foreground = await deps.foreground();
  while (!foreground.granted) {
    if (foreground.canAskAgain) {
      foreground = await deps.requestForeground();
      if (foreground.granted) break;
    }
    const screen = foreground.canAskAgain ? 'location-denied' : 'location-denied-forever';
    const answer = await deps.ask(screen);
    if (answer === 'secondary') return { kind: 'abandoned' };
    if (!foreground.canAskAgain) {
      deps.openAppSettings();
      return { kind: 'abandoned' };
    }
    // *Try again*: the loop asks Android once more.
  }

  const background = await grantBackground(deps);
  await askNotifications(deps);
  return { kind: 'ready', background };
}

/**
 * Background location: skipped when already granted; the explainer and the settings step once per
 * install; after that, silently foreground-only (no nagging).
 */
export async function grantBackground(deps: PermissionDeps, force = false): Promise<boolean> {
  if (await deps.background()) return true;
  if (deps.flags().backgroundExplained && !force) return false;
  if ((await deps.ask('background-explainer')) === 'secondary') {
    deps.mark('backgroundExplained');
    return false;
  }
  if ((await deps.ask('settings-step')) === 'secondary') {
    deps.mark('backgroundExplained');
    return false;
  }
  deps.mark('backgroundExplained');
  return deps.requestBackground();
}

async function askNotifications(deps: PermissionDeps): Promise<void> {
  if (deps.flags().notificationsExplained || !(await deps.notificationsNeedAsking())) return;
  const answer = await deps.ask('notifications-explainer');
  deps.mark('notificationsExplained');
  if (answer === 'primary') await deps.requestNotifications();
}
