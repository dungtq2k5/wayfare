'use client';

import { placesByCode } from '@wayfare/api-client';
import type { AreaResponseDto, PlaceSummaryResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { cn } from '@wayfare/ui/cn';
import {
  Check,
  ChevronDown,
  CloudOff,
  Compass,
  Info,
  LoaderCircle,
  LocateFixed,
  LocateOff,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  WifiOff,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useWeb } from '../i18n/provider';
import { categoryIcon } from '../places/category-icon';
import { openedPlaces } from '../places/opened';
import { PlaceCard } from '../places/place-card';
import { useNearby } from '../places/use-nearby';
import { Sheet } from '../ui/sheet';
import { DESK, TABLET, useMediaQuery } from '../ui/use-media-query';
import type { OpenedPlace } from '../client/db';
import { AreaMap } from './area-map';
import type { MapView } from './area-map';
import { AreaRow } from './area-row';
import { insidePolygon, metresBetween } from './geo';
import type { Point } from './geo';
import { PlacePreview } from './place-preview';
import { areaStyle } from './style';
import { keepNearby, keptNearby, minutesAgo, offlineList } from './kept-nearby';
import type { KeptNearby } from './kept-nearby';
import { formatDate } from '../places/format';
import { ToursList } from '../tours/tours-list';

/** The chips the handoff draws (WM1): the categories the pilot's two areas hold. */
const CHIPS = ['LANDMARK', 'CHURCH', 'MARKET', 'STREET_FOOD'] as const;

/** After this long without a drawn map, WM5 says the connection is slow. */
const SLOW_MS = 3_000;

/** The city's centre, for a tourist outside every area (WM4b). */
const CITY: Point = { lat: 10.776, lng: 106.7 };

type Location =
  { kind: 'off' } | { kind: 'asking' } | { kind: 'on'; point: Point } | { kind: 'refused' };

/** The chips (WM1): a toolbar, arrow keys between them, one line scrolling sideways on a phone. */
function CategoryChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const { t, tDynamic } = useWeb();
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = chips.indexOf(document.activeElement as HTMLButtonElement);
    chips[
      Math.max(0, Math.min(chips.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))
    ]?.focus();
    event.preventDefault();
  };
  const chip = (code: string | null, label: string, Icon: typeof Compass) => {
    const on = value === code;
    return (
      <button
        key={code ?? 'all'}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(code)}
        className={cn(
          'flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
          on
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card text-foreground hover:bg-muted',
        )}
      >
        {on ? <Check aria-hidden className="size-5" /> : null}
        <Icon aria-hidden className="size-5" />
        {label}
      </button>
    );
  };
  return (
    <div
      role="toolbar"
      aria-label={t('map.categories')}
      onKeyDown={onKey}
      className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2 tablet:flex-wrap tablet:overflow-visible tablet:py-0"
    >
      {chip(null, t('map.all'), Compass)}
      {CHIPS.map((code) => chip(code, tDynamic(`map.chip.${code}`), categoryIcon(code)))}
    </div>
  );
}

/**
 * An area's map (WM1–WM5b): the chips, the map with its area switcher and *Locate me*, and the list
 * of Places near the map's centre — or the tourist, when allowed. A marker or a row opens the Place
 * in a bottom sheet, or the side panel from 1200 px.
 */
export function MapPage({
  areas,
  area,
  placeCode,
  host,
}: {
  areas: readonly AreaResponseDto[];
  area: AreaResponseDto;
  placeCode: string | null;
  host: string;
}) {
  const { t, tDynamic, locale } = useWeb();
  const router = useRouter();
  const tablet = useMediaQuery(TABLET);
  const desk = useMediaQuery(DESK);
  const [category, setCategory] = useState<string | null>(null);
  // TW1: *Places · Tours*; a link to an area's tours (`?view=tours`, TW3) opens the second.
  const [tab, setTab] = useState<'places' | 'tours'>('places');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'tours') setTab('tours');
  }, []);
  const [view, setView] = useState<MapView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [location, setLocation] = useState<Location>({ kind: 'off' });
  const [explainer, setExplainer] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  const [opened, setOpened] = useState<OpenedPlace[]>([]);
  const [flyTo, setFlyTo] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    offsetX?: number;
  } | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => setStyle(areaStyle(area)), [area]);

  const user = location.kind === 'on' ? location.point : null;
  const outside =
    user !== null && !areas.some((candidate) => insidePolygon(user, candidate.boundary));
  const origin = user !== null && !outside ? user : (view?.center ?? area.center);
  const nearby = useNearby(outside ? null : origin, view?.radiusM ?? 1000, category);
  // BT2 (K10): the last answer kept on this browser, shown offline by distance, nothing sponsored.
  const [kept, setKept] = useState<KeptNearby | null>(null);
  useEffect(() => void keptNearby().then(setKept), []);
  useEffect(() => {
    if (offline || nearby.data === undefined || nearby.isPlaceholderData) return;
    keepNearby(nearby.data);
    setKept({ loadedAt: Date.now(), places: nearby.data });
  }, [offline, nearby.data, nearby.isPlaceholderData]);
  const fromKept = offline && kept !== null;
  const places: readonly PlaceSummaryResponseDto[] = useMemo(
    () => (fromKept ? offlineList(kept.places) : (nearby.data ?? [])),
    [fromKept, kept, nearby.data],
  );
  const selectedPlace = places.find((place) => place.id === selected) ?? null;

  // WM5: the map's place held while it draws; after 3 s, the list is said to be ready below.
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
  // WM5b: offline with no map drawn — the Places opened on this browser below.
  useEffect(() => {
    const check = () => setOffline(!navigator.onLine);
    check();
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);
  useEffect(() => {
    if (offline && !loaded) void openedPlaces().then(setOpened);
  }, [offline, loaded]);

  // A link's `?place=` (*See it on the map*): the map moves to that Place, and opens it once the
  // list around it holds it.
  const wanted = useRef(placeCode?.replaceAll('-', '').toUpperCase() ?? null);
  useEffect(() => {
    const code = wanted.current;
    if (code === null) return;
    let live = true;
    placesByCode(code, { lang: locale }).then(
      ({ data }) => live && setFlyTo({ ...data.location, zoom: 17 }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [locale]);
  useEffect(() => {
    if (wanted.current === null) return;
    const match = places.find((place) => place.publicCode === wanted.current);
    if (match !== undefined) {
      wanted.current = null;
      setSelected(match.id);
    }
  }, [places]);

  const open = useCallback(
    (place: PlaceSummaryResponseDto) => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelected(place.id);
      // From 1200 px the map pans so the marker isn't under the panel.
      setFlyTo({ ...place.location, offsetX: desk ? -216 : 0 });
    },
    [desk],
  );
  const close = () => {
    setSelected(null);
    opener.current?.focus();
  };

  const locate = () => {
    if (location.kind === 'on' && user !== null) {
      setFlyTo({ ...user });
      return;
    }
    setExplainer(true);
  };
  const askBrowser = () => {
    setExplainer(false);
    if (!('geolocation' in navigator)) {
      setLocation({ kind: 'refused' });
      return;
    }
    setLocation({ kind: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setLocation({ kind: 'on', point });
        const home = areas.find((candidate) => insidePolygon(point, candidate.boundary));
        setFlyTo(home === undefined ? { ...CITY, zoom: 12 } : { ...point, zoom: 16 });
      },
      () => setLocation({ kind: 'refused' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const chooseArea = (next: AreaResponseDto) => {
    setChooser(false);
    setSelected(null);
    if (next.code === area.code) {
      setFlyTo({ ...next.center, zoom: next.defaultZoom });
      return;
    }
    router.push(`/map/${next.code}`);
  };

  const areaName = tDynamic(`area.${area.code}`);
  const fromYou = user !== null && !outside;
  const mapPlaces = useMemo(
    () =>
      places.map((place) => ({
        id: place.id,
        categoryCode: place.categoryCode,
        name: place.name,
        location: place.location,
        sponsored: place.sponsored,
      })),
    [places],
  );
  const showMap = !(offline && !loaded);
  const sponsoredWords = useMemo(
    () => ({
      chip: t('card.sponsored'),
      label: (name: string) => t('map.sponsoredMarker', { name }),
    }),
    [t],
  );
  const anySponsored = places.some((place) => place.sponsored);

  const switcher = (
    <button
      type="button"
      onClick={() => setChooser(true)}
      aria-haspopup="dialog"
      className="absolute top-3 left-3 z-10 flex h-11 items-center gap-2 rounded-full bg-card px-4 text-sm font-medium text-foreground shadow-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MapPin aria-hidden className="size-5 text-primary" />
      {outside ? t('map.chooseArea') : areaName}
      <ChevronDown aria-hidden className="size-5" />
    </button>
  );

  const mapBox = showMap ? (
    <AreaMap
      style={style}
      center={outside ? CITY : area.center}
      zoom={outside ? 12 : area.defaultZoom}
      places={outside ? [] : mapPlaces}
      selectedId={selected}
      onSelect={(id) => {
        const place = places.find((candidate) => candidate.id === id);
        if (place !== undefined) open(place);
      }}
      onMoved={setView}
      onLoaded={() => setLoaded(true)}
      user={user}
      label={t('map.label', { area: areaName })}
      className="h-95 w-full tablet:h-full"
      flyTo={flyTo}
      zoomControls={tablet}
      zoomInLabel={t('map.zoomIn')}
      zoomOutLabel={t('map.zoomOut')}
      sponsoredWords={sponsoredWords}
      zoomRightPx={desk && selectedPlace !== null ? 432 : 16}
    >
      {switcher}
      {loaded ? null : (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-center text-sm text-muted-foreground"
        >
          <LoaderCircle
            aria-hidden
            className="size-6 animate-spin text-primary motion-reduce:animate-none"
          />
          <p className="font-medium text-foreground">{t('map.drawing')}</p>
          {slow ? <p>{t('map.slow')}</p> : null}
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-xs text-muted-foreground">
        {t('map.attribution')}
      </span>
      <button
        type="button"
        aria-label={t('map.locate')}
        onClick={locate}
        className="absolute right-3 bottom-3 flex size-12 items-center justify-center rounded-full bg-card text-foreground shadow-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {location.kind === 'refused' ? (
          <LocateOff aria-hidden className="size-6" />
        ) : (
          <LocateFixed aria-hidden className="size-6" />
        )}
      </button>
      {desk && selectedPlace !== null ? (
        <PlacePreview
          place={selectedPlace}
          areaCode={area.code}
          fromYou={fromYou}
          onClose={close}
          panel
        />
      ) : null}
    </AreaMap>
  ) : (
    <div
      role="status"
      className="flex h-95 w-full flex-col items-center justify-center gap-2 bg-muted px-6 text-center tablet:h-full"
    >
      <CloudOff aria-hidden className="size-8 text-muted-foreground" />
      <p className="text-base font-semibold text-foreground">{t('map.offlineTitle')}</p>
      <p className="text-sm text-muted-foreground">{t('map.offlineBody')}</p>
      <Button variant="outline" size="lg" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden />
        {t('common.tryAgain')}
      </Button>
    </div>
  );

  const openedLine = (place: OpenedPlace) => {
    const days = Math.floor((Date.now() - place.openedAt) / 86_400_000);
    return days === 0
      ? t('map.openedToday')
      : days === 1
        ? t('map.openedYesterday')
        : t('map.openedOn', { date: formatDate(new Date(place.openedAt), locale) });
  };

  const list = outside ? (
    <section aria-labelledby="outside-heading" className="flex flex-col gap-4 px-4 py-5">
      <h2 id="outside-heading" className="text-lg font-semibold text-foreground">
        {t('map.outsideTitle')}
      </h2>
      <p className="text-base text-muted-foreground">{t('map.outsideBody')}</p>
      <ul className="flex flex-col gap-3">
        {[...areas]
          .sort((a, b) => metresBetween(user, a.center) - metresBetween(user, b.center))
          .map((candidate) => (
            <li key={candidate.id}>
              <AreaRow
                area={candidate}
                selected={false}
                awayM={metresBetween(user, candidate.center)}
                onChoose={() => chooseArea(candidate)}
              />
            </li>
          ))}
      </ul>
    </section>
  ) : !showMap && !fromKept ? (
    <section aria-labelledby="opened-heading" className="flex flex-col gap-3 px-4 py-5">
      <h2 id="opened-heading" className="text-lg font-semibold text-foreground">
        {t('map.openedHere')}
      </h2>
      <ul className="flex flex-col gap-3">
        {opened.map((place) => (
          <li key={place.code}>
            <PlaceCard
              place={{
                publicCode: place.code,
                name: place.name,
                categoryCode: place.categoryCode,
                cardPhoto: null,
                distanceM: 0,
                walkingEtaMinutes: 0,
                sponsored: false,
              }}
              extra={<span className="text-sm text-muted-foreground">{openedLine(place)}</span>}
              hideDistance
            />
          </li>
        ))}
      </ul>
    </section>
  ) : (
    <section aria-labelledby="near-heading" className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="near-heading" className="text-lg font-semibold text-foreground">
          {fromKept
            ? `${t('map.nearCentre')} · ${
                minutesAgo(kept.loadedAt) === 0
                  ? t('map.fromJustNow')
                  : t('map.fromAgo', { n: minutesAgo(kept.loadedAt) })
              }`
            : fromYou
              ? t('map.nearYou')
              : t('map.nearCentre')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('map.count', { n: places.length })}</p>
      </div>
      {location.kind === 'on' && fromYou ? (
        <p role="status" className="sr-only">
          {t('map.locShowing')}
        </p>
      ) : null}
      {nearby.isSuccess && places.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('map.none')}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {places.map((place) => (
          <li key={place.id}>
            <PlaceCard
              place={place}
              walking={fromYou}
              onOpen={() => open(place)}
              selected={place.id === selected}
            />
          </li>
        ))}
      </ul>
      {fromKept ? (
        <p className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t('map.offlineList')}
        </p>
      ) : anySponsored ? (
        <p className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t('map.sponsoredNote')}
        </p>
      ) : null}
    </section>
  );

  return (
    <main
      id="content"
      tabIndex={-1}
      className="flex flex-1 flex-col outline-none tablet:map-height tablet:flex-none tablet:flex-row"
    >
      <h1 className="sr-only">{t('map.title')}</h1>
      <div className="flex flex-col tablet:order-1 tablet:w-80 tablet:overflow-y-auto tablet:border-r tablet:border-border tablet:pt-6 desk:w-100">
        {outside ? null : <ListTabs tab={tab} onTab={setTab} />}
        {tab === 'tours' && !outside ? (
          <div className="px-4 py-4">
            <ToursList areaId={area.id} areaName={areaName} />
          </div>
        ) : (
          <CategoryChips
            value={category}
            onChange={(code) => {
              setCategory(code);
              setSelected(null);
            }}
          />
        )}
        {location.kind === 'refused' ? (
          <p
            role="status"
            className="mx-4 mb-2 flex gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground tablet:mt-3"
          >
            <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t('map.locOff', { area: areaName, host })}
          </p>
        ) : null}
        {/* One map: here on a phone, beside the list from 720 px. The tours list has none. */}
        {tablet || (tab === 'tours' && !outside) ? null : mapBox}
        {tab === 'tours' && !outside ? null : list}
      </div>
      <div className="hidden min-w-0 flex-1 tablet:order-2 tablet:block">
        {tablet ? mapBox : null}
      </div>

      {/* WM2: the reason first, then the browser's own prompt. */}
      <Sheet
        open={explainer}
        onOpenChange={setExplainer}
        title={t('map.locTitle')}
        className="right-4 bottom-4 left-4 w-auto rounded-2xl tablet:right-0 tablet:left-0 tablet:w-140"
      >
        <p className="text-sm text-muted-foreground">{t('map.locBody')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="lg" onClick={() => setExplainer(false)}>
            {t('map.locNotNow')}
          </Button>
          <Button size="lg" onClick={askBrowser}>
            <Navigation aria-hidden />
            {t('map.locUse')}
          </Button>
        </div>
      </Sheet>

      {/* WM4: the areas. */}
      <Sheet open={chooser} onOpenChange={setChooser} title={t('map.chooseArea')}>
        <ul className="flex flex-col gap-3">
          {areas.map((candidate) => (
            <li key={candidate.id}>
              <AreaRow
                area={candidate}
                selected={candidate.code === area.code && !outside}
                onChoose={() => chooseArea(candidate)}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t('map.areasLater')}</p>
      </Sheet>

      {/* WM3 on a phone and at 720 px: the bottom sheet. */}
      {!desk && selectedPlace !== null ? (
        <Sheet
          open
          onOpenChange={(next) => (next ? undefined : close())}
          title={selectedPlace.name}
          titleHidden
        >
          <PlacePreview
            place={selectedPlace}
            areaCode={area.code}
            fromYou={fromYou}
            panel={false}
          />
        </Sheet>
      ) : null}
    </main>
  );
}

/** *Places · Tours* (TW1): an area's Places and its tours, the list's two views. */
function ListTabs({
  tab,
  onTab,
}: {
  tab: 'places' | 'tours';
  onTab: (tab: 'places' | 'tours') => void;
}) {
  const { t } = useWeb();
  const item = (value: 'places' | 'tours', Icon: typeof MapPin, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => onTab(value)}
      className={cn(
        'inline-flex h-11 items-center gap-2 border-b-2 px-4 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tab === value
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon aria-hidden className="size-5" />
      {label}
    </button>
  );
  return (
    <div role="tablist" className="mx-4 flex border-b border-border">
      {item('places', MapPin, t('tours.places'))}
      {item('tours', Route, t('tours.tours'))}
    </div>
  );
}
