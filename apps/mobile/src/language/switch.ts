import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import { LONG_TAIL_LANGUAGES, NARRATION_CONFIG } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { create } from 'zustand';
import { useAppStore } from '../state/app-store';
import type { BundleOutcome } from '../i18n/bundles';

/** Wayfare's words: loading, ready, or still being machine-translated (`PENDING`). */
export type UiLane = 'loading' | 'ready' | 'translating';
/** `slow`: past the patience; `offline`: waiting for a connection; `failed`: the server refused. */
export type SwitchPhase = 'running' | 'slow' | 'offline' | 'failed';

export interface SwitchStatus {
  ui: UiLane;
  /** Every active area synced in the new language. */
  synced: boolean;
  /** The hotset's ready stories, and how many it takes. */
  ready: number;
  required: number;
  phase: SwitchPhase;
  /** A long-tail language switched with its screens still in English (T1), until *OK* or they land. */
  screensPending: Language | null;
}

const fresh = (): Omit<SwitchStatus, 'screensPending'> => ({
  ui: 'loading',
  synced: false,
  ready: 0,
  required: NARRATION_CONFIG.hotsetReadyThreshold,
  phase: 'running',
});

/** The switch under way, as the card and the pill show it; the record itself is the app store's. */
export const useSwitchStore = create<SwitchStatus>(() => ({ ...fresh(), screensPending: null }));

/** What the switch needs from the phone and the server; the app's are in `switch-deps.ts`. */
export interface SwitchDeps {
  now(): number;
  wait(ms: number): Promise<void>;
  /** Whether the gateway answers now. */
  online(): Promise<boolean>;
  bundled(lang: Language): boolean;
  /** The language's words, in the app or kept from an earlier fetch, put in i18next; false if neither. */
  uiFromPhone(lang: Language): Promise<boolean>;
  loadUi(
    lang: Language,
    options: { isWanted(locale: string): boolean; onPending(locale: string): void },
  ): Promise<BundleOutcome>;
  /** Whether every area the phone has synced in `current` is synced in `lang` too. */
  syncedLike(lang: Language, current: Language): Promise<boolean>;
  sync(lang: Language): Promise<unknown>;
  hotset(lang: Language): Promise<{ ready: number; required: number }>;
  /** Resolves once this install is registered: the hotset and the sync are device routes. */
  registered(): Promise<void>;
  /** After the one store update: the device's language, the toast, the player. */
  completed(lang: Language, how: { offline: boolean; toast: boolean }): void;
  holds(): { holdHotset: boolean; failNext: boolean };
  clearFailNext(): void;
}

/** How long before asking the hotset again, `elapsedMs` after the lane began (5 s, then 60 s). */
export function hotsetDelay(elapsedMs: number): number {
  return elapsedMs < NARRATION_CONFIG.languageSwitchPatienceMs ? 5_000 : 60_000;
}

/** While waiting for a connection, how often to ask the gateway again. */
export const OFFLINE_RETRY_MS = 30_000;

const isLongTail = (lang: Language): boolean =>
  (LONG_TAIL_LANGUAGES as readonly string[]).includes(lang);
/** No answer from the server: anything else (its error, or the phone's) is a failure. */
const isNetwork = (error: unknown): boolean =>
  error instanceof ApiError && error.code === NETWORK_ERROR_CODE;

let deps: SwitchDeps | null = null;
/** Bumped whenever a run starts or ends: a late answer for an old run is dropped. */
let generation = 0;

const patch = (next: Partial<SwitchStatus>): void => useSwitchStore.setState(next);

/** Whether `lang`'s two lanes allow the switch to complete (*Switch now* skips the hotset). */
function lanesReady(lang: Language, status: SwitchStatus, withoutHotset: boolean): boolean {
  const words = status.ui === 'ready' || (status.ui === 'translating' && isLongTail(lang));
  return words && status.synced && (withoutHotset || status.ready >= status.required);
}

/**
 * The one moment everything changes: one store update sets `language` and clears the record, so
 * every screen reads the new language in the same render.
 */
function complete(lang: Language, offline: boolean): void {
  if (deps === null) return;
  generation += 1;
  const translating = useSwitchStore.getState().ui === 'translating';
  useAppStore.setState({
    language: lang,
    pendingLanguage: null,
    switchStartedAt: null,
    switchFirstRun: false,
  });
  patch({ ...fresh(), screensPending: translating ? lang : null });
  // The toast is said in the new language; a long tail still translating says it when its words land.
  deps.completed(lang, { offline, toast: !translating });
}

function check(lang: Language, alive: () => boolean): void {
  if (alive() && lanesReady(lang, useSwitchStore.getState(), false)) complete(lang, false);
}

async function uiLane(lang: Language, d: SwitchDeps, alive: () => boolean, stop: Stop) {
  if (d.bundled(lang)) {
    patch({ ui: 'ready' });
    return;
  }
  const translating = () => {
    if (!alive()) return;
    patch({ ui: 'translating' });
    check(lang, alive);
  };
  // The loader gives up after its attempts; the switch keeps asking while it runs. Once a long tail
  // completes in English, the app's own loader (`showLanguage`) takes over.
  for (;;) {
    const outcome = await d.loadUi(lang, { isWanted: alive, onPending: translating });
    if (!alive()) return;
    if (outcome === 'offline' || outcome === 'failed') return stop(outcome);
    if (outcome === 'ready') {
      patch({ ui: 'ready' });
      return check(lang, alive);
    }
  }
}

async function contentLane(lang: Language, d: SwitchDeps, alive: () => boolean, stop: Stop) {
  await d.registered();
  if (!alive()) return;
  try {
    await d.sync(lang);
  } catch (error) {
    if (alive()) stop(isNetwork(error) ? 'offline' : 'failed');
    return;
  }
  if (!alive()) return;
  patch({ synced: true });
  check(lang, alive);
  const began = d.now();
  while (alive()) {
    let wait = hotsetDelay(d.now() - began);
    try {
      const answer = d.holds().holdHotset
        ? { ready: 0, required: NARRATION_CONFIG.hotsetReadyThreshold }
        : await d.hotset(lang);
      if (!alive()) return;
      patch({ ready: Math.min(answer.ready, answer.required), required: answer.required });
      check(lang, alive);
      if (answer.ready >= answer.required) return;
    } catch (error) {
      if (!alive()) return;
      if (error instanceof ApiError && error.status === 429) {
        const seconds = (error.details as { retryAfterSeconds?: number } | undefined)
          ?.retryAfterSeconds;
        if (seconds !== undefined) wait = seconds * 1000;
      } else {
        return stop(isNetwork(error) ? 'offline' : 'failed');
      }
    }
    await d.wait(wait);
  }
}

type Stop = (outcome: 'offline' | 'failed') => void;

/** Runs `pendingLanguage`'s lanes from the start; the previous run's answers are dropped. */
async function run(): Promise<void> {
  const d = deps;
  const { language, pendingLanguage: lang, switchStartedAt } = useAppStore.getState();
  if (d === null || lang === null) return;
  const gen = (generation += 1);
  const alive = () => gen === generation && useAppStore.getState().pendingLanguage === lang;
  patch(fresh());

  const stop: Stop = (outcome) => {
    if (!alive()) return;
    generation += 1; // the other lane's answers no longer count
    patch({ phase: outcome });
    if (outcome === 'offline') void retryWhenOnline(lang);
  };
  const startedAt = switchStartedAt ?? d.now();
  void d
    .wait(Math.max(0, startedAt + NARRATION_CONFIG.languageSwitchPatienceMs - d.now()))
    .then(() => {
      if (alive() && useSwitchStore.getState().phase === 'running') patch({ phase: 'slow' });
    });

  if (d.holds().failNext) {
    d.clearFailNext();
    return stop('failed');
  }
  const current = language ?? 'en';
  // A language on the phone completes at once, online or offline; online, a sync catches it up.
  if ((await d.syncedLike(lang, current)) && (await d.uiFromPhone(lang))) {
    const online = await d.online();
    if (!alive()) return;
    patch({ ui: 'ready', synced: true });
    complete(lang, !online);
    if (online) void d.sync(lang).catch(() => undefined);
    return;
  }
  if (!(await d.online())) return stop('offline');
  if (!alive()) return;
  await Promise.all([uiLane(lang, d, alive, stop), contentLane(lang, d, alive, stop)]);
}

/** While waiting for a connection, asks again now and then: the gateway can return unannounced. */
async function retryWhenOnline(lang: Language): Promise<void> {
  const d = deps;
  if (d === null) return;
  await d.wait(OFFLINE_RETRY_MS);
  resumeSwitch(lang);
}

/** Starts the controller; a switch persisted by an earlier launch resumes. */
export function startLanguageSwitch(switchDeps: SwitchDeps): void {
  deps = switchDeps;
  void run();
}

/**
 * The tourist picked `lang`: the current language cancels, another starts (or replaces) the
 * switch. The store's record is what everything reads; the run follows it.
 */
export function switchTo(lang: Language): void {
  const { language, pendingLanguage } = useAppStore.getState();
  if (lang === pendingLanguage) return;
  if (lang === language) return cancelSwitch();
  useAppStore.setState({
    pendingLanguage: lang,
    switchStartedAt: (deps?.now ?? Date.now)(),
    switchFirstRun: false,
  });
  patch({ screensPending: null });
  void run();
}

export function cancelSwitch(): void {
  generation += 1;
  useAppStore.setState({ pendingLanguage: null, switchStartedAt: null, switchFirstRun: false });
  patch(fresh());
}

/**
 * The first run's picker: a language the app carries is set at once; any other starts in English
 * with a switch to it, whose words are fetched at once and its places after registration.
 */
export function chooseFirstLanguage(lang: Language, bundled: boolean): void {
  if (bundled) {
    useAppStore.setState({ language: lang, pendingLanguage: null, switchFirstRun: false });
    return;
  }
  useAppStore.setState({
    language: 'en',
    pendingLanguage: lang,
    switchStartedAt: (deps?.now ?? Date.now)(),
    switchFirstRun: true,
  });
  patch({ screensPending: null });
  void run();
}

/** *Try again*, and the way back from waiting for a connection. */
export function retrySwitch(): void {
  void run();
}

/** The network is back: a switch waiting for it runs again. */
export function resumeSwitch(lang = useAppStore.getState().pendingLanguage): void {
  if (
    lang !== null &&
    lang === useAppStore.getState().pendingLanguage &&
    useSwitchStore.getState().phase === 'offline'
  ) {
    void run();
  }
}

/** *Switch now* (X4): offered only with the words ready and every area synced. */
export function canSwitchNow(lang: Language | null, status: SwitchStatus): boolean {
  return lang !== null && status.phase === 'slow' && lanesReady(lang, status, true);
}

export function switchNow(): void {
  const lang = useAppStore.getState().pendingLanguage;
  if (canSwitchNow(lang, useSwitchStore.getState()) && lang !== null) complete(lang, false);
}

/** *OK* on the screens-pending card. */
export function dismissScreensPending(): void {
  patch({ screensPending: null });
}
