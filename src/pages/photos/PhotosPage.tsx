import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import type { Attachment } from '../../../shared/api/media.ts'
import {
  Button,
  Chip,
  Dialog,
  EmptyState,
  IconButton,
  PhotoThumb,
  Skeleton,
  StorageMeter,
  useToast,
} from '../../components/index.ts'
import { PhotoUploader } from '../../components/PhotoUploader.tsx'
import { useTripContext } from '../../app/trip-context.ts'
import { api } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { mediaApi } from '../../lib/upload/api.ts'
import { photoCache } from '../../lib/upload/photo-cache.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, media, radius, space } from '../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { sortPhotos, takenAtText } from './photos.ts'

// /trips/:id/photos (e6-t02, e6-t05): the trip's photos in capture order, the uploader for editors,
// the storage meter, and a minimal viewer (previous/next, set as cover, delete). Albums per day and
// the real lightbox (swipe, place, captions) are e6-t04.

const Head = styled.div`
  display: grid;
  gap: ${space.lg}px;
  @media ${media.tablet} {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
    align-items: end;
  }
`

const Grid = styled.ul`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
  @media ${media.tablet} {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${space.sm}px;
  }
  @media ${media.desktop} {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
`

const Tile = styled.button`
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: ${radius.control}px;
  overflow: hidden;
  background: ${color.line};
  cursor: zoom-in;
  ${focusRing}
`

const Badge = styled.span`
  position: absolute;
  left: ${space.xs}px;
  bottom: ${space.xs}px;
`

const Frame = styled.div`
  width: 100%;
  height: min(60dvh, 420px);
  border-radius: ${radius.control}px;
  overflow: hidden;
  background: ${color.paper};
`

const Meta = styled.p`
  margin: ${space.sm}px 0 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Nav = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: ${space.sm}px;
`

const ChevronLeft = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m15 18-6-6 6-6" />
  </svg>
)

const ChevronRight = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export default function PhotosPage() {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, setTrip, reload: reloadTrip } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const photos = useResource(`photos:${trip.id}`, (signal) =>
    mediaApi.list(trip.id, { kind: 'photo' }, signal).then((r) => sortPhotos(r.attachments)),
  )
  const [usageVersion, setUsageVersion] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  // Uploads and deletes edit a local copy (several uploads can finish in the same tick)
  const [local, setLocal] = useState<Attachment[] | null>(null)
  const list = local ?? photos.data ?? []
  const current = open === null ? null : (list[open] ?? null)

  const onUploaded = useCallback(
    (added: Attachment[]) => {
      const ids = new Set(added.map((photo) => photo.id))
      setLocal((prev) =>
        sortPhotos([...(prev ?? photos.data ?? []).filter((p) => !ids.has(p.id)), ...added]),
      )
      setUsageVersion((n) => n + 1)
    },
    [photos.data],
  )

  const step = useCallback(
    (delta: number) =>
      setOpen((index) =>
        index === null || list.length === 0 ? index : (index + delta + list.length) % list.length,
      ),
    [list.length],
  )

  // Arrow keys move through the photos while the viewer is open
  useEffect(() => {
    if (open === null || confirming) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirming, step])

  const setCover = async (attachmentId: string | null) => {
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

  const remove = async (photo: Attachment) => {
    setBusy(true)
    try {
      await mediaApi.remove(trip.id, photo.id)
      photoCache.evict(photo.id)
      const rest = list.filter((item) => item.id !== photo.id)
      setLocal(rest)
      setConfirming(false)
      setOpen(rest.length === 0 ? null : Math.min(open ?? 0, rest.length - 1))
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

  const isCover = current !== null && trip.coverAttachmentId === current.id

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

      <Stack as="section" $gap="md" aria-labelledby="photos-grid" aria-busy={photos.status === 'loading'}>
        <SectionTitle id="photos-grid">
          {t('photos.title')}
          {photos.status === 'ready' && <Count>{list.length}</Count>}
        </SectionTitle>
        {photos.status === 'loading' && (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <Skeleton $height={0} style={{ aspectRatio: '1', height: 'auto' }} />
              </li>
            ))}
          </Grid>
        )}
        {photos.status === 'error' && (
          <EmptyState
            illustration="pin"
            title={t('photos.loadError')}
            body=""
            action={<Button onClick={photos.reload}>{t('error.retry')}</Button>}
          />
        )}
        {photos.status === 'ready' && list.length === 0 && (
          <EmptyState
            illustration="suitcase"
            title={t('photos.empty.title')}
            body={canEdit ? t('photos.empty.body') : t('photos.empty.viewerBody')}
          />
        )}
        {list.length > 0 && (
          <Grid data-testid="photo-grid">
            {list.map((photo, index) => (
              <li key={photo.id}>
                <Tile
                  type="button"
                  aria-label={t('photos.open', { index: index + 1 })}
                  onClick={() => setOpen(index)}
                >
                  <PhotoThumb
                    attachmentId={photo.id}
                    tripId={trip.id}
                    variant="thumb"
                    alt={t('photos.alt', { index: index + 1 })}
                  />
                  {trip.coverAttachmentId === photo.id && (
                    <Badge>
                      <Chip tone="fjord">{t('photos.cover.current')}</Chip>
                    </Badge>
                  )}
                </Tile>
              </li>
            ))}
          </Grid>
        )}
      </Stack>

      <Dialog
        open={current !== null && !confirming}
        onClose={() => setOpen(null)}
        title={
          current
            ? t('photos.viewer.title', { index: (open ?? 0) + 1, total: list.length })
            : t('photos.title')
        }
        actions={
          current && canEdit ? (
            <>
              <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
              <Button
                variant={isCover ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={() => void setCover(isCover ? null : current.id)}
              >
                {isCover ? t('photos.cover.clear') : t('photos.cover.set')}
              </Button>
            </>
          ) : undefined
        }
      >
        {current && (
          <>
            <Frame>
              <PhotoThumb
                key={current.id}
                attachmentId={current.id}
                tripId={trip.id}
                variant="full"
                fit="contain"
                alt={t('photos.alt', { index: (open ?? 0) + 1 })}
              />
            </Frame>
            <Nav>
              <IconButton
                label={t('photos.viewer.prev')}
                icon={<ChevronLeft />}
                onClick={() => step(-1)}
                disabled={list.length < 2}
              />
              {isCover && <Chip tone="fjord">{t('photos.cover.current')}</Chip>}
              <IconButton
                label={t('photos.viewer.next')}
                icon={<ChevronRight />}
                onClick={() => step(1)}
                disabled={list.length < 2}
              />
            </Nav>
            {current.takenAt && (
              <Meta>
                {t('photos.viewer.takenAt', {
                  time: takenAtText(current.takenAt, trip.tz, t.locale),
                })}
              </Meta>
            )}
          </>
        )}
      </Dialog>

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
