'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  adminNarrationCancel,
  adminNarrationGet,
  adminNarrationPause,
  adminNarrationResume,
  adminNarrationRetryFailed,
  adminPlacesGet,
} from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { JobStatusBadge, Progress } from '@wayfare/ui/content';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { CircleX, Clock, Info, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { autonym } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { useJobSubscription, useSocketEvent } from '../shell/socket';
import { useTargetName, useTriggerText } from './job-words';
import { controlsFor, isFinished, jobTone, taskTone } from './jobs';
import { displayName } from './narration-providers';
import { RegenerateDialog } from './regenerate-dialog';
import { formatTime } from '../i18n/format';

type Job = Awaited<ReturnType<typeof adminNarrationGet>>['data'];
type Task = Job['tasks'][number];
type Control = ReturnType<typeof controlsFor>[number];

const STAGES = ['TRANSLATE', 'PRONOUNCE', 'SYNTHESIZE', 'STORE', 'PUBLISH'] as const;
const CONTROL_CALLS: Record<Control, (id: string) => Promise<unknown>> = {
  pause: adminNarrationPause,
  resume: adminNarrationResume,
  retry: adminNarrationRetryFailed,
  cancel: adminNarrationCancel,
};

/**
 * A job (J2, J3): its tasks per language — the stage as one of five, the providers used, the tries
 * and the detail — live while it runs (`job:subscribe`). A task waiting for a speech provider says
 * since when and when it tries again: not stuck. The controls are those the state allows.
 */
export function NarrationJob({ initial }: { initial: Job }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const router = useRouter();
  const triggerText = useTriggerText();
  const job = useQuery({
    queryKey: ['narration-job', initial.id],
    queryFn: async () => (await adminNarrationGet(initial.id)).data,
    initialData: initial,
  });
  const data = job.data;
  const name = useTargetName(data.targetType, data.targetId);
  const [busy, setBusy] = useState<Control | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useJobSubscription(isFinished(data.status) ? null : data.id);
  useSocketEvent('narrationJobStatus', (event) => {
    if (event.jobId === data.id) void job.refetch();
  });
  useSocketEvent('narrationTaskProgress', (event) => {
    if (event.jobId === data.id) void job.refetch();
  });
  const place = useQuery({
    queryKey: ['place', data.targetId],
    enabled: regenerating && data.targetType === 'PLACE' && data.targetId !== null,
    queryFn: async () => (await adminPlacesGet(data.targetId!)).data,
  });

  const now = new Date();
  const clock = (iso: string) => formatTime(iso, locale);
  const act = async (control: Control) => {
    if (busy !== null) return;
    setBusy(control);
    try {
      await CONTROL_CALLS[control](data.id);
      setCancelling(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SYNTHESIS_JOB_NOT_ACTIVE') {
        const fresh = await job.refetch();
        const state = fresh.data?.status ?? data.status;
        toast.info(t('job.notActive', { state: tDynamic(`jobStatus.${state}`).toLowerCase() }));
        setCancelling(false);
      } else {
        toast.error(errorText(error, translator), { duration: Infinity });
      }
    } finally {
      setBusy(null);
      void job.refetch();
    }
  };

  const waiting = (task: Task) =>
    task.status === 'QUEUED' && task.failureReason === 'PROVIDER_UNAVAILABLE';
  // The waiting line in the info colour, a failure in red, each with its icon.
  const detail = (task: Task) => {
    if (waiting(task) && task.nextAttemptAt !== null) {
      const minutes = Math.max(
        0,
        Math.ceil((new Date(task.nextAttemptAt).getTime() - now.getTime()) / 60_000),
      );
      return (
        <span className="flex items-start gap-1 text-info-foreground">
          <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t('job.waiting', {
            time: clock(task.providerDownSince ?? task.startedAt ?? data.createdAt),
            next: clock(task.nextAttemptAt),
            minutes,
          })}
        </span>
      );
    }
    if (task.status === 'RUNNING' && task.stage === 'SYNTHESIZE') return t('job.making');
    if (task.lastError === null) return '';
    // A failure says how many tries, what went wrong, and what to do.
    return task.status === 'FAILED' ? (
      <span className="flex items-start gap-1 text-destructive">
        <CircleX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {t(task.stage === 'TRANSLATE' ? 'job.failedTranslation' : 'job.failedAudio', {
          tries: task.attempts,
          error: task.lastError,
        })}
      </span>
    ) : (
      task.lastError
    );
  };
  const stage = (task: Task) => {
    const done = task.status === 'SUCCEEDED';
    const step = done ? STAGES.length : STAGES.indexOf(task.stage) + 1;
    return (
      <span className="flex flex-col gap-1">
        <span aria-hidden className="flex gap-0.5">
          {STAGES.map((name, index) => (
            <span
              key={name}
              className={`h-1.5 w-4 rounded-full ${index < step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </span>
        <span className="whitespace-nowrap">
          {done
            ? t('stage.PUBLISHED')
            : t('job.stageOf', { stage: tDynamic(`stage.${task.stage}`), i: step })}
        </span>
      </span>
    );
  };
  const manage = can('narration.job.manage');
  const controls = manage ? controlsFor(data.status, data.failedTasks) : [];
  const label: Record<Control, string> = {
    pause: t('job.pause'),
    resume: t('job.resume'),
    retry: t('job.retry'),
    cancel: t('job.cancel'),
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/narration/jobs" className="text-sm text-muted-foreground hover:underline">
            {t('jobs.title')}
          </Link>
        }
        title={name}
        badges={
          <JobStatusBadge tone={jobTone(data.status)}>
            {tDynamic(`jobStatus.${data.status}`)}
          </JobStatusBadge>
        }
        description={t('job.startedLine', {
          trigger: triggerText(data),
          time: relativeTime(data.startedAt ?? data.createdAt, now, translator),
          what: data.includeAudio ? t('job.textAndAudio') : t('job.textOnly'),
          count: data.requestedLangs.length,
        })}
        action={
          <div className="flex flex-wrap gap-2">
            {controls.map((control) => (
              <Button
                key={control}
                variant="outline"
                busy={busy === control && control !== 'cancel' ? t('action.saving') : undefined}
                onClick={() => (control === 'cancel' ? setCancelling(true) : void act(control))}
              >
                {label[control]}
              </Button>
            ))}
            {manage && data.targetType === 'PLACE' && data.targetId !== null ? (
              <Button variant="outline" onClick={() => setRegenerating(true)}>
                <RefreshCw aria-hidden />
                {t('regen.title')}
              </Button>
            ) : null}
          </div>
        }
      />
      {data.status === 'PAUSED' ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('job.pausedLine')}
        </p>
      ) : null}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            {t('job.summary', {
              done: data.completedTasks,
              total: data.totalTasks,
              failed: data.failedTasks,
            })}
          </p>
          <Progress
            value={data.completedTasks}
            max={Math.max(data.totalTasks, 1)}
            label={t('jobs.doneOf', { done: data.completedTasks, total: data.totalTasks })}
          />
        </div>
        <div
          className="relative overflow-x-auto"
          role="region"
          aria-label={t('a11y.table', { name: t('job.tasks') })}
          tabIndex={0}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('job.liveNote')}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                {[
                  t('job.language'),
                  t('job.stage'),
                  t('jobs.status'),
                  t('job.providers'),
                  t('job.tries'),
                  t('job.details'),
                ].map((heading) => (
                  <th key={heading} scope="col" className="px-2 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((task) => (
                <tr key={task.id} className="border-t border-border align-top">
                  <th scope="row" className="px-2 py-3 font-medium text-foreground">
                    <span lang={task.lang}>{autonym(task.lang)}</span>
                  </th>
                  <td className="px-2 py-3">{stage(task)}</td>
                  <td className="px-2 py-3">
                    <JobStatusBadge tone={taskTone(task.status, waiting(task))}>
                      {tDynamic(`taskStatus.${task.status}`)}
                    </JobStatusBadge>
                  </td>
                  <td className="px-2 py-3 text-muted-foreground">
                    {[
                      task.translationProvider === null
                        ? null
                        : displayName({ role: 'translation', name: task.translationProvider }),
                      task.speechProvider === null
                        ? null
                        : displayName({ role: 'speech', name: task.speechProvider }),
                    ]
                      .filter((provider) => provider !== null)
                      .join(' · ') || t('place.none')}
                  </td>
                  <td className="px-2 py-3">{task.attempts}</td>
                  <td className="max-w-md px-2 py-3 text-muted-foreground">{detail(task)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t('job.liveNote')}</p>
      </Card>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('job.cancelTitle')}
        description={t('job.cancelBody')}
        confirm={t('job.cancel')}
        tone="destructive"
        busy={busy === 'cancel' ? t('action.saving') : undefined}
        labels={{ cancel: t('job.keep'), close: t('action.close') }}
        onConfirm={() => void act('cancel')}
      />
      {place.data === undefined ? null : (
        <RegenerateDialog
          open={regenerating}
          onOpenChange={setRegenerating}
          placeId={place.data.id}
          name={place.data.nameVi}
          localizations={place.data.localizations}
          onStarted={(jobId) => router.push(`/narration/jobs/${jobId}`)}
        />
      )}
    </>
  );
}
