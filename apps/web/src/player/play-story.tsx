'use client';

import { Button } from '@wayfare/ui/button';
import { cn } from '@wayfare/ui/cn';
import { ChevronUp, Info, Languages, LoaderCircle, Pause, Play, WifiOff } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { languageName } from '../i18n/language-name';
import { useWeb } from '../i18n/provider';
import { setInlineVisible } from './inline-visibility';
import { player } from './player';
import { clock } from './track';
import type { Track } from './track';
import { usePlayer } from './use-player';

/** The progress line under the inline and mini players. */
export function ProgressLine({
  elapsedMs,
  durationMs,
}: {
  elapsedMs: number;
  durationMs: number | null;
}) {
  const share = durationMs === null || durationMs === 0 ? 0 : Math.min(1, elapsedMs / durationMs);
  return (
    <span
      aria-hidden
      data-progress
      className="relative block h-0.75 w-full overflow-hidden rounded-full"
    >
      <span className="absolute inset-0 bg-now-playing-foreground/25" />
      <span
        className="absolute inset-y-0 left-0 bg-now-playing-accent"
        style={{ width: `${share * 100}%` }}
      />
    </span>
  );
}

/** A note under the player: what is happening, honestly (WN4, WN4b). */
function Note({ icon, children }: { icon: 'info' | 'offline'; children: string }) {
  const Icon = icon === 'info' ? Info : WifiOff;
  return (
    <p
      role="status"
      className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      {children}
    </p>
  );
}

/**
 * *Play the story* (WQ1), which becomes the inline player once this Place plays (WQ2): pause, the
 * time, and the full player. When the text isn't in the page's language, the note above says so
 * and the button names the audio's language (WQ3, WL2b). A story that began in another language
 * finishes in it, with *Play from the start* in the page's (WL2). Nothing plays before the tap.
 */
export function PlayStory({
  track,
  note,
  englishFallback,
  fill = false,
}: {
  track: Track;
  note: string | null;
  /** WL2b: the page's language isn't written yet, and the story is told in English meanwhile. */
  englishFallback: boolean;
  /** The map's sheet and panel: *Play the story* is their one action, full width at every width. */
  fill?: boolean;
}) {
  const { t, locale } = useWeb();
  const state = usePlayer();
  const noteId = useId();
  const box = useRef<HTMLDivElement>(null);
  const current = state.track?.placeId === track.placeId ? state : null;
  const length = track.audio === null ? null : clock(track.audio.durationMs);
  const language = languageName(track.lang, locale);
  // WL2: this Place plays in another language than the one the page now shows.
  const otherLanguage =
    current !== null && current.track !== null && current.track.lang !== track.lang
      ? languageName(current.track.lang, locale)
      : null;

  // While this inline player shows, the mini player steps aside. Keyed on whether this Place is
  // the one playing, not on the player's state: that changes with every tick of the elapsed time,
  // and each new observer would hand the mini player back for a frame (it flickered on a phone).
  const active = current !== null;
  useEffect(() => {
    const element = box.current;
    if (element === null || !active) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInlineVisible(entry?.isIntersecting === true ? track.placeId : null),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setInlineVisible(null);
    };
  }, [active, track.placeId]);

  const label = englishFallback
    ? length === null
      ? t('player.hearInPlain', { language })
      : t('player.hearIn', { language, length })
    : track.lang !== locale
      ? length === null
        ? t('player.playInPlain', { language })
        : t('player.playIn', { language, length })
      : length === null
        ? t('player.playPlain')
        : t('player.play', { length });

  const unavailable = current?.phase === 'unavailable';
  return (
    <div ref={box} className="flex flex-col gap-2">
      {note === null || current !== null ? null : (
        <p
          id={noteId}
          className="flex gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground"
        >
          <Languages aria-hidden className="mt-0.5 size-5 shrink-0" />
          {note}
        </p>
      )}
      {current === null || unavailable ? (
        <Button
          size="lg"
          className={cn('w-full', !fill && 'tablet:w-auto tablet:self-start')}
          aria-describedby={note === null ? undefined : noteId}
          disabled={unavailable}
          onClick={() => void player.play(track)}
        >
          <Play aria-hidden />
          {label}
        </Button>
      ) : (
        <InlinePlayer language={otherLanguage} />
      )}
      {otherLanguage === null ? null : (
        <div className="flex flex-col items-start gap-2 rounded-md bg-muted p-3">
          <p className="text-sm text-muted-foreground">
            {t('player.finishIn', { language: otherLanguage })}
          </p>
          <Button variant="outline" size="lg" onClick={() => void player.play(track)}>
            {t('player.restartIn', { language: languageName(locale, locale) })}
          </Button>
        </div>
      )}
      {current?.phase === 'held' ? <Note icon="info">{t('player.held')}</Note> : null}
      {unavailable ? (
        <Note icon="offline">
          {current.offline ? t('player.cantPlay', { language }) : t('player.cantPlayOnline')}
        </Note>
      ) : null}
    </div>
  );
}

/** WQ3's last line: the browser may read the shown text aloud, less naturally. */
export function VoiceOffer({ track }: { track: Track }) {
  const { t, locale } = useWeb();
  return (
    <button
      type="button"
      onClick={() => player.readAloud(track)}
      className="rounded-sm text-left text-sm text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t('place.voiceOffer', { language: languageName(track.lang, locale) })}
    </button>
  );
}

/** WQ2: the inline player — pause, the time, open the full player. */
function InlinePlayer({ language }: { language: string | null }) {
  const { t } = useWeb();
  const state = usePlayer();
  const playing = state.phase === 'playing' || state.phase === 'voice';
  const preparing = state.phase === 'preparing';
  const elapsed = clock(state.elapsedMs);
  const length = state.durationMs === null ? t('player.unknownLength') : clock(state.durationMs);
  const line = preparing
    ? t('player.preparing')
    : state.phase === 'held'
      ? t('player.tapToHear', { elapsed, length })
      : playing
        ? language === null
          ? t('player.playing', { elapsed, length })
          : t('player.playingIn', { language, elapsed, length })
        : t('player.paused', { elapsed, length });
  const round =
    'flex size-12 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-now-playing-accent';
  return (
    <div className="flex items-center gap-2 rounded-lg bg-now-playing py-1 pr-2 pl-1 text-now-playing-foreground">
      <button
        type="button"
        aria-label={playing ? t('player.pause') : t('player.resume')}
        disabled={preparing}
        onClick={() => player.toggle()}
        className={`${round} bg-now-playing-foreground text-now-playing`}
      >
        {preparing ? (
          <LoaderCircle aria-hidden className="size-6 animate-spin motion-reduce:animate-none" />
        ) : playing ? (
          <Pause aria-hidden className="size-6" />
        ) : (
          <Play aria-hidden className="size-6" />
        )}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The time isn't announced as it runs; play and pause are, by the button's label. */}
        <span aria-live="off" className="text-sm font-medium">
          {line}
        </span>
        <ProgressLine elapsedMs={state.elapsedMs} durationMs={state.durationMs} />
      </span>
      <button
        type="button"
        aria-label={t('player.open')}
        onClick={() => player.setNowPlaying(true)}
        className={round}
      >
        <ChevronUp aria-hidden className="size-6" />
      </button>
    </div>
  );
}
