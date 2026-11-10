import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops, Place } from '../../../shared/api/types.ts'
import {
  Button,
  Chip,
  Dialog,
  EmptyState,
  Lightbox,
  PhotoGrid,
  PhotoThumb,
  Skeleton,
  StorageMeter,
  Tabs,
  useToast,
} from '../../components/index.ts'
import { PhotoUploader } from '../../components/PhotoUploader.tsx'
import { useTripContext } from '../../app/trip-context.ts'
import { api, itineraryApi } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { groupByDay, type DayAlbum } from '../../lib/photos/albums.ts'
import { readDayCovers, writeDayCovers } from '../../lib/photos/day-covers.ts'
import { tripPhotos, useTripPhotos } from '../../lib/photos/store.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { mediaApi } from '../../lib/upload/api.ts'
import { buildMatchContext, isUnfiled, planMatches } from '../../lib/upload/match.ts'
import { photoCache } from '../../lib/upload/photo-cache.ts'
import { color, fontSize, media, radius, space } from '../../styles/tokens.ts'
import { colorOfDay } from '../itinerary/labels.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { PhotoInfo } from './PhotoInfo.tsx'
import { dayHeading, dayLabel, filedText } from './photos.ts'

// /trips/:id/photos (e6-t02…t05): the uploader for editors, the storage meter, every photo in
// capture order (all) or per day (by day, with the photos no day claims last), and the lightbox.
// New uploads are filed automatically (GPS within 500 m of a stop that day, else the day by time;
// src/lib/upload/match.ts); "Auto-sort" does the same for older unfiled photos.

const Head = styled.div`
  display: grid;
  gap: ${space.lg}px;
  @media ${media.tablet} {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
    align-items: end;
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px ${space.md}px;
`

const Hint = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  max-width: 60ch;
`

const Album = styled.section<{ $color: string }>`
  display: grid;
  gap: ${space.md}px;
  min-width: 0;
  padding-left: ${space.md}px;
  border-left: 4px solid ${({ $color }) => $color};
`

const AlbumHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
`

const Cover = styled.div`
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: ${radius.control}px;
  overflow: hidden;
  background: ${color.line};
`

const SkeletonGrid = styled.ul`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
  @media ${media.desktop} {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
`

const UNASSIGNED = 'unassigned'

type View = 'all' | 'days'

interface Viewer {
  /** The sequence the lightbox steps through (fixed when it opens; moved photos stay in it) */
  ids: string[]
  index: number
}

const skeletonGrid = (
  <SkeletonGrid>
    {Array.from({ length: 6 }, (_, i) => (
      <li key={i}>
        <Skeleton $height={0} style={{ aspectRatio: '1', height: 'auto' }} />
      </li>
    ))}
  </SkeletonGrid>
)

export default function PhotosPage() {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, setTrip, reload: reloadTrip } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const photos = useTripPhotos(trip.id)
  const itinerary = useResource(`photos-itinerary:${trip.id}`, (signal) =>
    Promise.all([
      itineraryApi.listDays(trip.id, signal),
      itineraryApi.listPlaces(trip.id, signal),
    ]).then(([d, p]) => ({ days: d.days, places: p.places })),
  )
  const [view, setView] = useState<View>('all')
  const [usageVersion, setUsageVersion] = useState(0)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [covers, setCovers] = useState(() => readDayCovers(trip.id))

  // The page always asks for a fresh list (the stop cards may hold an older one)
  useEffect(() => {
    void tripPhotos.load(trip.id, { force: true })
  }, [trip.id])

  const list = useMemo(() => photos.photos ?? [], [photos.photos])
  const days: readonly DayWithStops[] = useMemo(() => itinerary.data?.days ?? [], [itinerary.data])
  const places = useMemo(
    () => new Map<string, Place>((itinerary.data?.places ?? []).map((p) => [p.id, p])),
    [itinerary.data],
  )
  const matchContext = useMemo(
    () =>
      itinerary.data
        ? buildMatchContext(itinerary.data.days, itinerary.data.places, trip.tz)
        : null,
    [itinerary.data, trip.tz],
  )
  const albums = useMemo(() => groupByDay(list, days, covers), [list, days, covers])
  const unfiled = useMemo(
    () => list.filter((photo) => isUnfiled(photo, matchContext?.knownDayIds)),
    [list, matchContext],
  )

  const byId = useMemo(() => new Map(list.map((photo) => [photo.id, photo])), [list])
  const sequence = useMemo(
    () => (viewer ? viewer.ids.flatMap((id) => byId.get(id) ?? []) : []),
    [viewer, byId],
  )
  const index = viewer ? Math.min(viewer.index, Math.max(sequence.length - 1, 0)) : 0
  const current = viewer ? (sequence[index] ?? null) : null

  /** Merge changed photos into the shared list (the stop cards read it too) */
  const merge = useCallback(
    (changed: readonly Attachment[], removed: readonly string[] = []) => {
      const drop = new Set([...changed.map((p) => p.id), ...removed])
      const base = tripPhotos.get(trip.id).photos ?? []
      tripPhotos.set(trip.id, [...base.filter((p) => !drop.has(p.id)), ...changed])
    },
    [trip.id],
  )

  /** File the given photos by GPS and time */
  const autoFile = useCallback(
    async (candidates: readonly Attachment[]): Promise<{ filed: number; failed: number }> => {
      if (!matchContext) return { filed: 0, failed: 0 }
      const plan = planMatches(candidates, matchContext)
      if (plan.length === 0) return { filed: 0, failed: 0 }
      const results = await Promise.allSettled(
        plan.map((item) => mediaApi.patch(trip.id, item.attachmentId, item.patch)),
      )
      const changed = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.attachment] : []))
      if (changed.length > 0) merge(changed)
      return { filed: changed.length, failed: results.length - changed.length }
    },
    [matchContext, trip.id, merge],
  )

  // Uploads arrive one by one; file them a moment after the last one lands
  const fresh = useRef(new Set<string>())
  const [freshTick, setFreshTick] = useState(0)
  const onUploaded = useCallback(
    (added: Attachment[]) => {
      merge(added)
      for (const photo of added) fresh.current.add(photo.id)
      setUsageVersion((n) => n + 1)
      setFreshTick((n) => n + 1)
    },
    [merge],
  )
  useEffect(() => {
    if (!canEdit || !matchContext || fresh.current.size === 0) return
    const timer = window.setTimeout(() => {
      const ids = fresh.current
      fresh.current = new Set()
      const candidates = (tripPhotos.get(trip.id).photos ?? []).filter((p) => ids.has(p.id))
      void autoFile(candidates).then(({ filed }) => {
        if (filed > 0) toast.show(t.plural('photos.match.done', filed), { tone: 'success' })
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [freshTick, canEdit, matchContext, autoFile, trip.id, toast, t])

  const runAutoSort = async () => {
    setBusy(true)
    try {
      const { filed, failed } = await autoFile(unfiled)
      if (failed > 0) toast.show(t('photos.match.failed', { count: failed }), { tone: 'danger' })
      else if (filed > 0) toast.show(t.plural('photos.match.done', filed), { tone: 'success' })
      else toast.show(t('photos.match.none'))
    } finally {
      setBusy(false)
    }
  }

  const move = async (
    photo: Attachment,
    target: { dayId: string | null; stopId: string | null },
  ) => {
    setBusy(true)
    try {
      const result = await mediaApi.patch(trip.id, photo.id, target)
      merge([result.attachment])
      const where = filedText(result.attachment, days, places, t)
      toast.show(where ? t('photos.move.done', { target: where }) : t('photos.move.doneNone'), {
        tone: 'success',
      })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const setTripCover = async (attachmentId: string | null) => {
    setBusy(true)
    try {
      const result = await api.patchTrip(trip.id, { coverAttachmentId: attachmentId })
      setTrip(result.trip)
      toast.show(attachmentId ? t('photos.cover.saved') : t('photos.cover.cleared'), {
        tone: 'success',
      })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const albumOf = (photo: Attachment): DayAlbum | undefined =>
    albums.days.find((album) => album.photos.some((p) => p.id === photo.id))

  const setDayCover = (photo: Attachment) => {
    const album = albumOf(photo)
    if (!album) return
    const next = { ...covers, [album.day.id]: photo.id }
    setCovers(next)
    writeDayCovers(trip.id, next)
    toast.show(t('photos.dayCover.saved', { day: dayLabel(album.day, t) }), { tone: 'success' })
  }

  const remove = async (photo: Attachment) => {
    setBusy(true)
    try {
      await mediaApi.remove(trip.id, photo.id)
      photoCache.evict(photo.id)
      merge([], [photo.id])
      setConfirming(false)
      setViewer((v) => {
        if (!v) return v
        const ids = v.ids.filter((id) => id !== photo.id)
        return ids.length === 0 ? null : { ids, index: Math.min(v.index, ids.length - 1) }
      })
      setUsageVersion((n) => n + 1)
      // The Worker cleared the cover if it was this photo
      if (trip.coverAttachmentId === photo.id) reloadTrip()
      toast.show(t('photos.delete.done'), { tone: 'success' })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const coverBadge = (photo: Attachment, dayCoverId?: string | null) => {
    const isTrip = trip.coverAttachmentId === photo.id
    const isDay = dayCoverId === photo.id
    if (!isTrip && !isDay) return null
    return (
      <>
        {isTrip && <Chip tone="fjord">{t('photos.cover.current')}</Chip>}
        {isDay && <Chip tone="tussock">{t('photos.dayCover.current')}</Chip>}
      </>
    )
  }

  const grid = (items: Attachment[], testId: string, dayCoverId?: string | null) => (
    <PhotoGrid
      photos={items}
      tripId={trip.id}
      data-testid={testId}
      onOpen={(at) => setViewer({ ids: items.map((p) => p.id), index: at })}
      labelFor={(at) => t('photos.open', { index: at + 1 })}
      altFor={(at) => t('photos.alt', { index: at + 1 })}
      badge={(photo) => coverBadge(photo, dayCoverId)}
    />
  )

  const loading = photos.status === 'idle' || photos.status === 'loading'
  const currentAlbum = current ? albumOf(current) : undefined

  return (
    <Stack>
      <Head>
        <PageHeading
          title={t('photos.title')}
          lead={photos.status === 'ready' ? t.plural('photos.count', list.length) : undefined}
        />
        <StorageMeter tripId={trip.id} version={usageVersion} />
      </Head>

      {canEdit && <PhotoUploader tripId={trip.id} onUploaded={onUploaded} />}

      <Stack as="section" $gap="md" aria-labelledby="photos-grid" aria-busy={loading}>
        <SectionTitle id="photos-grid">
          {t('photos.title')}
          {photos.status === 'ready' && <Count>{list.length}</Count>}
        </SectionTitle>
        {list.length > 0 && (
          <Toolbar>
            <Tabs
              items={[
                { value: 'all', label: t('photos.tabs.all') },
                { value: 'days', label: t('photos.tabs.days') },
              ]}
              value={view}
              onChange={setView}
              label={t('photos.tabs.label')}
              idPrefix="photos-view"
            />
            {canEdit && matchContext && unfiled.length > 0 && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void runAutoSort()}
                title={t('photos.match.hint')}
              >
                {t('photos.match.run')}
              </Button>
            )}
          </Toolbar>
        )}
        {loading && skeletonGrid}
        {photos.status === 'error' && (
          <EmptyState
            illustration="pin"
            title={t('photos.loadError')}
            body=""
            action={
              <Button onClick={() => void tripPhotos.load(trip.id, { force: true })}>
                {t('error.retry')}
              </Button>
            }
          />
        )}
        {photos.status === 'ready' && list.length === 0 && (
          <EmptyState
            illustration="suitcase"
            title={t('photos.empty.title')}
            body={canEdit ? t('photos.empty.body') : t('photos.empty.viewerBody')}
          />
        )}
        {list.length > 0 && view === 'all' && (
          <div role="tabpanel" id="photos-view-panel-all" aria-labelledby="photos-view-tab-all">
            {grid(list, 'photo-grid')}
          </div>
        )}
        {list.length > 0 && view === 'days' && (
          <Stack
            $gap="xl"
            role="tabpanel"
            id="photos-view-panel-days"
            aria-labelledby="photos-view-tab-days"
            aria-busy={itinerary.status === 'loading'}
          >
            {itinerary.status === 'loading' && skeletonGrid}
            {albums.days
              .filter((album) => album.photos.length > 0)
              .map((album) => {
                const headingId = `photos-day-${album.day.id}`
                const title = dayHeading(album.day, t)
                return (
                  <Album
                    key={album.day.id}
                    aria-labelledby={headingId}
                    data-testid={`album-day-${album.day.idx}`}
                    $color={colorOfDay(album.day, album.position)}
                  >
                    <AlbumHead>
                      {album.coverId && (
                        <Cover>
                          <PhotoThumb
                            attachmentId={album.coverId}
                            tripId={trip.id}
                            alt={t('photos.album.coverAlt', { day: title })}
                          />
                        </Cover>
                      )}
                      <SectionTitle as="h3" id={headingId}>
                        {title}
                        <Count>{album.photos.length}</Count>
                      </SectionTitle>
                    </AlbumHead>
                    {grid(album.photos, `album-grid-${album.day.idx}`, album.coverId)}
                  </Album>
                )
              })}
            {itinerary.status !== 'loading' && albums.unassigned.length > 0 && (
              <Album
                aria-labelledby="photos-day-unassigned"
                data-testid={`album-${UNASSIGNED}`}
                $color={color.line}
              >
                <SectionTitle as="h3" id="photos-day-unassigned">
                  {t('photos.album.unassigned')}
                  <Count>{albums.unassigned.length}</Count>
                </SectionTitle>
                <Hint>
                  {albums.days.length === 0
                    ? t('photos.album.noDays')
                    : t('photos.album.unassignedHint')}
                </Hint>
                {grid(albums.unassigned, `album-grid-${UNASSIGNED}`)}
              </Album>
            )}
          </Stack>
        )}
      </Stack>

      <Lightbox
        open={current !== null && !confirming}
        photos={sequence}
        index={index}
        onIndexChange={(next) => setViewer((v) => (v ? { ...v, index: next } : v))}
        onClose={() => setViewer(null)}
        tripId={trip.id}
        altFor={(at) => t('photos.alt', { index: at + 1 })}
        info={
          current && (
            <PhotoInfo
              key={current.id}
              photo={current}
              tz={trip.tz}
              days={days}
              places={places}
              canEdit={canEdit}
              busy={busy}
              isTripCover={trip.coverAttachmentId === current.id}
              isDayCover={currentAlbum?.coverId === current.id}
              onMove={(target) => void move(current, target)}
              onTripCover={(on) => void setTripCover(on ? current.id : null)}
              onDayCover={() => setDayCover(current)}
              onDelete={() => setConfirming(true)}
            />
          )
        }
      />

      <Dialog
        open={confirming && current !== null}
        onClose={() => setConfirming(false)}
        title={t('photos.delete.title')}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => current && void remove(current)}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('photos.delete.body')}</p>
      </Dialog>
    </Stack>
  )
}
