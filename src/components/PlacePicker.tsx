import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { GeoPoint, GeoResult } from '../../shared/api/geo.ts'
import type { Place } from '../../shared/api/types.ts'
import { formatDistance } from '../../shared/i18n/format.ts'
import { haversineM } from '../../shared/itinerary/legs.ts'
import type { StopType } from '../../shared/schema/index.ts'
import { itineraryApi } from '../lib/api.ts'
import { geoErrorMessage, SEARCH_DEBOUNCE_MS } from '../lib/itinerary/geo-errors.ts'
import { useT } from '../lib/i18n.ts'
import {
  findExistingPlace,
  looksLikeLocation,
  placeFromResult,
  placeName,
  stopTypeForCategory,
} from '../lib/itinerary/places.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { Input } from './Field.tsx'
import { MapPinIcon } from './icons.tsx'
import { StopTypeIcon } from './StopTypeIcon.tsx'

// Find a place for a stop (e3-t02, DESIGN.md §3 PlacePicker): a debounced search through the
// Worker's proxy, biased to the trip centre or the previous stop; pasted coordinates or Google Maps
// links go to /geo/parse instead; 「手動放針」 hands over to the map (its long-press arrives in B2).
// A chosen result becomes a places row, or reuses the row the trip already has for it.

/** What the picker hands back */
export type PlacePick =
  | { manual?: false; placeId: string; place: Place; suggestedType: StopType }
  | { manual: true }

export interface PlacePickerProps {
  tripId: string
  /** The trip's places, fetched once by the page (used to reuse rows) */
  places: readonly Place[]
  /** Where to bias the search and measure distance from */
  bias: GeoPoint | null
  onPick: (pick: PlacePick) => void
  /** A row was just created (the page adds it to its list) */
  onPlaceCreated?: (place: Place) => void
  /** Visible label (default 「搜尋地點」) */
  label?: string
  disabled?: boolean
}

const MIN_QUERY = 2

type Status =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  | { kind: 'results'; q: string; results: GeoResult[] }
  | { kind: 'error'; q: string; message: string }

const Wrapper = styled.div`
  display: grid;
  gap: ${space.sm}px;
`

const Results = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  overflow: hidden;
  > li + li {
    border-top: 1px solid ${color.line};
  }
`

const Result = styled.button`
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 2px ${space.sm}px;
  align-items: baseline;
  width: 100%;
  min-height: ${touchTarget}px;
  padding: ${space.sm}px ${space.md}px;
  border: 0;
  background: transparent;
  color: ${color.ink};
  text-align: left;
  font: inherit;
  cursor: pointer;
  &:hover {
    background: ${color.paper};
  }
  > svg {
    color: ${color.muted};
    align-self: center;
  }
  ${focusRing}
`

const ResultName = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const ResultMeta = styled.span`
  grid-column: 2 / 4;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const Distance = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Note = styled.p<{ $tone?: 'error' }>`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $tone }) => ($tone === 'error' ? color.danger : color.muted)};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  @media ${media.coarse} {
    gap: ${space.md}px;
  }
`

export function PlacePicker({
  tripId,
  places,
  bias,
  onPick,
  onPlaceCreated,
  label,
  disabled,
}: PlacePickerProps) {
  const t = useT()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const query = text.trim()
  const isLocation = looksLikeLocation(query)
  const searchable = !isLocation && query.length >= MIN_QUERY
  const biasKey = bias ? `${bias.lat},${bias.lng}` : ''

  useEffect(() => {
    if (!searchable) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setStatus({ kind: 'searching', q: query })
      itineraryApi
        .geoSearch(tripId, { q: query, lang: t.locale.toLowerCase(), bias }, controller.signal)
        .then(
          (response) => setStatus({ kind: 'results', q: query, results: response.results }),
          (error: unknown) => {
            if (controller.signal.aborted) return
            setStatus({ kind: 'error', q: query, message: geoErrorMessage(error, t) })
          },
        )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // bias is compared by value through biasKey
  }, [query, searchable, tripId, biasKey, t]) // oxlint-disable-line react-hooks/exhaustive-deps

  // Only what belongs to the current text is shown
  const shown = searchable && 'q' in status && status.q === query ? status : null

  const finish = (place: Place, created: boolean) => {
    if (created) onPlaceCreated?.(place)
    onPick({ placeId: place.id, place, suggestedType: stopTypeForCategory(place.category) })
    setText('')
    setStatus({ kind: 'idle' })
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await work()
    } catch (error) {
      setActionError(geoErrorMessage(error, t))
    } finally {
      setBusy(false)
    }
  }

  const choose = (result: GeoResult) =>
    run(async () => {
      const existing = findExistingPlace(places, result)
      if (existing) return finish(existing, false)
      const { place } = await itineraryApi.createPlace(tripId, placeFromResult(result))
      finish(place, true)
    })

  const useCoordinates = () =>
    run(async () => {
      const parsed = await itineraryApi.geoParse(tripId, query)
      const nameLocal = parsed.name?.trim() || `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`
      const { place } = await itineraryApi.createPlace(tripId, {
        nameLocal,
        lat: parsed.lat,
        lng: parsed.lng,
        source: parsed.source,
        category: 'other',
        links: /^https?:\/\//i.test(query) ? [{ url: query }] : [],
      })
      finish(place, true)
    })

  return (
    <Wrapper>
      <Input
        label={label ?? t('place.search.label')}
        type="search"
        autoComplete="off"
        placeholder={t('place.search.placeholder')}
        value={text}
        disabled={disabled || busy}
        onChange={(event) => {
          setText(event.target.value)
          setActionError(null)
        }}
      />
      {isLocation && (
        <Row>
          <Note>{t('place.parse.detected')}</Note>
          <Button size="sm" variant="primary" disabled={busy} onClick={useCoordinates}>
            {t('place.parse.use')}
          </Button>
        </Row>
      )}
      {shown?.kind === 'searching' && <Note aria-live="polite">{t('place.search.searching')}</Note>}
      {shown?.kind === 'error' && (
        <Note role="alert" $tone="error">
          {shown.message}
        </Note>
      )}
      {shown?.kind === 'results' && shown.results.length === 0 && (
        <Note aria-live="polite">{t('place.search.empty', { q: shown.q })}</Note>
      )}
      {shown?.kind === 'results' && shown.results.length > 0 && (
        <Results aria-label={t('place.search.results')}>
          {shown.results.map((result) => (
            <li key={`${result.externalId}:${result.lat},${result.lng}`}>
              <Result type="button" disabled={busy} onClick={() => choose(result)}>
                <StopTypeIcon type={stopTypeForCategory(result.category)} />
                <ResultName>{placeName(result, t.locale)}</ResultName>
                {bias ? (
                  <Distance>{formatDistance(haversineM(bias, result), t.locale)}</Distance>
                ) : (
                  <span />
                )}
                {result.address && <ResultMeta>{result.address}</ResultMeta>}
              </Result>
            </li>
          ))}
        </Results>
      )}
      {busy && <Note aria-live="polite">{t('place.creating')}</Note>}
      {actionError && (
        <Note role="alert" $tone="error">
          {actionError}
        </Note>
      )}
      <Row>
        <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onPick({ manual: true })}>
          <MapPinIcon size={16} />
          {t('place.manual')}
        </Button>
      </Row>
    </Wrapper>
  )
}
