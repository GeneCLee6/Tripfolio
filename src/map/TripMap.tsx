import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLat,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import styled, { css } from 'styled-components'
import { Button, Card, CardTitle, Chip, IconButton } from '../components/index.ts'
import { CloseIcon } from '../components/icons.tsx'
import { useT } from '../lib/i18n.ts'
import { focusRing, visuallyHidden } from '../styles/mixins.ts'
import { color, dayColor, font, fontSize, fontWeight, palette, radius, space, zIndex } from '../styles/tokens.ts'
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  MAP_LABEL_FONT,
} from './config.ts'
import {
  fitTarget,
  lineFeatures,
  pinFeatures,
  type FitTarget,
  type PinProperties,
  type PointFeature,
} from './geojson.ts'
import { LAYER_LABEL_KEYS, typeLabelKey } from './labels.ts'
import { PIN_PIXEL_RATIO, pinDataUrl } from './sprite.ts'
import { applyRestyle, loadBaseStyle, restyle, type PaintProperty, type StyleSpecification } from './style.ts'
import type {
  MapAction,
  MapLayerKey,
  MapLayers,
  MapMode,
  MapPlace,
  MapPoint,
  MapRoute,
  MapScheme,
  MapStop,
  OvernightLink,
} from './types.ts'
import { useMapScheme, useReducedMotion } from './useMapScheme.ts'

// The trip map (e3-t03, AC-3.2): MapLibre on the restyled OpenFreeMap basemap, day-coloured
// numbered pins, glyph pins for the other layers, clustering, day routes (estimates dotted) or
// night-to-night links in the whole-trip view, and a React card in a MapLibre popup. maplibre-gl is
// imported only here, so the library lands in the lazy `maplibre` chunk: load this with lazy().

// The worker file is not next to our bundled chunk, so tell MapLibre where Vite put it
setWorkerUrl(workerUrl)

export interface TripMapProps {
  stops: readonly MapStop[]
  routes?: readonly MapRoute[]
  /** Whole-trip view: night-to-night lines */
  overnightLinks?: readonly OvernightLink[]
  pocket?: readonly MapPlace[]
  lodging?: readonly MapPlace[]
  picks?: readonly MapPlace[]
  fuel?: readonly MapPlace[]
  mode: MapMode
  layers: MapLayers
  /** Controlled selection; leave undefined to let the map keep its own */
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Manual pin: 500 ms touch hold, or right-click on desktop */
  onLongPress?: (point: MapPoint) => void
  /** The card's buttons */
  onAction?: (id: string, action: MapAction) => void
  /** What to frame; default `day` in a day, `all` in the whole trip */
  fitTo?: 'all' | 'day'
  /** Controlled full screen (CSS, inside the page); leave undefined to let the map keep its own */
  fullscreen?: boolean
  onFullscreenChange?: (fullscreen: boolean) => void
  /** Force a scheme; by default the map follows the theme */
  scheme?: MapScheme
  /** CSS height of the map when not full screen (default 100%) */
  height?: string
  /** The MapLibre instance once loaded (E8 uses it for exportStaticPng) */
  onReady?: (map: MapLibreMap) => void
}

type Selected = { kind: 'itinerary'; item: MapStop } | { kind: Exclude<MapLayerKey, 'itinerary'>; item: MapPlace }

const SOURCE_PINS = 'tf-pins'
const SOURCE_LINES = 'tf-lines'
const SOURCE_ME = 'tf-me'
const LAYER_PINS = 'tf-pins'
const LAYER_CLUSTERS = 'tf-clusters'
const LAYER_SELECTED = 'tf-selected'

const EMPTY = { type: 'FeatureCollection' as const, features: [] }
const NOT_CLUSTER: ExpressionSpecification = ['!', ['has', 'point_count']]

const selectedFilter = (id: string | null): ExpressionSpecification => [
  'all',
  NOT_CLUSTER,
  ['==', ['get', 'id'], id ?? ''],
]

/** Paint of our own layers that depends on the scheme */
function overlayPaint(scheme: MapScheme): [layer: string, property: PaintProperty, value: string][] {
  const p = palette[scheme]
  return [
    ['tf-line-casing', 'line-color', p.card],
    [LAYER_CLUSTERS, 'circle-color', scheme === 'light' ? p.fjordInk : p.fjord],
    [LAYER_CLUSTERS, 'circle-stroke-color', p.card],
    ['tf-cluster-count', 'text-color', p.card],
    [LAYER_SELECTED, 'circle-stroke-color', p.ink],
    ['tf-me', 'circle-color', p.fjord],
    ['tf-me', 'circle-stroke-color', p.card],
  ]
}

function addOverlay(map: MapLibreMap, scheme: MapScheme): void {
  map.addSource(SOURCE_LINES, { type: 'geojson', data: EMPTY })
  map.addSource(SOURCE_PINS, {
    type: 'geojson',
    data: EMPTY,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  })
  map.addSource(SOURCE_ME, { type: 'geojson', data: EMPTY })
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const
  map.addLayer({
    id: 'tf-line-casing',
    type: 'line',
    source: SOURCE_LINES,
    filter: ['==', ['get', 'kind'], 'route'],
    layout: round,
    paint: { 'line-width': 8, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'tf-line-route',
    type: 'line',
    source: SOURCE_LINES,
    filter: ['==', ['get', 'kind'], 'route'],
    layout: round,
    paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
  })
  map.addLayer({
    id: 'tf-line-estimate',
    type: 'line',
    source: SOURCE_LINES,
    filter: ['==', ['get', 'kind'], 'estimate'],
    layout: round,
    paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.55, 'line-dasharray': [0, 2] },
  })
  map.addLayer({
    id: 'tf-line-overnight',
    type: 'line',
    source: SOURCE_LINES,
    filter: ['==', ['get', 'kind'], 'overnight'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2.5, 1.5] },
  })
  map.addLayer({
    id: LAYER_CLUSTERS,
    type: 'circle',
    source: SOURCE_PINS,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 16, 5, 19, 15, 23],
      'circle-stroke-width': 3,
    },
  })
  map.addLayer({
    id: 'tf-cluster-count',
    type: 'symbol',
    source: SOURCE_PINS,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': MAP_LABEL_FONT,
      'text-size': 13,
      'text-allow-overlap': true,
    },
  })
  map.addLayer({
    id: LAYER_SELECTED,
    type: 'circle',
    source: SOURCE_PINS,
    filter: selectedFilter(null),
    paint: { 'circle-radius': 21, 'circle-opacity': 0, 'circle-stroke-width': 3 },
  })
  map.addLayer({
    id: LAYER_PINS,
    type: 'symbol',
    source: SOURCE_PINS,
    filter: NOT_CLUSTER,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'sortKey'],
    },
  })
  map.addLayer({
    id: 'tf-me',
    type: 'circle',
    source: SOURCE_ME,
    paint: { 'circle-radius': 7, 'circle-stroke-width': 3 },
  })
  for (const [layer, property, value] of overlayPaint(scheme)) map.setPaintProperty(layer, property, value)
}

const loadImage = (url: string): Promise<HTMLImageElement> => {
  const image = new Image()
  image.src = url
  return image.decode().then(() => image)
}

/** Adds the pin images `ids` names that the map does not have yet */
async function ensureImages(map: MapLibreMap, ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => !map.hasImage(id))
      .map(async (id) => {
        const url = pinDataUrl(id)
        if (!url) return
        const image = await loadImage(url)
        if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: PIN_PIXEL_RATIO })
      }),
  )
}

function moveCamera(map: MapLibreMap, target: FitTarget, animate: boolean): void {
  if (!target) return
  const duration = animate ? 600 : 0
  if ('bounds' in target) {
    const { width, height } = map.getContainer().getBoundingClientRect()
    const padding = Math.max(8, Math.min(FIT_PADDING, width / 5, height / 5))
    map.fitBounds(target.bounds, { padding, maxZoom: FIT_MAX_ZOOM, duration })
  } else {
    map.easeTo({ center: target.center, zoom: target.zoom, duration })
  }
}

const modeKeyOf = (mode: MapMode) => (mode === 'trip' ? 'trip' : `day:${mode.day}`)
const modeFromKey = (key: string): MapMode => (key === 'trip' ? 'trip' : { day: Number(key.slice(4)) })

export default function TripMap({
  stops,
  routes = [],
  overnightLinks = [],
  pocket,
  lodging,
  picks,
  fuel,
  mode,
  layers,
  selectedId: controlledSelected,
  onSelect,
  onLongPress,
  onAction,
  fitTo,
  fullscreen: controlledFullscreen,
  onFullscreenChange,
  scheme: schemeOverride,
  height = '100%',
  onReady,
}: TripMapProps) {
  const t = useT()
  const scheme = useMapScheme(schemeOverride)
  const reducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const baseStyleRef = useRef<StyleSpecification | null>(null)
  const [popupNode] = useState(() => document.createElement('div'))
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const [ownSelected, setOwnSelected] = useState<string | null>(null)
  const [ownFullscreen, setOwnFullscreen] = useState(false)
  const selectedId = controlledSelected !== undefined ? controlledSelected : ownSelected
  const fullscreen = controlledFullscreen ?? ownFullscreen

  const modeKey = modeKeyOf(mode)
  const fit = fitTo ?? (mode === 'trip' ? 'all' : 'day')
  const { itinerary, pocket: showPocket, lodging: showLodging, picks: showPicks, fuel: showFuel } = layers

  const pins = useMemo(
    () =>
      pinFeatures(
        { stops, pocket, lodging, picks, fuel },
        {
          mode: modeFromKey(modeKey),
          layers: { itinerary, pocket: showPocket, lodging: showLodging, picks: showPicks, fuel: showFuel },
          scheme,
        },
      ),
    [stops, pocket, lodging, picks, fuel, modeKey, itinerary, showPocket, showLodging, showPicks, showFuel, scheme],
  )
  const lines = useMemo(() => lineFeatures(routes, overnightLinks, modeFromKey(modeKey)), [routes, overnightLinks, modeKey])

  const select = useCallback(
    (id: string | null) => {
      if (controlledSelected === undefined) setOwnSelected(id)
      onSelect?.(id)
    },
    [controlledSelected, onSelect],
  )

  const setFullscreen = (next: boolean) => {
    if (controlledFullscreen === undefined) setOwnFullscreen(next)
    onFullscreenChange?.(next)
  }

  // Latest values for the map's event handlers, which are bound once
  const latest = useRef({ select, onLongPress, pins, lines, fit, modeKey, reducedMotion })
  useEffect(() => {
    latest.current = { select, onLongPress, pins, lines, fit, modeKey, reducedMotion }
  })
  const schemeRef = useRef(scheme)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  })

  // Create the map once
  useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | null = null
    let pressTimer: ReturnType<typeof setTimeout> | undefined
    let pressStart: { x: number; y: number } | null = null
    let lastLongPress = 0

    const fireLongPress = (lngLat: LngLat) => {
      if (Date.now() - lastLongPress < 800) return
      lastLongPress = Date.now()
      latest.current.onLongPress?.({ lat: lngLat.lat, lng: lngLat.lng })
    }
    const cancelPress = () => {
      clearTimeout(pressTimer)
      pressStart = null
    }

    loadBaseStyle()
      .then((base) => {
        const container = containerRef.current
        if (cancelled || !container) return
        baseStyleRef.current = base
        const { pins: firstPins, lines: firstLines, fit: firstFit, modeKey: firstMode } = latest.current
        const initial = fitTarget(firstPins, firstLines, firstFit, modeFromKey(firstMode))
        const created = new MapLibreMap({
          container,
          style: restyle(base, schemeRef.current),
          ...(initial && 'bounds' in initial
            ? { bounds: initial.bounds, fitBoundsOptions: { padding: 40, maxZoom: FIT_MAX_ZOOM } }
            : initial
              ? { center: initial.center, zoom: initial.zoom }
              : {}),
          // The style's sources carry the OpenFreeMap / OpenMapTiles / OpenStreetMap attribution
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          locale: {
            // The canvas's aria-label (MapLibre's default is the English "Map"); not map.label,
            // which names the surrounding region
            'Map.Title': t('map.canvas'),
            'NavigationControl.ZoomIn': t('map.zoomIn'),
            'NavigationControl.ZoomOut': t('map.zoomOut'),
          },
        })
        map = created
        created.touchZoomRotate.disableRotation()
        created.keyboard.disableRotation()
        created.addControl(new NavigationControl({ showCompass: false }), 'top-right')
        popupRef.current = new Popup({
          closeButton: false,
          closeOnClick: false,
          focusAfterOpen: false,
          offset: 20,
          maxWidth: '320px',
          className: 'tf-popup',
        }).setDOMContent(popupNode)

        created.on('load', () => {
          if (cancelled) return
          addOverlay(created, schemeRef.current)
          mapRef.current = created
          setStatus('ready')
          onReadyRef.current?.(created)
        })

        created.on('click', (event: MapMouseEvent) => {
          const [hit] = created.queryRenderedFeatures(event.point, { layers: [LAYER_PINS, LAYER_CLUSTERS] })
          if (!hit) {
            latest.current.select(null)
            return
          }
          if (hit.layer.id === LAYER_PINS) {
            latest.current.select(String(hit.properties.id))
            return
          }
          const clusterId = Number(hit.properties.cluster_id)
          const source = created.getSource(SOURCE_PINS) as GeoJSONSource | undefined
          const center = (hit.geometry as { coordinates: [number, number] }).coordinates
          void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
            created.easeTo({ center, zoom, duration: latest.current.reducedMotion ? 0 : 500 })
          })
        })
        for (const layer of [LAYER_PINS, LAYER_CLUSTERS]) {
          created.on('mouseenter', layer, () => (created.getCanvas().style.cursor = 'pointer'))
          created.on('mouseleave', layer, () => (created.getCanvas().style.cursor = ''))
        }

        // Manual pin: right-click on desktop; a 500 ms hold that does not move on touch. Some mobile
        // browsers also send contextmenu for a long press: fireLongPress drops the duplicate.
        created.on('contextmenu', (event: MapMouseEvent) => {
          event.preventDefault()
          cancelPress()
          fireLongPress(event.lngLat)
        })
        created.on('touchstart', (event: MapTouchEvent) => {
          cancelPress()
          if (event.points.length !== 1) return
          pressStart = { x: event.point.x, y: event.point.y }
          const { lngLat } = event
          pressTimer = setTimeout(() => {
            pressStart = null
            fireLongPress(lngLat)
          }, LONG_PRESS_MS)
        })
        created.on('touchmove', (event: MapTouchEvent) => {
          if (!pressStart) return
          const moved = Math.hypot(event.point.x - pressStart.x, event.point.y - pressStart.y)
          if (moved > LONG_PRESS_SLOP_PX || event.points.length !== 1) cancelPress()
        })
        created.on('touchend', cancelPress)
        created.on('touchcancel', cancelPress)
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      cancelPress()
      popupRef.current?.remove()
      popupRef.current = null
      map?.remove()
      mapRef.current = null
    }
    // Created once; later changes reach the map through the effects below and `latest`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme switch: recolour the basemap and our layers in place
  useEffect(() => {
    const map = mapRef.current
    const base = baseStyleRef.current
    if (schemeRef.current === scheme) return
    schemeRef.current = scheme
    if (!map || !base || status !== 'ready') return
    applyRestyle(map, base, scheme)
    for (const [layer, property, value] of overlayPaint(scheme)) map.setPaintProperty(layer, property, value)
  }, [scheme, status])

  // Data: pins (after their images exist) and lines
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    let cancelled = false
    ;(map.getSource(SOURCE_LINES) as GeoJSONSource).setData(lines)
    const icons = [...new Set(pins.features.map((feature) => feature.properties.icon))]
    void ensureImages(map, icons).then(() => {
      if (!cancelled) (map.getSource(SOURCE_PINS) as GeoJSONSource).setData(pins)
    })
    return () => {
      cancelled = true
    }
  }, [pins, lines, status])

  // Camera: refit when the view, the framing or the itinerary changes (not on layer toggles)
  const fitKey = `${modeKey}|${fit}|${stops.length}|${routes.length}|${overnightLinks.length}`
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    const { pins: currentPins, lines: currentLines, fit: currentFit, modeKey: currentMode, reducedMotion: still } =
      latest.current
    moveCamera(map, fitTarget(currentPins, currentLines, currentFit, modeFromKey(currentMode)), !still)
  }, [fitKey, status])

  // Selection: the card in the popup and the ring around the pin
  const selected = useMemo<Selected | null>(() => {
    if (!selectedId) return null
    const stop = stops.find((item) => item.id === selectedId)
    if (stop) return { kind: 'itinerary', item: stop }
    for (const [kind, list] of [
      ['pocket', pocket],
      ['lodging', lodging],
      ['picks', picks],
      ['fuel', fuel],
    ] as const) {
      const place = list?.find((item) => item.id === selectedId)
      if (place) return { kind, item: place }
    }
    return null
  }, [selectedId, stops, pocket, lodging, picks, fuel])

  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || status !== 'ready') return
    map.setFilter(LAYER_SELECTED, selectedFilter(selected ? selected.item.id : null))
    if (selected) popup.setLngLat([selected.item.lng, selected.item.lat]).addTo(map)
    else popup.remove()
  }, [selected, status])

  // Full screen changes the container size
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const frame = requestAnimationFrame(() => map.resize())
    return () => cancelAnimationFrame(frame)
  }, [fullscreen])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setNotice(t('map.locateFailed'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = mapRef.current
        if (!map) return
        const center: [number, number] = [position.coords.longitude, position.coords.latitude]
        ;(map.getSource(SOURCE_ME) as GeoJSONSource | undefined)?.setData({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: center },
          properties: {},
        })
        map.easeTo({ center, zoom: Math.max(map.getZoom(), 13), duration: reducedMotion ? 0 : 600 })
      },
      () => setNotice(t('map.locateFailed')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const focusPin = (feature: PointFeature<PinProperties>) => {
    select(feature.properties.id)
    const map = mapRef.current
    if (!map) return
    const [lng, lat] = feature.geometry.coordinates
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1), duration: reducedMotion ? 0 : 500 })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    if (selectedId) {
      event.stopPropagation()
      select(null)
    } else if (fullscreen) {
      event.stopPropagation()
      setFullscreen(false)
    }
  }

  const pinLabel = (properties: PinProperties) =>
    properties.kind === 'itinerary'
      ? t('map.pinLabel', { day: t('day.short', { n: properties.dayIndex + 1 }), n: properties.order, name: properties.name })
      : t('map.placeLabel', { layer: t(LAYER_LABEL_KEYS[properties.kind]), name: properties.name })

  return (
    <Frame
      role="region"
      aria-label={t('map.label')}
      $fullscreen={fullscreen}
      $height={height}
      $dark={scheme === 'dark'}
      onKeyDown={onKeyDown}
    >
      <Canvas ref={containerRef} />
      {status !== 'ready' && (
        <Overlay aria-live="polite">{status === 'error' ? t('map.error') : t('map.loading')}</Overlay>
      )}
      <PinList aria-label={t('map.pinList')}>
        {pins.features.map((feature) => (
          <li key={`${feature.properties.kind}:${feature.properties.id}`}>
            <PinButton
              type="button"
              aria-pressed={feature.properties.id === selectedId}
              onClick={() => focusPin(feature)}
            >
              {pinLabel(feature.properties)}
            </PinButton>
          </li>
        ))}
      </PinList>
      <Controls>
        <IconButton
          variant="secondary"
          size="sm"
          label={t('map.locate')}
          icon={<LocateIcon />}
          onClick={locate}
        />
        <IconButton
          variant="secondary"
          size="sm"
          label={t(fullscreen ? 'map.fullscreenExit' : 'map.fullscreenEnter')}
          aria-pressed={fullscreen}
          icon={fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
          onClick={() => setFullscreen(!fullscreen)}
        />
      </Controls>
      <Notice role="status">{notice}</Notice>
      {selected &&
        createPortal(
          <PinCard selected={selected} onClose={() => select(null)} onAction={onAction} />,
          popupNode,
        )}
    </Frame>
  )
}

function PinCard({
  selected,
  onClose,
  onAction,
}: {
  selected: Selected
  onClose: () => void
  onAction?: (id: string, action: MapAction) => void
}) {
  const t = useT()
  const { item } = selected
  const stop = selected.kind === 'itinerary' ? selected.item : null
  const accent = stop ? dayColor(stop.dayIndex) : undefined
  const eyebrow = stop
    ? `${t('day.short', { n: stop.dayIndex + 1 })} · ${t('map.stopOrder', { n: stop.order })}`
    : t(LAYER_LABEL_KEYS[selected.kind])
  const meta = [`${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}`, stop?.time].filter(Boolean).join(' · ')
  return (
    <Card $padding="md" $accent={accent}>
      <CardHead>
        <Eyebrow style={accent ? { color: accent } : undefined}>{eyebrow}</Eyebrow>
        <IconButton size="sm" label={t('common.close')} icon={<CloseIcon size={16} />} onClick={onClose} />
      </CardHead>
      <CardTitle>{item.name}</CardTitle>
      <Meta>
        <Chip>{t(typeLabelKey(item.type))}</Chip>
        <Mono>{meta}</Mono>
      </Meta>
      <Actions>
        <Button size="sm" variant="primary" onClick={() => onAction?.(item.id, 'schedule')}>
          {t('map.action.schedule')}
        </Button>
        <Button size="sm" onClick={() => onAction?.(item.id, 'openGoogleMaps')}>
          {t('map.action.openGoogleMaps')}
        </Button>
      </Actions>
    </Card>
  )
}

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

const LocateIcon = () => (
  <svg {...svgProps}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)

const MaximizeIcon = () => (
  <svg {...svgProps}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
)

const MinimizeIcon = () => (
  <svg {...svgProps}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
)

const Frame = styled.div<{ $fullscreen: boolean; $height: string; $dark: boolean }>`
  position: relative;
  width: 100%;
  height: ${({ $height }) => $height};
  min-height: 280px;
  overflow: hidden;
  border-radius: ${radius.card}px;
  background: ${color.glacier};
  color: ${color.ink};
  ${({ $fullscreen }) =>
    $fullscreen &&
    css`
      position: fixed;
      inset: 0;
      z-index: ${zIndex.overlay};
      height: 100dvh;
      border-radius: 0;
    `}

  .maplibregl-ctrl-group {
    background: ${color.card};
    border: 1px solid ${color.line};
    box-shadow: none;
  }
  .maplibregl-ctrl-group button + button {
    border-top-color: ${color.line};
  }
  .maplibregl-ctrl-icon {
    filter: ${({ $dark }) => ($dark ? 'invert(1)' : 'none')};
  }
  /* Doubled class: MapLibre's compact attribution sets its own background with two classes */
  && .maplibregl-ctrl-attrib,
  && .maplibregl-ctrl-attrib.maplibregl-compact-show {
    background: color-mix(in srgb, ${color.card} 85%, transparent);
    color: ${color.muted};
    font-size: 11px;
    a {
      color: ${color.muted};
    }
  }
  .maplibregl-ctrl-attrib-button {
    filter: ${({ $dark }) => ($dark ? 'invert(1)' : 'none')};
  }
  .tf-popup .maplibregl-popup-content {
    padding: 0;
    background: transparent;
    border-radius: ${radius.card}px;
    box-shadow: 0 6px 20px ${color.shadow};
  }
  .tf-popup .maplibregl-popup-tip {
    display: none;
  }
`

/** MapLibre's own CSS sets .maplibregl-map to position: relative, hence the doubled class */
const Canvas = styled.div`
  && {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
`

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: ${space.lg}px;
  text-align: center;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Controls = styled.div`
  position: absolute;
  right: 10px;
  bottom: 40px;
  display: grid;
  gap: ${space.sm}px;
  button {
    background: ${color.card};
  }
`

const Notice = styled.p`
  position: absolute;
  left: 50%;
  bottom: ${space.lg}px;
  transform: translateX(-50%);
  margin: 0;
  &:empty {
    display: none;
  }
  padding: ${space.xs}px ${space.md}px;
  border-radius: ${radius.pill}px;
  background: ${color.ink};
  color: ${color.paper};
  font-size: ${fontSize.sm}px;
`

/** Mirrors the pins for keyboard and screen-reader users; shown while it has focus */
const PinList = styled.ul`
  ${visuallyHidden}
  list-style: none;
  &:focus-within {
    position: absolute;
    top: ${space.sm}px;
    left: ${space.sm}px;
    width: auto;
    height: auto;
    max-width: min(320px, calc(100% - 80px));
    max-height: calc(100% - 80px);
    margin: 0;
    padding: ${space.xs}px;
    overflow: auto;
    clip: auto;
    white-space: normal;
    background: ${color.card};
    border: 1px solid ${color.line};
    border-radius: ${radius.control}px;
    z-index: 2;
  }
`

const PinButton = styled.button`
  display: block;
  width: 100%;
  padding: ${space.xs}px ${space.sm}px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${color.ink};
  font: inherit;
  font-size: ${fontSize.sm}px;
  text-align: left;
  cursor: pointer;
  &[aria-pressed='true'] {
    background: ${color.glacier};
  }
  ${focusRing}
`

const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  margin: -${space.xs}px -${space.xs}px 0 0;
`

const Eyebrow = styled.span`
  font-family: ${font.mono};
  font-size: 12px;
  font-weight: ${fontWeight.medium};
  letter-spacing: 0.04em;
  color: ${color.muted};
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  margin-bottom: ${space.md}px;
`

const Mono = styled.span`
  font-family: ${font.mono};
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`
