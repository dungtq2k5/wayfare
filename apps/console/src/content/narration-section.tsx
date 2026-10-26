'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminNarrationCreate, adminNarrationList } from '@wayfare/api-client';
import { CONTENT_LANGUAGES } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { JobStatusBadge, Progress } from '@wayfare/ui/content';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { CircleCheck, CircleX, LoaderCircle, Minus, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import { formatDuration } from '../i18n/format';
import { autonym, languageName } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useJobSubscription, useSocketEvent } from '../shell/socket';
import { jobTone, isFinished } from './jobs';
import { RegenerateDialog } from './regenerate-dialog';
import { touristsGet } from './words';
import type { LocalizationState } from './words';

/** Every content language, then any other language the Place already has. */
export function narrationRows(localizations: readonly LocalizationState[]): LocalizationState[] {
  const known = new Map(localizations.map((row) => [row.lang, row]));
  const blank = (lang: string): LocalizationState => ({
    lang,
    textReady: false,
    stale: false,
    audioStatus: 'NONE',
    audioStale: false,
  });
  return [
    ...CONTENT_LANGUAGES.map((lang) => known.get(lang) ?? blank(lang)),
    ...localizations.filter((row) => !(CONTENT_LANGUAGES as readonly string[]).includes(row.lang)),
  ];
}

function State({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      {children}
    </span>
  );
}

/**
 * Narration per language (L3): each language's text and audio as words with icons, what tourists
 * in it get meanwhile, and *Regenerate* or *Make*; above, the latest job, live while the page is
 * open (`job:subscribe`). `onJobDone` hears a job of this Place finish, so the page refetches (K6).
 */
export function NarrationSection({
  placeId,
  name,
  localizations,
  onJobDone,
}: {
  placeId: string;
  name: string;
  localizations: readonly LocalizationState[];
  onJobDone: () => void;
}) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const queries = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const jobsKey = ['place-jobs', placeId];
  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: () => adminNarrationList({ targetType: 'PLACE', targetId: placeId, pageSize: 1 }),
  });
  const latest = jobs.data?.data[0] ?? null;
  useJobSubscription(latest !== null && !isFinished(latest.status) ? latest.id : null);
  useSocketEvent('narrationJobStatus', (payload) => {
    if (payload.targetId !== placeId) return;
    void queries.invalidateQueries({ queryKey: jobsKey });
    if (isFinished(payload.status)) onJobDone();
  });
  useSocketEvent('narrationTaskProgress', (payload) => {
    if (latest !== null && payload.jobId === latest.id) onJobDone();
  });

  const rows = narrationRows(localizations);
  const manage = can('narration.job.manage');
  const make = (lang: string) =>
    void adminNarrationCreate({
      targetType: 'PLACE',
      targetId: placeId,
      langs: [lang],
      includeAudio: true,
    }).then(
      () => {
        toast.success(t('regen.started'));
        void queries.invalidateQueries({ queryKey: jobsKey });
      },
      (error: unknown) => toast.error(errorText(error, translator), { duration: Infinity }),
    );
  // The source's text is the Place's own: regenerating it remakes its audio only.
  const made = (row: LocalizationState) =>
    row.lang === 'vi' ? row.audioStatus === 'READY' : row.textReady;
  const making = (lang: string) =>
    latest !== null && !isFinished(latest.status) && latest.requestedLangs.includes(lang);

  const text = (row: LocalizationState) => {
    if (row.lang === 'vi')
      return (
        <State icon={<CircleCheck aria-hidden className="text-primary" />}>
          {t('narration.source')}
        </State>
      );
    if (row.textReady && row.stale)
      return (
        <State icon={<TriangleAlert aria-hidden className="text-warning-foreground" />}>
          {t('narration.outOfDate')}
        </State>
      );
    if (row.textReady)
      return (
        <State icon={<CircleCheck aria-hidden className="text-primary" />}>
          {t('narration.ready')}
        </State>
      );
    if (making(row.lang))
      return (
        <State
          icon={
            <LoaderCircle
              aria-hidden
              className="animate-spin text-info-foreground motion-reduce:animate-none"
            />
          }
        >
          {t('narration.beingMade')}
        </State>
      );
    return <State icon={<Minus aria-hidden />}>{t('narration.notMade')}</State>;
  };
  const audio = (row: LocalizationState) => {
    if (row.audioStatus === 'READY' && row.audioStale)
      return (
        <State icon={<TriangleAlert aria-hidden className="text-warning-foreground" />}>
          {t('narration.outOfDate')}
        </State>
      );
    if (row.audioStatus === 'READY')
      return (
        <span className="flex flex-col gap-0.5">
          <State icon={<CircleCheck aria-hidden className="text-primary" />}>
            {row.audioDurationMs == null
              ? t('narration.ready')
              : `${t('narration.ready')} · ${formatDuration(row.audioDurationMs)}`}
          </State>
          {row.voiceId == null ? null : (
            <span className="text-xs text-muted-foreground">{row.voiceId}</span>
          )}
        </span>
      );
    if (row.audioStatus === 'FAILED')
      return (
        <State icon={<CircleX aria-hidden className="text-destructive" />}>
          {t('narration.failed')}
        </State>
      );
    if (row.audioStatus === 'PENDING' || making(row.lang))
      return (
        <State
          icon={
            <LoaderCircle
              aria-hidden
              className="animate-spin text-info-foreground motion-reduce:animate-none"
            />
          }
        >
          {t('narration.beingMade')}
        </State>
      );
    return <State icon={<Minus aria-hidden />}>{t('narration.notMade')}</State>;
  };
  const gets = (row: LocalizationState) => {
    const tier = touristsGet(row.lang, localizations);
    if (tier === 'self') return languageName(row.lang, translator.locale);
    return tier === 'english' ? t('narration.englishUntil') : t('narration.sourceUntil');
  };

  return (
    <Card className="flex flex-col gap-4" aria-labelledby="narration">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="narration" className="text-lg font-semibold text-foreground">
          {t('narration.title')}
        </h2>
        {manage ? (
          <Button variant="outline" size="sm" onClick={() => setRegenerating(true)}>
            <RefreshCw aria-hidden />
            {t('narration.regenerateMany')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{t('narration.latestJob')}</span>
        {/* Nothing until the jobs answer: "No job yet" would be wrong while they load. */}
        {jobs.data === undefined ? null : latest === null ? (
          <span className="text-muted-foreground">{t('narration.noJob')}</span>
        ) : (
          <>
            <JobStatusBadge tone={jobTone(latest.status)}>
              {tDynamic(`jobStatus.${latest.status}`)}
            </JobStatusBadge>
            <Progress
              value={latest.completedTasks}
              max={latest.totalTasks}
              label={t('jobs.doneOf', { done: latest.completedTasks, total: latest.totalTasks })}
            />
            <Link
              href={`/narration/jobs/${latest.id}`}
              className="font-medium text-primary hover:underline"
            >
              {t('narration.openJob')}
            </Link>
          </>
        )}
      </div>
      <div
        className="relative overflow-x-auto"
        role="region"
        aria-label={t('a11y.table', { name: t('narration.title') })}
        tabIndex={0}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('narration.title')}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('narration.language')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('narration.text')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('narration.audio')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('narration.touristsGet')}
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">{t('places.rowActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.lang} className="border-t border-border">
                <th
                  scope="row"
                  className="py-3 pr-3 font-medium whitespace-nowrap text-foreground"
                  lang={row.lang}
                >
                  {row.lang === 'vi'
                    ? t('narration.sourceLabel', { language: autonym('vi') })
                    : autonym(row.lang)}
                </th>
                <td className="py-3 pr-3">{text(row)}</td>
                <td className="py-3 pr-3">{audio(row)}</td>
                <td className="py-3 pr-3 text-muted-foreground">{gets(row)}</td>
                <td className="py-3 text-right">
                  {manage && !making(row.lang) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => make(row.lang)}
                      aria-label={`${made(row) ? t('narration.regenerate') : t('narration.make')}: ${autonym(row.lang)}`}
                    >
                      {made(row) ? t('narration.regenerate') : t('narration.make')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {regenerating ? (
        <RegenerateDialog
          open
          onOpenChange={setRegenerating}
          placeId={placeId}
          name={name}
          localizations={rows}
          onStarted={() => void queries.invalidateQueries({ queryKey: jobsKey })}
        />
      ) : null}
    </Card>
  );
}
