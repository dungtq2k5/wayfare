'use client';

import { CircleAlert, LoaderCircle, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

/** The words the player says; the page's language. */
export interface AudioPreviewLabels {
  /** The button's name while idle ("Listen with your entry"). */
  readonly listen: string;
  /** The line while playing ("Playing with your entry"). */
  readonly playing: string;
  readonly pause: string;
  /** "3 of 7 seconds", for readers. */
  readonly time: (elapsed: number, length: number) => string;
}

/** `m:ss`. */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * *Audio preview* (round 35): play, a progress bar and the time. `load` fetches the audio when
 * play is pressed; the blob URL it makes is revoked when the audio ends or the preview goes. An
 * error (`error`, set by the page) takes the play button's and the bar's place (handoff 35 §14).
 */
export function AudioPreview({
  load,
  error,
  labels,
  className,
}: {
  load: () => Promise<Blob>;
  error: string | null;
  labels: AudioPreviewLabels;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [time, setTime] = useState({ elapsed: 0, length: 0 });

  const release = () => {
    audio.current?.pause();
    audio.current = null;
    if (url.current !== null) URL.revokeObjectURL(url.current);
    url.current = null;
  };
  useEffect(() => release, []);

  const play = async () => {
    if (audio.current !== null) {
      await audio.current.play();
      setState('playing');
      return;
    }
    setState('loading');
    try {
      const blob = await load();
      url.current = URL.createObjectURL(blob);
      const element = new Audio(url.current);
      audio.current = element;
      element.addEventListener('loadedmetadata', () =>
        setTime({ elapsed: 0, length: Number.isFinite(element.duration) ? element.duration : 0 }),
      );
      element.addEventListener('timeupdate', () =>
        setTime((now) => ({ ...now, elapsed: element.currentTime })),
      );
      element.addEventListener('ended', () => {
        release();
        setState('idle');
      });
      await element.play();
      setState('playing');
    } catch {
      // The page sets `error` from the answer; a refused autoplay leaves it idle.
      release();
      setState('idle');
    }
  };
  const pause = () => {
    audio.current?.pause();
    setState('paused');
  };

  const playing = state === 'playing';
  const ratio = time.length === 0 ? 0 : Math.min(1, time.elapsed / time.length);
  if (error !== null)
    return (
      <div
        role="status"
        className={cn(
          'flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-destructive',
          className,
        )}
      >
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        {error}
      </div>
    );
  return (
    <div className={cn('flex items-center gap-3 rounded-md bg-muted p-3', className)}>
      <button
        type="button"
        onClick={() => (playing ? pause() : void play())}
        disabled={state === 'loading'}
        aria-label={playing ? labels.pause : labels.listen}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {state === 'loading' ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        ) : playing ? (
          <Pause aria-hidden className="size-5" />
        ) : (
          <Play aria-hidden className="size-5" />
        )}
      </button>
      <div role="status" className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">
          {state === 'idle' ? labels.listen : labels.playing}
        </span>
        {state === 'idle' ? null : (
          <span className="flex items-center gap-3">
            <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-primary" style={{ width: `${ratio * 100}%` }} />
            </span>
            <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
              {clock(time.elapsed)} / {clock(time.length)}
            </span>
            <span className="sr-only">
              {labels.time(Math.floor(time.elapsed), Math.round(time.length))}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
