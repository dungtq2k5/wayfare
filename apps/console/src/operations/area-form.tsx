'use client';

import { useQuery } from '@tanstack/react-query';
import {
  adminAreasCreate,
  adminAreasList,
  adminAreasUpdate,
  adminPlacesList,
  ApiError,
} from '@wayfare/api-client';
import type { AdminAreaResponseDto, CreateAreaDto } from '@wayfare/api-client';
import { AREA_ZOOM_MAX, AREA_ZOOM_MIN, zAreaCode } from '@wayfare/contracts';
import { BoundaryMap } from '@wayfare/ui/boundary-map';
import type { BoundaryMode } from '@wayfare/ui/boundary-map';
import { boundaryMiddle, closedRing, openRing } from '@wayfare/ui/boundary-model';
import type { BoundaryState, Vertex } from '@wayfare/ui/boundary-model';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FieldError, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import { FileText, Locate, Lock, Pencil, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { errorText } from '../client/errors';
import { useMapStyle } from '../content/place-page';
import { useAreas } from '../content/reference';
import type { FieldErrors } from '../forms/field-errors';
import type { Translator } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useAreaName } from './areas';
import { parseBoundary } from './geojson';

type Area = AdminAreaResponseDto;

/** The zoom's words (A3): what a default zoom shows. */
export function zoomWords(zoom: number, { t }: Translator): string {
  if (zoom <= 11) return t('areaForm.zoom.city', { zoom });
  if (zoom <= 13) return t('areaForm.zoom.district', { zoom });
  if (zoom <= 15) return t('areaForm.zoom.streets', { zoom });
  return t('areaForm.zoom.street', { zoom });
}

/** A refusal said above the form and drawn on the map (A4, A4b). */
type Refusal =
  | { kind: 'overlap'; area: { name: string; code: string }; ring: Vertex[] }
  | { kind: 'outside'; count: number; names: string[]; points: Vertex[] };

const NAMED_OUTSIDE = 3;
const fixed = (value: number) => value.toFixed(4);

/** The pasted boundary's example: GeoJSON reads the same in both languages. */
const GEOJSON_EXAMPLE = '{ "type": "Polygon", "coordinates": [[ [106.6921, 10.7801], … ]] }';
const sameRing = (a: readonly Vertex[], b: readonly Vertex[]) =>
  a.length === b.length &&
  a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);

/**
 * A new area or an area's edit (A3–A4b): the code (fixed after create) and the Vietnamese name; the
 * boundary drawn, edited or pasted, with its text line; the camera's centre and zoom. Overlap and
 * Places left outside are said above the form and drawn on the map.
 */
export function AreaForm({ area }: { area: Area | null }) {
  const translator = useConsole();
  const { t } = translator;
  const router = useRouter();
  const nameOf = useAreaName();
  const areas = useAreas();
  const others = useQuery({
    queryKey: ['admin-areas'],
    queryFn: async () => (await adminAreasList()).data,
  });
  const places = useQuery({
    queryKey: ['area-places', area?.id],
    queryFn: async () => (await adminPlacesList({ areaId: area!.id, pageSize: 100 })).data,
    enabled: area !== null,
  });
  const initialRing = area === null ? [] : openRing(area.boundary.coordinates[0] as Vertex[]);
  const [code, setCode] = useState(area?.code ?? '');
  const [nameVi, setNameVi] = useState(area?.nameVi ?? '');
  const [boundary, setBoundary] = useState<BoundaryState>({ points: initialRing, selected: null });
  const [mode, setMode] = useState<BoundaryMode>(area === null ? 'draw' : 'edit');
  const [centre, setCentre] = useState<Vertex | null>(
    area === null ? null : [area.center.lng, area.center.lat],
  );
  // The centre follows the boundary's middle until someone sets it.
  const [centreSet, setCentreSet] = useState(area !== null);
  const [centreText, setCentreText] = useState<string | null>(null);
  const [zoom, setZoom] = useState(area?.defaultZoom ?? 15);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const helpId = useId();

  const pilot = areas.data?.find((row) => row.mapPack !== null);
  const style = useMapStyle(area?.id ?? '') ?? pilot?.mapPack?.style ?? null;
  const shownCentre = centreSet ? centre : boundaryMiddle(boundary.points);
  const mapCentre = area?.center ?? pilot?.center ?? { lat: 10.7769, lng: 106.7009 };
  const dirty =
    !saved &&
    (code !== (area?.code ?? '') ||
      nameVi !== (area?.nameVi ?? '') ||
      !sameRing(boundary.points, initialRing) ||
      zoom !== (area?.defaultZoom ?? 15) ||
      (area !== null && (centre?.[0] !== area.center.lng || centre[1] !== area.center.lat)));
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);

  const change = (next: BoundaryState) => {
    setBoundary(next);
    setRefusal(null);
  };
  const back = area === null ? '/areas' : `/areas/${area.id}`;

  const check = (): CreateAreaDto | null => {
    const found: FieldErrors = {};
    if (area === null && !zAreaCode.safeParse(code).success)
      found.code = code === '' ? t('issue.required') : t('issue.generic');
    if (nameVi.trim() === '') found.nameVi = t('required.nameVi');
    if (boundary.points.length < 3) found.boundary = t('areaForm.needShape');
    if (shownCentre === null) found.center = t('areaForm.centreInvalid');
    setErrors(found);
    if (Object.keys(found).length > 0 || shownCentre === null) return null;
    return {
      code,
      nameVi: nameVi.trim(),
      boundary: { type: 'Polygon', coordinates: [closedRing(boundary.points).map((p) => [...p])] },
      center: { lat: shownCentre[1], lng: shownCentre[0] },
      defaultZoom: zoom,
      sortOrder: Math.max(0, ...(others.data ?? []).map((row) => row.sortOrder)) + 10,
      isActive: false,
    };
  };

  const refused = (error: unknown): boolean => {
    if (!(error instanceof ApiError)) return false;
    const details = error.details as Record<string, unknown> | undefined;
    if (error.code === 'AREA_OVERLAPS') {
      const codes = (details?.codes as string[] | undefined) ?? [];
      const other = others.data?.find((row) => row.code === codes[0]);
      setRefusal({
        kind: 'overlap',
        area: {
          name: other === undefined ? (codes[0] ?? '') : nameOf(other),
          code: codes[0] ?? '',
        },
        ring: other === undefined ? [] : openRing(other.boundary.coordinates[0] as Vertex[]),
      });
      return true;
    }
    if (error.code === 'AREA_EXCLUDES_PLACES') {
      const ids = (details?.placeIds as string[] | undefined) ?? [];
      // The API names the first 20; the count says them all.
      const rows = (places.data ?? []).filter((row) => ids.includes(row.id));
      setRefusal({
        kind: 'outside',
        count: Number(details?.count ?? ids.length),
        names: rows.map((row) => row.nameVi),
        points: rows.map((row) => [row.location.lng, row.location.lat] as const),
      });
      return true;
    }
    if (error.code === 'VALIDATION_FAILED') {
      const issues = (details?.issues as { path?: string; code?: string }[] | undefined) ?? [];
      const found: FieldErrors = {};
      for (const issue of issues) {
        const field = (issue.path ?? '').split('/')[1] ?? '';
        if (field === 'code' && issue.code === 'taken')
          found.code = t('areaForm.codeTaken', { code });
        else if (field === 'boundary') found.boundary = t('geojson.crossing');
        else if (field === 'center') found.center = t('areaForm.centreInvalid');
        else if (field !== '') found[field] = t('issue.generic');
      }
      setErrors(found);
      return Object.keys(found).length > 0;
    }
    return false;
  };

  const submit = () => {
    const body = check();
    if (body === null) return;
    setAlert(null);
    setRefusal(null);
    setBusy(true);
    const { code: _code, isActive: _active, sortOrder: _order, ...patch } = body;
    const request = area === null ? adminAreasCreate(body) : adminAreasUpdate(area.id, patch);
    request.then(
      ({ data }) => {
        setBusy(false);
        setSaved(true);
        toast.success(area === null ? t('areaForm.created') : t('areaForm.saved'));
        router.push(`/areas/${data.area.id}`);
        router.refresh();
      },
      (error: unknown) => {
        setBusy(false);
        if (!refused(error)) setAlert(errorText(error, translator));
      },
    );
  };

  const selected = boundary.selected === null ? undefined : boundary.points[boundary.selected];
  const line = [
    shownCentre === null || boundary.points.length === 0
      ? t('areaForm.lineEmpty', { points: boundary.points.length })
      : t('areaForm.line', {
          points: boundary.points.length,
          lat: fixed(shownCentre[1]),
          lng: fixed(shownCentre[0]),
        }),
    selected === undefined
      ? null
      : t('areaForm.lineSelected', {
          index: (boundary.selected ?? 0) + 1,
          lat: fixed(selected[1]),
          lng: fixed(selected[0]),
        }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const name = area === null ? '' : nameOf(area);

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/areas" className="hover:underline">
              {t('areas.title')}
            </Link>
            {area === null ? null : (
              <>
                {' / '}
                <Link href={`/areas/${area.id}`} className="hover:underline">
                  {name}
                </Link>
              </>
            )}
          </span>
        }
        title={area === null ? t('areaForm.newTitle') : t('areaForm.editTitle', { name })}
        description={t('areaForm.lead')}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex max-w-4xl flex-col gap-6">
          {refusal?.kind === 'overlap' ? (
            <FormAlert>
              <strong className="block">
                {t('areaForm.overlapTitle', { area: refusal.area.name })}
              </strong>
              {t('areaForm.overlapBody', { area: refusal.area.name, code: refusal.area.code })}
            </FormAlert>
          ) : refusal?.kind === 'outside' ? (
            <FormAlert>
              <strong className="block">
                {t('areaForm.outsideTitle', { count: refusal.count })}
              </strong>
              {t('areaForm.outsideBody', {
                names: [
                  ...refusal.names.slice(0, NAMED_OUTSIDE),
                  ...(refusal.count > NAMED_OUTSIDE
                    ? [t('areaForm.andMore', { count: refusal.count - NAMED_OUTSIDE })]
                    : []),
                ].join(', '),
              })}
            </FormAlert>
          ) : alert === null ? null : (
            <FormAlert>{alert}</FormAlert>
          )}
          <FormSection title={t('areaForm.about')}>
            <div className="grid gap-4 md:grid-cols-2">
              {area === null ? (
                <Field
                  label={t('areaForm.code')}
                  required
                  help={t('areaForm.codeHelp')}
                  error={errors.code}
                >
                  {(control) => (
                    <Input
                      {...control}
                      placeholder={t('areaForm.codePlaceholder')}
                      value={code}
                      autoComplete="off"
                      onChange={(event) => setCode(event.target.value.toLowerCase())}
                    />
                  )}
                </Field>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-foreground">{t('areaForm.code')}</span>
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <Lock aria-hidden className="size-4 text-muted-foreground" />
                    {area.code}
                  </span>
                  <p className="text-xs text-muted-foreground">{t('areaForm.codeFixed')}</p>
                </div>
              )}
              <Field
                label={t('areaForm.name')}
                required
                help={t('areaForm.nameHelp')}
                error={errors.nameVi}
              >
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('areaForm.namePlaceholder')}
                    lang="vi"
                    value={nameVi}
                    onChange={(event) => setNameVi(event.target.value)}
                  />
                )}
              </Field>
            </div>
          </FormSection>
          <FormSection title={t('areaForm.boundary')}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={mode === 'draw' ? 'secondary' : 'outline'}
                aria-pressed={mode === 'draw'}
                onClick={() => setMode('draw')}
              >
                <Pencil aria-hidden />
                {t('areaForm.draw')}
              </Button>
              <Button
                type="button"
                variant={mode === 'edit' ? 'secondary' : 'outline'}
                aria-pressed={mode === 'edit'}
                onClick={() => setMode('edit')}
              >
                <Locate aria-hidden />
                {t('areaForm.editPoints')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPasting(true)}>
                <FileText aria-hidden />
                {t('areaForm.paste')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                disabled={boundary.points.length === 0}
                onClick={() => change({ points: boundary.points.slice(0, -1), selected: null })}
              >
                <Undo2 aria-hidden />
                {t('areaForm.undo')}
              </Button>
            </div>
            {style === null ? null : (
              <BoundaryMap
                style={style}
                center={mapCentre}
                zoom={area?.defaultZoom ?? 15}
                state={boundary}
                onChange={change}
                mode={mode}
                onClose={() => setMode('edit')}
                overlays={{
                  places: (places.data ?? []).map(
                    (row) => [row.location.lng, row.location.lat] as const,
                  ),
                  overlap: refusal?.kind === 'overlap' ? refusal.ring : null,
                  outside: refusal?.kind === 'outside' ? refusal.points : [],
                }}
                label={t('areaForm.mapLabel')}
                describedBy={helpId}
                centre={shownCentre}
                onCentre={(point) => {
                  setCentre(point);
                  setCentreSet(true);
                  setCentreText(null);
                }}
                className="h-96"
              />
            )}
            <p role="status" className="text-xs text-muted-foreground">
              {line}
            </p>
            {errors.boundary === undefined ? null : <FieldError>{errors.boundary}</FieldError>}
            <p id={helpId} className="text-xs text-muted-foreground">
              {t('areaForm.keys')}
            </p>
          </FormSection>
          <FormSection title={t('areaForm.camera')}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('areaForm.centre')}
                required
                help={t('areaForm.centreHelp')}
                error={errors.center}
              >
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('areaForm.centrePlaceholder')}
                    inputMode="decimal"
                    value={
                      centreText ??
                      (shownCentre === null
                        ? ''
                        : `${fixed(shownCentre[1])}, ${fixed(shownCentre[0])}`)
                    }
                    onChange={(event) => {
                      setCentreText(event.target.value);
                      const [lat, lng] = event.target.value
                        .split(',')
                        .map((part) => Number(part.trim()));
                      if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        setCentre([lng!, lat!]);
                        setCentreSet(true);
                      }
                    }}
                    // Read back at four decimals, as the line under the map; an unreadable one stays.
                    onBlur={() => {
                      const [lat, lng] = (centreText ?? '')
                        .split(',')
                        .map((part) => Number(part.trim()));
                      if (Number.isFinite(lat) && Number.isFinite(lng)) setCentreText(null);
                    }}
                  />
                )}
              </Field>
              <Field label={t('areaForm.zoom')} required help={t('areaForm.zoomHelp')}>
                {(control) => (
                  <select
                    {...control}
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {Array.from({ length: AREA_ZOOM_MAX - AREA_ZOOM_MIN + 1 }, (_, index) => (
                      <option key={index} value={AREA_ZOOM_MIN + index}>
                        {zoomWords(AREA_ZOOM_MIN + index, translator)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </FormSection>
        </div>
        <SaveBar>
          {area === null ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {t('areaForm.hidden')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving(back) : router.push(back))}
          >
            {t('action.cancel')}
          </Button>
          <Button type="submit" busy={busy ? t('action.saving') : undefined}>
            {area === null ? t('areaForm.create') : t('action.save')}
          </Button>
        </SaveBar>
      </form>
      {pasting ? (
        <GeoJsonDialog
          onOpenChange={setPasting}
          onUse={(points) => {
            change({ points, selected: null });
            setMode('edit');
            setPasting(false);
          }}
        />
      ) : null}
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: nameVi || t('areaForm.newTitle') })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          const href = leaving ?? back;
          setSaved(true);
          router.push(href);
        }}
      />
    </>
  );
}

/** Paste a boundary (A3b): checked before it closes; it replaces the drawn one. */
function GeoJsonDialog({
  onOpenChange,
  onUse,
}: {
  onOpenChange: (open: boolean) => void;
  onUse: (points: Vertex[]) => void;
}) {
  const { t, tDynamic } = useConsole();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('geojson.title')} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const result = parseBoundary(text);
            if ('error' in result) setError(tDynamic(`geojson.${result.error}`));
            else onUse(result.points);
          }}
        >
          <Field label={t('geojson.field')} required help={t('geojson.help')} error={error}>
            {(control) => (
              <Textarea
                {...control}
                placeholder={GEOJSON_EXAMPLE}
                rows={10}
                className="font-mono text-xs"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit">{t('geojson.use')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
