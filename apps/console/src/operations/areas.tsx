'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAreasGet,
  adminAreasList,
  adminAreasUpdate,
  adminMapPacksList,
  adminMapPacksPublish,
  adminPlacesList,
  ApiError,
} from '@wayfare/api-client';
import type { AdminAreaResponseDto, MapPackResponseDto } from '@wayfare/api-client';
import { BoundaryMap } from '@wayfare/ui/boundary-map';
import { openRing } from '@wayfare/ui/boundary-model';
import type { Vertex } from '@wayfare/ui/boundary-model';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { FormAlert } from '@wayfare/ui/field';
import { DataList, ListCard, PageHeader, RowChevron } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { Facts, RecordHistory, Section } from '../content/place-sections';
import { useMapStyle } from '../content/place-page';
import { useAreas } from '../content/reference';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';

type Area = AdminAreaResponseDto;
type Pack = MapPackResponseDto;

/** The live Places an area holds: tourists see the area while it has any (catalog's rule). */
const live = (area: Area) => area.placeCounts.ACTIVE + area.placeCounts.PROCESSING;
const total = (area: Area) =>
  area.placeCounts.ACTIVE +
  area.placeCounts.PROCESSING +
  area.placeCounts.DRAFT +
  area.placeCounts.INACTIVE;

/** An area's name: the app's string for its code, else its Vietnamese name. */
export function useAreaName() {
  const { tDynamic } = useConsole();
  return (area: { code: string; nameVi: string }) =>
    tDynamic(`area.${area.code}`, undefined, area.nameVi);
}

/** Every pack, newest version first, for a reader holding `map_pack.manage`. */
function usePacks(areaId?: string) {
  const can = useCan();
  return useQuery({
    queryKey: ['map-packs', areaId ?? 'all'],
    queryFn: async () =>
      (await adminMapPacksList(areaId === undefined ? undefined : { areaId })).data.toSorted(
        (a, b) => b.version - a.version,
      ),
    enabled: can('map_pack.manage'),
  });
}

/** The Places line (A1): counts by status in words. */
function PlaceCounts({ area }: { area: Area }) {
  const { t } = useConsole();
  if (total(area) === 0)
    return <span className="text-muted-foreground">{t('areas.noPlaces')}</span>;
  const other = area.placeCounts.DRAFT + area.placeCounts.INACTIVE;
  return (
    <span>
      {[
        t('areas.countActive', { count: area.placeCounts.ACTIVE }),
        area.placeCounts.PROCESSING > 0
          ? t('areas.countProcessing', { count: area.placeCounts.PROCESSING })
          : null,
        other > 0 ? t('areas.countOther', { count: other }) : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')}
    </span>
  );
}

/** The map pack line (A1): the published version and its date, else the newest unpublished. */
function PackLine({ area, packs }: { area: Area; packs: readonly Pack[] | undefined }) {
  const { t, locale } = useConsole();
  if (area.publishedPack !== null)
    return (
      <span>
        {t('areas.published', {
          version: area.publishedPack.version,
          date: formatDate(area.publishedPack.publishedAt, locale),
        })}
      </span>
    );
  const newest = packs?.find((pack) => pack.areaId === area.id);
  return (
    <span className="text-muted-foreground">
      {newest === undefined
        ? t('areas.noPack')
        : t('areas.notPublished', { version: newest.version })}
    </span>
  );
}

const statusBadge = (area: Area, t: ReturnType<typeof useConsole>['t']) =>
  area.isActive ? (
    <StatusBadge tone="active">{t('areas.active')}</StatusBadge>
  ) : (
    <StatusBadge tone="inactive">{t('areas.inactive')}</StatusBadge>
  );

/** Areas and map packs (A1). */
export function AreasList() {
  const { t } = useConsole();
  const can = useCan();
  const nameOf = useAreaName();
  const list = useQuery({
    queryKey: ['admin-areas'],
    queryFn: async () => (await adminAreasList()).data,
  });
  const packs = usePacks();
  const name = (area: Area) => (
    <Link href={`/areas/${area.id}`} className="flex flex-col hover:underline">
      <span className="font-medium text-foreground">{nameOf(area)}</span>
      <span className="text-xs text-muted-foreground">{area.code}</span>
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t('areas.title')}
        description={t('areas.lead')}
        action={
          can('catalog.taxonomy.manage') ? (
            <Button asChild>
              <Link href="/areas/new">
                <Plus aria-hidden />
                {t('areas.new')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataList
          caption={t('areas.title')}
          columns={[
            { key: 'area', label: t('areas.area') },
            { key: 'status', label: t('areas.status') },
            { key: 'places', label: t('areas.places') },
            { key: 'pack', label: t('areas.mapPack') },
          ]}
          rows={list.data}
          rowKey={(area) => area.id}
          cell={(area, column) => {
            switch (column) {
              case 'area':
                return name(area);
              case 'status':
                return statusBadge(area, t);
              case 'places':
                return <PlaceCounts area={area} />;
              default:
                return <PackLine area={area} packs={packs.data} />;
            }
          }}
          card={(area) => (
            <ListCard
              name={
                <Link
                  href={`/areas/${area.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {nameOf(area)}
                </Link>
              }
              status={statusBadge(area, t)}
              facts={
                <>
                  {area.code} · <PlaceCounts area={area} />
                </>
              }
              time={<PackLine area={area} packs={packs.data} />}
            />
          )}
          rowEnd={{ label: t('areas.area'), render: () => <RowChevron /> }}
        />
      )}
    </>
  );
}

/** A point as the page says it: four decimals, latitude first. */
const coordinate = (value: number) => value.toFixed(4);

/**
 * An area's page (A2): the boundary with its text line, the map packs (A5, for a reader holding
 * `map_pack.manage`), the history; Places by status and the facts at the side.
 */
export function AreaPage({ initial }: { initial: Area }) {
  const translator = useConsole();
  const { t } = translator;
  const can = useCan();
  const queries = useQueryClient();
  const nameOf = useAreaName();
  const area = useQuery({
    queryKey: ['admin-area', initial.id],
    queryFn: async () => (await adminAreasGet(initial.id)).data.area,
    initialData: initial,
  }).data;
  const areas = useAreas();
  const style =
    useMapStyle(area.id) ?? areas.data?.find((row) => row.mapPack !== null)?.mapPack?.style ?? null;
  const places = useQuery({
    queryKey: ['area-places', area.id],
    queryFn: async () => (await adminPlacesList({ areaId: area.id, pageSize: 100 })).data,
    enabled: can('place.read'),
  });
  const [dialog, setDialog] = useState<'activate' | 'deactivate' | null>(null);
  const [busy, setBusy] = useState(false);
  const name = nameOf(area);
  const ring = openRing(area.boundary.coordinates[0] as Vertex[]);
  const placeCount = total(area);

  const setActive = (isActive: boolean) => {
    setBusy(true);
    adminAreasUpdate(area.id, { isActive }).then(
      () => {
        setBusy(false);
        setDialog(null);
        void queries.invalidateQueries({ queryKey: ['admin-area', area.id] });
        void queries.invalidateQueries({ queryKey: ['admin-areas'] });
        void queries.invalidateQueries({ queryKey: ['areas'] });
        toast.success(isActive ? t('areas.activated', { name }) : t('areas.deactivated', { name }));
      },
      (error: unknown) => {
        setBusy(false);
        setDialog(null);
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/areas" className="text-sm text-muted-foreground hover:underline">
            {t('areas.title')}
          </Link>
        }
        title={name}
        badges={statusBadge(area, t)}
        description={`${area.code} · ${area.nameVi}`}
        action={
          can('catalog.taxonomy.manage') ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDialog(area.isActive ? 'deactivate' : 'activate')}
              >
                {area.isActive ? t('areas.deactivate') : t('areas.activate')}
              </Button>
              <Button asChild>
                <Link href={`/areas/${area.id}/edit`}>
                  <Pencil aria-hidden />
                  {t('areas.edit')}
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section id="boundary" title={t('areas.boundary')}>
            {style === null ? null : (
              <BoundaryMap
                style={style}
                center={area.center}
                zoom={area.defaultZoom}
                state={{ points: ring, selected: null }}
                overlays={{
                  places: (places.data ?? []).map(
                    (row) => [row.location.lng, row.location.lat] as const,
                  ),
                }}
                label={t('areas.mapLabel', { name })}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {t('areas.boundaryLine', {
                points: ring.length,
                lat: coordinate(area.center.lat),
                lng: coordinate(area.center.lng),
                zoom: area.defaultZoom,
                places: placeCount,
              })}
            </p>
          </Section>
          {can('map_pack.manage') ? <MapPacks area={area} /> : null}
          {can('audit.read') ? <RecordHistory resourceType="AREA" resourceId={area.id} /> : null}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3" aria-labelledby="area-places">
            <h2 id="area-places" className="text-lg font-semibold text-foreground">
              {t('areas.placesCard')}
            </h2>
            <Facts
              fit
              rows={(['ACTIVE', 'PROCESSING', 'DRAFT', 'INACTIVE'] as const).map(
                (status) =>
                  [translator.tDynamic(`status.${status}`), area.placeCounts[status]] as const,
              )}
            />
            {can('place.read') ? (
              <Button asChild variant="outline" className="self-start">
                <Link href={`/places?areaId=${area.id}`}>
                  <ExternalLink aria-hidden />
                  {t('areas.openInPlaces')}
                </Link>
              </Button>
            ) : null}
          </Card>
          <Card className="flex flex-col gap-3" aria-labelledby="area-facts">
            <h2 id="area-facts" className="text-lg font-semibold text-foreground">
              {t('areas.facts')}
            </h2>
            <Facts
              fit
              rows={[
                [t('areas.code'), area.code],
                [t('areas.nameVi'), <span lang="vi">{area.nameVi}</span>],
                [t('areas.defaultZoom'), area.defaultZoom],
                [t('areas.order'), area.sortOrder],
              ]}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={dialog === 'activate'}
        onOpenChange={(open) => setDialog(open ? 'activate' : null)}
        title={t('areas.activateTitle', { name })}
        description={t('areas.activateBody')}
        confirm={t('areas.activate')}
        busy={busy ? t('areas.activate') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={() => setActive(true)}
      />
      {/* A4c: with live Places the API refuses, so the dialog says so and keeps only Close. */}
      <Dialog
        open={dialog === 'deactivate'}
        onOpenChange={(open) => setDialog(open ? 'deactivate' : null)}
      >
        <DialogContent closeLabel={t('action.close')}>
          <DialogHeader
            title={t('areas.deactivateTitle', { name })}
            description={t('areas.deactivateBody')}
          />
          {live(area) > 0 ? (
            <FormAlert>
              <p className="font-medium">{t('areas.liveTitle', { name })}</p>
              <p>
                {t('areas.liveBody', {
                  live: live(area),
                  active: area.placeCounts.ACTIVE,
                  processing: area.placeCounts.PROCESSING,
                })}
              </p>
            </FormAlert>
          ) : null}
          <DialogFooter>
            {live(area) > 0 ? (
              <Button variant="outline" onClick={() => setDialog(null)}>
                {t('action.close')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  {t('action.cancel')}
                </Button>
                <Button
                  busy={busy ? t('areas.deactivate') : undefined}
                  onClick={() => setActive(false)}
                >
                  {t('areas.deactivate')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Megabytes, one decimal. */
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const PACK_TONE = { BUILDING: 'processing', PUBLISHED: 'active', RETIRED: 'inactive' } as const;
/** How long a retired pack's files are kept for downloads in progress (api §3.6). */
const RETIRED_FILES_DAYS = 30;

/** Map packs (A5): newest first; only a building version has *Publish* (K14). */
function MapPacks({ area }: { area: Area }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const queries = useQueryClient();
  const nameOf = useAreaName();
  const packs = usePacks(area.id);
  const [publishing, setPublishing] = useState<Pack | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const published = packs.data?.find((pack) => pack.status === 'PUBLISHED');

  const publish = (pack: Pack) => {
    setBusy(true);
    adminMapPacksPublish(pack.id).then(
      () => {
        setBusy(false);
        setPublishing(null);
        toast.success(t('packs.published', { version: pack.version }), {
          description: t('packs.publishedBody', { area: nameOf(area) }),
        });
        refresh();
      },
      (error: unknown) => {
        setBusy(false);
        setPublishing(null);
        // Published or retired elsewhere: say where it is, and show it (A5's 409).
        const status = (error instanceof ApiError &&
          (error.details as { status?: string } | undefined)?.status) as string | undefined;
        toast.error(
          error instanceof ApiError && error.code === 'INVALID_STATE' && status !== undefined
            ? tDynamic(
                `packs.already${status}`,
                { version: pack.version },
                errorText(error, translator),
              )
            : errorText(error, translator),
          { duration: Infinity },
        );
        refresh();
      },
    );
  };
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ['map-packs'] });
    void queries.invalidateQueries({ queryKey: ['admin-area', area.id] });
    void queries.invalidateQueries({ queryKey: ['admin-areas'] });
    void queries.invalidateQueries({ queryKey: ['areas'] });
  };

  const status = (pack: Pack) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={PACK_TONE[pack.status]}>
        {tDynamic(`packs.status.${pack.status}`)}
      </StatusBadge>
      {pack.status === 'RETIRED' && pack.retiredAt !== null ? (
        <span className="text-xs text-muted-foreground">
          {now - Date.parse(pack.retiredAt) > RETIRED_FILES_DAYS * 86_400_000
            ? t('packs.filesDeleted')
            : t('packs.kept')}
        </span>
      ) : null}
    </span>
  );
  const twoLines = (first: string, second: string) => (
    <span className="flex flex-col whitespace-nowrap">
      <span>{first}</span>
      <span className="text-xs text-muted-foreground">{second}</span>
    </span>
  );
  const size = (pack: Pack) =>
    twoLines(megabytes(pack.totalBytes), t('packs.zoom', { min: pack.minZoom, max: pack.maxZoom }));
  const source = (pack: Pack) =>
    twoLines(
      t('packs.osm', { date: formatDate(pack.sourceDate, locale) }),
      pack.styleDark === null ? t('packs.lightOnly') : t('packs.lightDark'),
    );
  // Who, with when under it, as Size and Source are (handoff 35 §14).
  const registered = (pack: Pack) =>
    twoLines(pack.createdBy.name ?? t('history.staff'), formatDate(pack.createdAt, locale));
  const action = (pack: Pack) =>
    pack.status === 'BUILDING' ? (
      <Button variant="outline" size="sm" onClick={() => setPublishing(pack)}>
        {t('packs.publish')}
      </Button>
    ) : null;

  return (
    <Section id="packs" title={t('areas.packs')}>
      <p className="text-sm text-muted-foreground">{t('areas.packsLead')}</p>
      {packs.isError ? (
        <ErrorView failure={failureOf(packs.error)} onRetry={() => void packs.refetch()} />
      ) : packs.data !== undefined && packs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('packs.empty')}</p>
      ) : (
        <DataList
          caption={t('areas.packs')}
          columns={[
            { key: 'version', label: t('packs.version') },
            { key: 'status', label: t('packs.status') },
            { key: 'size', label: t('packs.size') },
            { key: 'source', label: t('packs.source') },
            { key: 'registered', label: t('packs.registered') },
          ]}
          rows={packs.data}
          rowKey={(pack) => pack.id}
          skeletonRows={2}
          cell={(pack, column) => {
            switch (column) {
              case 'version':
                return (
                  <span className="whitespace-nowrap">
                    {t('packs.versionN', { version: pack.version })}
                  </span>
                );
              case 'status':
                return status(pack);
              case 'size':
                return size(pack);
              case 'source':
                return source(pack);
              default:
                return registered(pack);
            }
          }}
          card={(pack) => (
            <ListCard
              name={t('packs.versionN', { version: pack.version })}
              status={status(pack)}
              facts={`${megabytes(pack.totalBytes)} · ${t('packs.osm', { date: formatDate(pack.sourceDate, locale) })}`}
              time={registered(pack)}
            />
          )}
          rowEnd={{ label: t('packs.rowActions'), render: action }}
        />
      )}
      <ConfirmDialog
        open={publishing !== null}
        onOpenChange={(open) => {
          if (!open) setPublishing(null);
        }}
        title={
          publishing === null
            ? ''
            : t('packs.publishTitle', { version: publishing.version, area: nameOf(area) })
        }
        description={
          publishing === null
            ? ''
            : published === undefined
              ? t('packs.publishBodyFirst', { version: publishing.version })
              : t('packs.publishBody', { version: publishing.version, old: published.version })
        }
        confirm={
          publishing === null ? '' : t('packs.publishConfirm', { version: publishing.version })
        }
        busy={busy ? t('packs.publish') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={() => {
          if (publishing !== null) publish(publishing);
        }}
      />
    </Section>
  );
}
