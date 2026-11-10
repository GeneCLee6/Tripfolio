import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { formatDate } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/map.ts'
import { tripPath } from '../../app/sections.ts'
import { useTripContext } from '../../app/trip-context.ts'
import {
  Button,
  Chip,
  DayChip,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Sheet,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import { ChevronDownIcon } from '../../components/icons.tsx'
import { isApiError } from '../../lib/api.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useMediaQuery } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { FUEL_ID_PREFIX, type MapDay } from '../../lib/map/assemble.ts'
import { mapApi } from '../../lib/map/map-api.ts'
import { useDayRoutes, useTripMapData } from '../../lib/map/useTripMapData.ts'
import {
  googleMapsUrl,
  LAYER_LABEL_KEYS,
  LazyTripMap,
  MAP_LAYER_KEYS,
  type MapAction,
  type MapLayerKey,
  type MapLayers,
  type MapMode,
  type MapPoint,
  type TripMapProps,
} from '../../map/index.ts'
import { focusRing, visuallyHidden } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space, zIndex } from '../../styles/tokens.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'

// /trips/:id/map (e3-t04 frontend, e3-t05 layer panel; DESIGN.md §4 地圖頁): the trip map filling
// the section — phone: between the top bar and the bottom navigation; wider: the centre column —
// with 全程／Day N top left, the layer panel top right, and a manual pin on long press.

const TOP_BAR = 56
const BOTTOM_NAV = 64

type View = 'trip' | 'day'

// 下載離線地圖 (e3-t06) loads on the first tap
const OfflineMapSheet = lazy(() => import('../../lib/offline/OfflineMapSheet.tsx'))

const HINT_KEYS: Partial<Record<MapLayerKey, MessageKey>> = {
  pocket: 'mapPage.layerHint.pocket',
  lodging: 'mapPage.layerHint.lodging',
  picks: 'mapPage.layerHint.picks',
  fuel: 'mapPage.layerHint.fuel',
}

declare global {
  interface Window {
    /** Development only: the map instance, for Playwright */
    __tripfolioMap?: Parameters<NonNullable<TripMapProps['onReady']>>[0]
  }
}

export default function MapPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { trip, me } = useTripContext()
  const { status, error, data, reload, addPlace } = useTripMapData(trip, t.locale)
  const wide = useMediaQuery(media.tablet)

  const [view, setView] = useState<View>('trip')
  const [chosenDay, setChosenDay] = useState<number | null>(null)
  const [layers, setLayers] = useState<MapLayers>({
    itinerary: true,
    pocket: true,
    lodging: true,
    picks: true,
    fuel: true,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [drop, setDrop] = useState<MapPoint | null>(null)
  const [forceMap, setForceMap] = useState(false)
  const [offlineMap, setOfflineMap] = useState({ loaded: false, open: false })
  const offlinePoints = useMemo(
    () => (data ? [...data.stops, ...data.pocket, ...data.lodging, ...data.picks, ...data.fuel] : []),
    [data],
  )

  const days = useMemo(() => data?.days ?? [], [data])
  // Day N defaults to the first day with something on the map
  const firstLocatedDay = data?.stops.length
    ? Math.min(...data.stops.map((stop) => stop.dayIndex))
    : (days[0]?.dayIndex ?? 0)
  const day = chosenDay ?? firstLocatedDay
  const mode: MapMode = view === 'trip' || days.length === 0 ? 'trip' : { day }

  const onRoutesError = useCallback(
    (caught: unknown) => {
      const limited = isApiError(caught) && caught.status === 429
      toast.show(t(limited ? 'mapPage.routesRateLimited' : 'mapPage.routesFailed'))
    },
    [toast, t],
  )
  const routes = useDayRoutes(trip.id, data, mode, onRoutesError)
  const hasEstimate = mode !== 'trip' && routes.some((route) => route.source === 'estimate')

  const counts: Record<MapLayerKey, number> = {
    itinerary: data?.stops.length ?? 0,
    pocket: data?.pocket.length ?? 0,
    lodging: data?.lodging.length ?? 0,
    picks: data?.picks.length ?? 0,
    fuel: data?.fuel.length ?? 0,
  }

  const chooseDay = (index: number) => {
    setChosenDay(index)
    setView('day')
    setSelectedId(null)
    setPickerOpen(false)
  }

  const onAction = (id: string, action: MapAction) => {
    if (!data) return
    const stopId = id.startsWith(FUEL_ID_PREFIX) ? id.slice(FUEL_ID_PREFIX.length) : id
    const stop = data.stops.find((item) => item.id === stopId)
    const place = stop ?? data.pocket.find((item) => item.id === id)
    if (!place) return
    if (action === 'openGoogleMaps') {
      window.open(googleMapsUrl(place), '_blank', 'noopener')
      return
    }
    const query = new URLSearchParams(stop ? { stop: stop.id } : { place: place.id })
    navigate(`${tripPath(trip.id, 'itinerary')}?${query}`)
  }

  const onLongPress = (point: MapPoint) => {
    if (me.role === 'viewer') {
      toast.show(t('mapPage.dropPin.viewerOnly'))
      return
    }
    setSelectedId(null)
    setDrop(point)
  }

  const onReady = useCallback<NonNullable<TripMapProps['onReady']>>((map) => {
    if (import.meta.env.DEV) window.__tripfolioMap = map
  }, [])

  if (status === 'loading') {
    return (
      <Area $fullscreen={false} aria-busy="true">
        <Skeleton $height={2000} $radius="card" />
      </Area>
    )
  }
  if (status === 'error' || !data) {
    const { key, code } = errorMessageKey(error)
    return (
      <EmptyState
        illustration="pin"
        title={t('error.title')}
        body={t(key, { code })}
        action={
          <Button variant="primary" onClick={reload}>
            {t('error.retry')}
          </Button>
        }
      />
    )
  }
  if (data.stops.length === 0 && data.pocket.length === 0 && !forceMap) {
    return (
      <EmptyState
        illustration="pin"
        title={t('mapPage.empty.title')}
        body={t('mapPage.empty.body')}
        action={
          <EmptyActions>
            <ButtonLink to={tripPath(trip.id, 'itinerary')} variant="primary">
              {t('mapPage.empty.goItinerary')}
            </ButtonLink>
            <Button onClick={() => setForceMap(true)}>{t('mapPage.empty.openMap')}</Button>
          </EmptyActions>
        }
      />
    )
  }

  const dayLabel = t('day.short', { n: day + 1 })
  return (
    <Area $fullscreen={fullscreen}>
      <HiddenHeading>{t('nav.map')}</HiddenHeading>
      <Suspense fallback={<Skeleton $height={2000} $radius="card" />}>
        <LazyTripMap
          stops={data.stops}
          routes={routes}
          overnightLinks={data.overnightLinks}
          pocket={data.pocket}
          lodging={data.lodging}
          picks={data.picks}
          fuel={data.fuel}
          mode={mode}
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAction={onAction}
          onLongPress={onLongPress}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          onReady={onReady}
        />
      </Suspense>

      <TopLeft>
        {days.length > 0 && (
          <SegmentedControl
            size="sm"
            label={t('map.viewMode')}
            value={mode === 'trip' ? 'trip' : 'day'}
            onChange={(next: View) => {
              setView(next)
              setSelectedId(null)
            }}
            options={[
              { value: 'trip', label: t('map.trip') },
              { value: 'day', label: dayLabel },
            ]}
          />
        )}
        {days.length > 1 &&
          (wide ? (
            <DaySelect
              aria-label={t('mapPage.dayPicker')}
              value={mode === 'trip' ? '' : String(day)}
              onChange={(event) => {
                if (event.target.value !== '') chooseDay(Number(event.target.value))
              }}
            >
              <option value="" disabled>
                {t('mapPage.dayPicker')}
              </option>
              {days.map((item) => (
                <option key={item.id} value={item.dayIndex}>
                  {dayOptionLabel(item, t)}
                </option>
              ))}
            </DaySelect>
          ) : (
            <IconButton
              size="sm"
              variant="secondary"
              label={t('mapPage.dayPicker')}
              icon={<ChevronDownIcon size={16} />}
              onClick={() => setPickerOpen(true)}
            />
          ))}
        {hasEstimate && (
          <Chip tone="warning">{`${t('map.estimate')} · ${t('map.estimateHint')}`}</Chip>
        )}
      </TopLeft>

      <LayerPanel
        layers={layers}
        counts={counts}
        open={layersOpen}
        onOpenChange={setLayersOpen}
        onChange={(update) => {
          setLayers(update)
          // The card of a pin whose layer was just hidden would float over nothing
          setSelectedId(null)
        }}
        onOfflineMap={() => {
          setLayersOpen(false)
          setOfflineMap({ loaded: true, open: true })
        }}
      />
      {offlineMap.loaded && (
        <Suspense fallback={null}>
          <OfflineMapSheet
            open={offlineMap.open}
            onClose={() => setOfflineMap({ loaded: true, open: false })}
            tripId={trip.id}
            points={offlinePoints}
          />
        </Suspense>
      )}

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('mapPage.dayPicker')}>
        <DayStrip>
          {days.map((item) => (
            <DayChip
              key={item.id}
              index={item.dayIndex}
              date={item.date ? formatDate(item.date, t.locale) : undefined}
              title={item.title || undefined}
              selected={mode !== 'trip' && day === item.dayIndex}
              onClick={() => chooseDay(item.dayIndex)}
            />
          ))}
        </DayStrip>
      </Sheet>

      <DropPinSheet
        // A new point starts a fresh form
        key={drop ? `${drop.lat},${drop.lng}` : 'none'}
        point={drop}
        onClose={() => setDrop(null)}
        onCreate={async (name, point) => {
          const { place } = await mapApi.createPlace(trip.id, {
            nameLocal: name,
            lat: point.lat,
            lng: point.lng,
            source: 'manual',
            category: 'other',
          })
          addPlace(place)
          setLayers((current) => ({ ...current, pocket: true }))
          setDrop(null)
          setSelectedId(place.id)
          toast.show(t('mapPage.dropPin.done', { name: place.nameLocal }), { tone: 'success' })
        }}
      />
    </Area>
  )
}

function dayOptionLabel(day: MapDay, t: ReturnType<typeof useT>): string {
  const parts = [t('day.short', { n: day.dayIndex + 1 })]
  if (day.date) parts.push(formatDate(day.date, t.locale))
  if (day.title) parts.push(day.title)
  return parts.join(' · ')
}

function LayerPanel({
  layers,
  counts,
  open,
  onOpenChange,
  onChange,
  onOfflineMap,
}: {
  layers: MapLayers
  counts: Record<MapLayerKey, number>
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (update: (current: MapLayers) => MapLayers) => void
  onOfflineMap: () => void
}) {
  const t = useT()
  const panelId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, onOpenChange])

  return (
    <TopRight
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          onOpenChange(false)
        }
      }}
    >
      <LayerButton
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        <LayersIcon />
        {t('map.layers')}
      </LayerButton>
      {open && (
        <Panel id={panelId} role="group" aria-label={t('map.layers')}>
          {MAP_LAYER_KEYS.map((key) => {
            const empty = key !== 'itinerary' && counts[key] === 0
            const hintKey = HINT_KEYS[key]
            const hintId = `${panelId}-${key}`
            return (
              <Toggle key={key} $disabled={empty}>
                <input
                  type="checkbox"
                  checked={layers[key] && !empty}
                  disabled={empty}
                  aria-describedby={empty && hintKey ? hintId : undefined}
                  onChange={() => onChange((current) => ({ ...current, [key]: !current[key] }))}
                />
                <ToggleText>
                  <span>{t(LAYER_LABEL_KEYS[key])}</span>
                  {empty && hintKey && <ToggleHint id={hintId}>{t(hintKey)}</ToggleHint>}
                </ToggleText>
                {!empty && <Count>{counts[key]}</Count>}
              </Toggle>
            )
          })}
          <Button size="sm" onClick={onOfflineMap}>
            {t('offline.map.open')}
          </Button>
        </Panel>
      )}
    </TopRight>
  )
}

function DropPinSheet({
  point,
  onClose,
  onCreate,
}: {
  point: MapPoint | null
  onClose: () => void
  onCreate: (name: string, point: MapPoint) => Promise<void>
}) {
  const t = useT()
  const formId = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!point || busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('mapPage.dropPin.nameRequired'))
      return
    }
    setBusy(true)
    try {
      await onCreate(trimmed, point)
    } catch (caught) {
      const { key, code } = errorMessageKey(caught)
      setError(t(key, { code }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={point !== null}
      onClose={onClose}
      title={t('mapPage.dropPin.title')}
      actions={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {t('mapPage.dropPin.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Input
          label={t('mapPage.dropPin.name')}
          value={name}
          maxLength={200}
          autoComplete="off"
          error={error ?? undefined}
          hint={
            point
              ? t('mapPage.dropPin.coords', {
                  coords: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
                })
              : undefined
          }
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Sheet>
  )
}

const LayersIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
)

const Area = styled.section<{ $fullscreen: boolean }>`
  /* Phone: between the top bar and the bottom navigation, edge to edge */
  position: fixed;
  top: ${TOP_BAR}px;
  left: 0;
  right: 0;
  bottom: calc(${BOTTOM_NAV}px + env(safe-area-inset-bottom, 0px));
  & > [role='region'] {
    border-radius: 0;
  }
  @media ${media.tablet} {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    bottom: auto;
    height: calc(100dvh - ${TOP_BAR + space.xl * 2}px);
    min-height: 420px;
    & > [role='region'] {
      border-radius: ${radius.card}px;
    }
  }
  ${({ $fullscreen }) =>
    $fullscreen &&
    css`
      && {
        position: fixed;
        inset: 0;
        height: auto;
        z-index: ${zIndex.overlay};
      }
    `}
`

const HiddenHeading = styled.h1`
  ${visuallyHidden}
`

const floating = css`
  position: absolute;
  top: 10px;
  z-index: 2;
`

const TopLeft = styled.div`
  ${floating}
  left: 10px;
  right: 120px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  pointer-events: none;
  & > * {
    pointer-events: auto;
    box-shadow: 0 2px 8px ${color.shadow};
  }
`

/* Left of MapLibre's zoom buttons (top right, 29 px wide plus a 10 px margin) */
const TopRight = styled.div`
  ${floating}
  right: 50px;
  display: grid;
  justify-items: end;
  gap: ${space.xs}px;
`

const LayerButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 34px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${color.ink};
  font: inherit;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  box-shadow: 0 2px 8px ${color.shadow};
  cursor: pointer;
  &[aria-expanded='true'] {
    background: ${color.ink};
    color: ${color.paper};
  }
  @media ${media.coarse} {
    min-height: 44px;
  }
  ${focusRing}
`

const Panel = styled.div`
  display: grid;
  gap: 2px;
  width: min(260px, calc(100vw - 80px));
  padding: ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  box-shadow: 0 6px 20px ${color.shadow};
`

const Toggle = styled.label<{ $disabled: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: ${space.sm}px;
  padding: ${space.sm}px;
  border-radius: ${radius.control}px;
  color: ${({ $disabled }) => ($disabled ? color.muted : color.ink)};
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  font-size: ${fontSize.body}px;
  input {
    margin: 3px 0 0;
    width: 16px;
    height: 16px;
    accent-color: ${color.fjord};
  }
  &:hover {
    background: ${({ $disabled }) => ($disabled ? 'transparent' : color.glacier)};
  }
`

const ToggleText = styled.span`
  display: grid;
  gap: 2px;
  flex: 1;
`

const ToggleHint = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

const Count = styled.span`
  font-size: ${fontSize.sm}px;
  font-variant-numeric: tabular-nums;
  color: ${color.muted};
`

const DaySelect = styled.select`
  min-height: 34px;
  max-width: 220px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${color.ink};
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  ${focusRing}
`

const DayStrip = styled.div`
  display: flex;
  gap: ${space.sm}px;
  overflow-x: auto;
  padding-bottom: ${space.sm}px;
`

const EmptyActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: ${space.sm}px;
`
