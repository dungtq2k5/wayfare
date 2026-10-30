'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminPlacesGet, adminPlacesStuck } from '@wayfare/api-client';
import type { StuckPlaceResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { ChevronRight, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { narrationRows } from '../content/narration-section';
import { RegenerateDialog } from '../content/regenerate-dialog';
import { useNames } from '../content/reference';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { useSocketEvent } from '../shell/socket';
import { stuckSince, stuckWhy } from './stuck-words';

type Stuck = StuckPlaceResponseDto;
/** How many Home names; *See in Places* shows them all (X1). */
const SHOWN_ON_HOME = 5;

/**
 * The stuck Places (K26), for a reader holding `place.read`: read again when a narration job
 * changes — a job starting takes its Place off the list.
 */
export function useStuck() {
  const can = useCan();
  const queries = useQueryClient();
  useSocketEvent(
    'narrationJobStatus',
    () => void queries.invalidateQueries({ queryKey: ['stuck'] }),
  );
  return useQuery({
    queryKey: ['stuck'],
    queryFn: async () => (await adminPlacesStuck()).data,
    enabled: can('place.read'),
  });
}

/** Who cancelled a job (K1): "You", the name with `user.read`, else "A staff member". */
export function useWho() {
  const { t } = useConsole();
  const me = useMe();
  return (person: { id: string; name: string | null }) =>
    person.id === me.user.id ? t('history.you') : (person.name ?? t('history.staff'));
}

/** The *Stuck* chip: a derived state, warning-toned, never a Place status (X1b). */
export function StuckChip() {
  const { t } = useConsole();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warning-foreground">
      <TriangleAlert aria-hidden className="size-3" />
      {t('stuck.chip')}
    </span>
  );
}

/**
 * *Make narration again* (round 34's J4) for a stuck Place: its languages are read when pressed,
 * then the dialog opens. Needs `narration.job.manage`.
 */
export function StuckRegenerate({ placeId, name }: { placeId: string; name: string }) {
  const translator = useConsole();
  const { t } = translator;
  const queries = useQueryClient();
  const [localizations, setLocalizations] = useState<
    Awaited<ReturnType<typeof adminPlacesGet>>['data']['localizations'] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const open = () => {
    setBusy(true);
    adminPlacesGet(placeId).then(
      ({ data }) => {
        setBusy(false);
        setLocalizations(data.localizations);
      },
      (error: unknown) => {
        setBusy(false);
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };
  return (
    <>
      <Button variant="outline" size="sm" busy={busy ? t('stuck.again') : undefined} onClick={open}>
        <RefreshCw aria-hidden />
        {t('stuck.again')}
      </Button>
      {localizations === null ? null : (
        <RegenerateDialog
          open
          onOpenChange={(next) => {
            if (!next) setLocalizations(null);
          }}
          placeId={placeId}
          name={name}
          localizations={narrationRows(localizations)}
          onStarted={() => {
            void queries.invalidateQueries({ queryKey: ['stuck'] });
            void queries.invalidateQueries({ queryKey: ['place', placeId] });
          }}
        />
      )}
    </>
  );
}

/** Home's *Needs a look* (X1): first on Home, only with at least one stuck Place. */
export function StuckPlacesCard({ stuck }: { stuck: readonly Stuck[] }) {
  const translator = useConsole();
  const { t } = translator;
  const can = useCan();
  const names = useNames();
  const who = useWho();
  const now = new Date();
  return (
    <Card className="flex flex-col gap-4" aria-labelledby="needs-a-look">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="needs-a-look" className="text-lg font-semibold text-foreground">
          {t('stuck.title')}
          <span className="sr-only"> ({stuck.length})</span>
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/places?status=STUCK">
            <ChevronRight aria-hidden />
            {t('stuck.seeInPlaces')}
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('stuck.lead', { count: stuck.length })}</p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('stuck.title')}</caption>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('stuck.place')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('stuck.since')}
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                {t('stuck.why')}
              </th>
              <th scope="col" className="w-px px-3 py-2">
                <span className="sr-only">{t('places.rowActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stuck.slice(0, SHOWN_ON_HOME).map((row) => (
              <tr key={row.place.id} className="border-t border-border align-middle">
                <td className="px-3 py-3">
                  <Link href={`/places/${row.place.id}`} className="flex flex-col hover:underline">
                    <span lang="vi" className="font-medium text-foreground">
                      {row.place.nameVi}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {names.area(row.place.areaCode)}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-col items-start gap-1">
                    <StuckChip />
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {stuckSince(row.processingSince, now, translator)}
                    </span>
                  </span>
                </td>
                <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                  {stuckWhy(row.lastJob, who, translator)}
                </td>
                <td className="px-3 py-3 text-right">
                  {can('narration.job.manage') ? (
                    <StuckRegenerate placeId={row.place.id} name={row.place.nameVi} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * A stuck Place's alert (X2), on its page: since when, how its last job ended, that tourists
 * don't see it; *Make narration again* with `narration.job.manage`, and *Open the job*.
 */
export function StuckAlert({ placeId, name }: { placeId: string; name: string }) {
  const translator = useConsole();
  const { t } = translator;
  const can = useCan();
  const who = useWho();
  const router = useRouter();
  const stuck = useStuck().data?.find((row) => row.place.id === placeId);
  if (stuck === undefined) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {/* Buttons at the right end, under the text at phone width (handoff 35 §14). */}
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <strong className="block">{t('stuck.alertTitle')}</strong>
          {t('stuck.alertBody', {
            since: stuckSince(stuck.processingSince, new Date(), translator),
            why: stuckWhy(stuck.lastJob, who, translator).replace(/^\p{Lu}/u, (letter) =>
              letter.toLowerCase(),
            ),
          })}
        </span>
        <div className="flex shrink-0 flex-wrap gap-2">
          {can('narration.job.manage') ? <StuckRegenerate placeId={placeId} name={name} /> : null}
          {stuck.lastJob === null || !can('narration.job.read') ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/narration/jobs/${stuck.lastJob!.id}`)}
            >
              <ExternalLink aria-hidden />
              {t('stuck.openJob')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
