'use client';

import { cn } from '@wayfare/ui/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { categoryIcon } from './category-icon';

export interface GalleryPhoto {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
}

/**
 * The photo gallery (WQ1): swiped on a phone, with the count; from 1200 px one large photo and two
 * beside it. A Place with no photo shows its category's icon on the muted surface.
 */
export function PhotoGallery({
  photos,
  name,
  categoryCode,
}: {
  photos: readonly GalleryPhoto[];
  name: string;
  categoryCode: string;
}) {
  const { t } = useWeb();
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const Icon = categoryIcon(categoryCode);
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, next));
    setIndex(clamped);
    strip.current?.children[clamped]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  };
  const placeholder = (className: string) => (
    <div
      className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}
    >
      <Icon aria-hidden className="size-10" />
    </div>
  );

  if (photos.length === 0) {
    return (
      <div role="img" aria-label={t('place.photos', { name })} className="w-full">
        {placeholder('h-55 w-full tablet:h-70 desk:h-85 desk:rounded-md')}
      </div>
    );
  }

  return (
    <section aria-label={t('place.photos', { name })} className="relative w-full">
      {/* Phone and 720 px: a strip that scrolls sideways inside itself. */}
      <div
        ref={strip}
        onScroll={(event) => {
          const box = event.currentTarget;
          setIndex(Math.round(box.scrollLeft / box.clientWidth));
        }}
        className="flex h-55 snap-x snap-mandatory overflow-x-auto overscroll-x-contain tablet:h-70 desk:hidden"
      >
        {photos.map((photo) => (
          <img
            key={photo.id}
            src={photo.url}
            alt={photo.alt}
            className="h-full w-full shrink-0 snap-start object-cover"
          />
        ))}
      </div>
      {photos.length > 1 ? (
        <>
          <span className="absolute right-2 bottom-2 rounded-full bg-foreground/80 px-2 py-0.5 text-xs text-background desk:hidden">
            {t('place.photoCount', { n: index + 1, total: photos.length })}
          </span>
          <div className="absolute inset-y-0 hidden w-full items-center justify-between px-2 tablet:flex desk:hidden">
            <button
              type="button"
              aria-label={t('place.previousPhoto')}
              disabled={index === 0}
              onClick={() => go(index - 1)}
              className="flex size-11 items-center justify-center rounded-full bg-card/90 text-foreground shadow-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-0"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
            <button
              type="button"
              aria-label={t('place.nextPhoto')}
              disabled={index === photos.length - 1}
              onClick={() => go(index + 1)}
              className="flex size-11 items-center justify-center rounded-full bg-card/90 text-foreground shadow-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-0"
            >
              <ChevronRight aria-hidden className="size-5" />
            </button>
          </div>
        </>
      ) : null}
      {/* 1200 px: one large photo, two beside it. */}
      <div className="hidden h-85 gap-2 desk:flex">
        <img
          src={photos[0]!.url}
          alt={photos[0]!.alt}
          className="h-full min-w-0 flex-2 object-cover"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {[photos[1], photos[2]].map((photo, slot) =>
            photo === undefined ? (
              <div key={slot} className="flex-1">
                {placeholder('size-full')}
              </div>
            ) : (
              <img
                key={photo.id}
                src={photo.url}
                alt={photo.alt}
                className="min-h-0 flex-1 object-cover"
              />
            ),
          )}
        </div>
      </div>
    </section>
  );
}
