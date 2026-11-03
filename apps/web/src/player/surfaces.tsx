'use client';

import { cn } from '@wayfare/ui/cn';
import {
  ArrowLeft,
  AudioLines,
  ChevronDown,
  FileText,
  Info,
  Languages,
  LoaderCircle,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Smartphone,
  Square,
} from 'lucide-react';
import Link from 'next/link';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { KeyboardEvent } from 'react';
import { languageName } from '../i18n/language-name';
import { useWeb } from '../i18n/provider';
import { categoryIcon } from '../places/category-icon';
import { useLanguagePicker } from '../shell/language-picker-state';
import { useInlineVisible } from './inline-visibility';
import { ProgressLine } from './play-story';
import { player } from './player';
import { clock } from './track';
import { usePlayer } from './use-player';

const ring =
  'outline-none focus-visible:ring-2 focus-visible:ring-now-playing-accent focus-visible:ring-offset-2 focus-visible:ring-offset-now-playing';
const round = cn('flex shrink-0 items-center justify-center rounded-full', ring);

/** WN1: the mini player, sticky at the bottom of every page while a story is on. */
export function MiniPlayer() {
  const { t, tDynamic } = useWeb();
  const state = usePlayer();
  const inline = useInlineVisible();
  const { track } = state;
  if (track === null || inline === track.placeId || state.nowPlayingOpen) return null;
  const playing = state.phase === 'playing' || state.phase === 'voice';
  const preparing = state.phase === 'preparing';
  const category = tDynamic(`category.${track.categoryCode}`);
  const length = state.durationMs === null ? t('player.unknownLength') : clock(state.durationMs);
  return (
    <section
      aria-label={t('player.nowPlaying')}
      className="fixed inset-x-2 bottom-2 z-40 overflow-hidden rounded-xl bg-now-playing text-now-playing-foreground shadow-2 tablet:right-4 tablet:bottom-4 tablet:left-auto tablet:w-120"
    >
      <div className="flex items-center gap-3 py-3 pr-2 pl-4">
        <button
          type="button"
          onClick={() => player.setNowPlaying(true)}
          className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-md text-left', ring)}
        >
          {/* Named by what it shows, after what it does: axe's label-content-name-mismatch. */}
          <span className="sr-only">{t('player.open')}: </span>
          <AudioLines aria-hidden className="size-6 shrink-0 text-now-playing-accent" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span aria-live="polite" className="truncate text-base font-semibold">
              {track.name}
            </span>
            <span className="truncate text-xs">
              {preparing
                ? t('player.preparing')
                : t('player.miniMeta', { category, elapsed: clock(state.elapsedMs), length })}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t('player.readTranscript')}
          onClick={() => player.setTranscript(true)}
          className={cn(round, 'size-12')}
        >
          <FileText aria-hidden className="size-6" />
        </button>
        <button
          type="button"
          aria-label={
            preparing ? t('player.cancel') : playing ? t('player.pause') : t('player.resume')
          }
          onClick={() => (preparing ? player.stop() : player.toggle())}
          className={cn(round, 'size-12 bg-now-playing-foreground text-now-playing')}
        >
          {preparing ? (
            <LoaderCircle aria-hidden className="size-6 animate-spin motion-reduce:animate-none" />
          ) : playing ? (
            <Pause aria-hidden className="size-6" />
          ) : (
            <Play aria-hidden className="size-6" />
          )}
        </button>
      </div>
      {state.source === 'voice' ? null : (
        <ProgressLine elapsedMs={state.elapsedMs} durationMs={state.durationMs} />
      )}
    </section>
  );
}

/** The scrubber (round 26): a slider with the time as its text value, ±10 s by the arrows. */
function Scrubber() {
  const { t } = useWeb();
  const state = usePlayer();
  const duration = state.durationMs;
  const seekable = state.source === 'file' && duration !== null;
  const share = duration === null || duration === 0 ? 0 : Math.min(1, state.elapsedMs / duration);
  const elapsed = clock(state.elapsedMs);
  const length = duration === null ? t('player.unknownLength') : clock(duration);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!seekable) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
      player.seek(state.elapsedMs - 10_000);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
      player.seek(state.elapsedMs + 10_000);
    else return;
    event.preventDefault();
  };
  return (
    <div className="flex w-full flex-col gap-1">
      <div
        data-progress
        role="slider"
        tabIndex={seekable ? 0 : -1}
        aria-label={t('player.scrubber')}
        aria-valuemin={0}
        aria-valuemax={Math.round((duration ?? 0) / 1000)}
        aria-valuenow={Math.round(state.elapsedMs / 1000)}
        aria-valuetext={t('player.position', { elapsed, length })}
        aria-disabled={!seekable}
        onKeyDown={onKey}
        onClick={(event) => {
          if (!seekable) return;
          const box = event.currentTarget.getBoundingClientRect();
          player.seek(((event.clientX - box.left) / box.width) * duration);
        }}
        className={cn(
          'relative flex h-6 w-full items-center rounded-full',
          ring,
          seekable && 'cursor-pointer',
        )}
      >
        <span className="absolute inset-x-0 h-1 rounded-full bg-now-playing-foreground/25" />
        <span
          className="absolute left-0 h-1 rounded-full bg-now-playing-accent"
          style={{ width: `${share * 100}%` }}
        />
        {seekable ? (
          <span
            className="absolute size-4 -translate-x-1/2 rounded-full bg-now-playing-foreground"
            style={{ left: `${share * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-sm font-medium">
        <span data-elapsed>{elapsed}</span>
        <span>{length}</span>
      </div>
    </div>
  );
}

/** A note on the player's surface (WN3, WN3b, WN3c). */
function PlayerNote({
  icon: Icon,
  children,
  action,
}: {
  icon: typeof Radio;
  children: string;
  action?: React.ReactNode;
}) {
  return (
    <div role="status" className="flex w-full items-center gap-3 px-2 text-sm">
      <Icon aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/**
 * WN2: Now playing — a full-screen dialog on a phone, a 480 px panel on the right from 720 px. The
 * artwork, the Place, the language it is told in with *Change*, the scrubber, the transport, the
 * transcript, and *Up next*.
 */
export function NowPlaying() {
  const { t, tDynamic, locale } = useWeb();
  const state = usePlayer();
  const picker = useLanguagePicker();
  const { track, upNext } = state;
  if (track === null) return null;
  const preparing = state.phase === 'preparing';
  const playing = state.phase === 'playing' || state.phase === 'voice';
  const language = languageName(track.lang, locale);
  const Category = categoryIcon(track.categoryCode);
  const area = track.areaCode === null ? null : tDynamic(`area.${track.areaCode}`);
  const meta = [tDynamic(`category.${track.categoryCode}`), area].filter(Boolean).join(' · ');
  const UpNextIcon = upNext === null ? null : categoryIcon(upNext.categoryCode);
  const dim = preparing ? 'opacity-40' : '';
  return (
    <DialogPrimitive.Root
      open={state.nowPlayingOpen}
      onOpenChange={(open) => player.setNowPlaying(open)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 hidden bg-overlay/50 tablet:block" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-now-playing text-now-playing-foreground outline-none tablet:left-auto tablet:w-120 tablet:shadow-3 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom tablet:data-[state=open]:slide-in-from-right duration-(--duration-normal) motion-reduce:animate-none">
          <div className="flex flex-col items-center px-2 pt-1">
            <span
              aria-hidden
              className="h-1 w-9 rounded-full bg-now-playing-foreground/40 tablet:hidden"
            />
            <div className="flex w-full items-center">
              <DialogPrimitive.Close
                aria-label={t('player.close')}
                className={cn(round, 'size-12')}
              >
                <ChevronDown aria-hidden className="size-6" />
              </DialogPrimitive.Close>
              <DialogPrimitive.Title className="flex-1 text-center text-sm font-medium">
                {preparing ? t('player.preparing') : t('player.nowPlaying')}
              </DialogPrimitive.Title>
              <Link
                href={`/p/${track.code}`}
                aria-label={t('player.placeDetails')}
                onClick={() => player.setNowPlaying(false)}
                className={cn(round, 'size-12')}
              >
                <Info aria-hidden className="size-6" />
              </Link>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 px-6 pt-2 pb-6">
            <div className="flex h-50 w-full items-center justify-center overflow-hidden rounded-2xl bg-now-playing-foreground/10">
              {track.photoUrl === null ? (
                <Category aria-hidden className="size-20 text-now-playing-accent" />
              ) : (
                <img src={track.photoUrl} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-semibold">{track.name}</p>
              <p className="flex items-center gap-1 text-sm font-medium">
                <Category aria-hidden className="size-4" />
                {meta}
              </p>
              <p className="flex items-center gap-1 text-xs text-now-playing-accent">
                <Languages aria-hidden className="size-4" />
                <span className="flex-1">
                  {state.source === 'stream'
                    ? t('player.toldInLive', { language })
                    : t('player.toldIn', { language })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    player.setNowPlaying(false);
                    picker.setOpen(true);
                  }}
                  className={cn('rounded-sm underline', ring)}
                >
                  {t('player.change')}
                </button>
              </p>
            </div>
            {state.source === 'voice' ? (
              <PlayerNote icon={Languages}>
                {state.offline ? t('player.voiceTitle') : t('player.voiceTitleOnline')}
              </PlayerNote>
            ) : (
              <Scrubber />
            )}
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                aria-label={t('player.speed', { speed: state.rate })}
                disabled={preparing}
                onClick={() => player.cycleSpeed()}
                className={cn(
                  'flex min-h-12 min-w-16 items-center justify-center rounded-full border border-now-playing-foreground px-3 text-sm font-medium',
                  ring,
                  dim,
                )}
              >
                {state.rate}×
              </button>
              <button
                type="button"
                aria-label={t('player.back10')}
                disabled={preparing}
                onClick={() => player.back10()}
                className={cn(round, 'size-12', dim)}
              >
                <RotateCcw aria-hidden className="size-6" />
              </button>
              <button
                type="button"
                aria-label={
                  preparing ? t('player.cancel') : playing ? t('player.pause') : t('player.resume')
                }
                onClick={() => (preparing ? player.stop() : player.toggle())}
                className={cn(round, 'size-18 bg-now-playing-foreground text-now-playing')}
              >
                {preparing ? (
                  <LoaderCircle
                    aria-hidden
                    className="size-8 animate-spin motion-reduce:animate-none"
                  />
                ) : playing ? (
                  <Pause aria-hidden className="size-8" />
                ) : (
                  <Play aria-hidden className="size-8" />
                )}
              </button>
              {upNext === null ? (
                <button
                  type="button"
                  aria-label={t('player.stop')}
                  onClick={() => player.stop()}
                  className={cn(round, 'size-12')}
                >
                  <Square aria-hidden className="size-6" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t('player.skip')}
                  onClick={() => player.skip()}
                  className={cn(round, 'size-12')}
                >
                  <SkipForward aria-hidden className="size-6" />
                </button>
              )}
            </div>
            {preparing ? (
              <PlayerNote
                icon={LoaderCircle}
                action={
                  <button
                    type="button"
                    onClick={() => player.stop()}
                    className={cn(
                      'min-h-11 rounded-md px-2 font-medium text-now-playing-accent',
                      ring,
                    )}
                  >
                    {t('player.cancel')}
                  </button>
                }
              >
                {t('player.preparingNote', { language })}
              </PlayerNote>
            ) : state.source === 'stream' ? (
              <PlayerNote icon={Radio}>{t('player.liveNote')}</PlayerNote>
            ) : state.source === 'voice' ? (
              <PlayerNote icon={Smartphone}>{t('player.voiceNote')}</PlayerNote>
            ) : null}
            <button
              type="button"
              onClick={() => player.setTranscript(true)}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-full border border-now-playing-foreground px-5 text-sm font-medium',
                ring,
              )}
            >
              <FileText aria-hidden className="size-5" />
              {t('player.readTranscript')}
            </button>
            <div className="flex-1" />
            {upNext === null || UpNextIcon === null ? (
              <p className="text-xs">{t('player.nothingWaiting')}</p>
            ) : (
              <div className="relative flex items-center gap-3 overflow-hidden rounded-xl p-3">
                <span aria-hidden className="absolute inset-0 bg-now-playing-foreground/10" />
                <span className="relative flex size-12 shrink-0 items-center justify-center rounded-md bg-now-playing-accent text-now-playing">
                  <UpNextIcon aria-hidden className="size-6" />
                </span>
                <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xs text-now-playing-accent">{t('player.upNext')}</span>
                  <span className="text-base font-semibold">{upNext.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => player.skip()}
                  className={cn('relative min-h-11 rounded-md px-2 text-sm font-medium', ring)}
                >
                  {t('player.playNow')}
                </button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** WN2b: the transcript, a page of its own over the site, the mini player below it. */
export function Transcript() {
  const { t, tDynamic, locale } = useWeb();
  const state = usePlayer();
  const { track } = state;
  if (track === null) return null;
  const length = state.durationMs === null ? t('player.unknownLength') : clock(state.durationMs);
  return (
    <DialogPrimitive.Root
      open={state.transcriptOpen}
      onOpenChange={(open) => player.setTranscript(open)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // A page of its own over the site's header (z-30), the mini player (z-40) still above it.
          className="fixed inset-0 z-35 flex flex-col overflow-y-auto bg-background outline-none"
        >
          <div className="mx-auto flex w-full max-w-170 flex-col gap-4 px-4 py-2">
            <div className="flex items-center gap-2">
              <DialogPrimitive.Close
                aria-label={t('player.back')}
                className="flex size-11 items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft aria-hidden className="size-6" />
              </DialogPrimitive.Close>
              <DialogPrimitive.Title className="text-2xl font-semibold text-foreground">
                {t('player.transcript')}
              </DialogPrimitive.Title>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-foreground">{track.name}</p>
              <p className="text-sm font-medium text-muted-foreground">
                {t('player.transcriptMeta', {
                  category: tDynamic(`category.${track.categoryCode}`),
                  language: languageName(track.lang, locale),
                  length,
                })}
              </p>
            </div>
            <div lang={track.lang} className="flex flex-col gap-4 text-base text-foreground">
              {track.text.split(/\n{2,}/).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            {/* Room for the mini player, which stays below the text. */}
            <div aria-hidden className="h-24 shrink-0" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The player's surfaces on every page, and the lock screen's area name in the page's language. */
export function PlayerSurfaces() {
  const { tDynamic } = useWeb();
  player.areaName = (track) => (track.areaCode === null ? '' : tDynamic(`area.${track.areaCode}`));
  return (
    <>
      <MiniPlayer />
      <NowPlaying />
      <Transcript />
    </>
  );
}
