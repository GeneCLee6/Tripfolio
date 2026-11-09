import { useContext, useEffect, useState } from 'react'
import styled from 'styled-components'
import { TripContext } from '../app/trip-context.ts'
import { photoCache, type PhotoVariant } from '../lib/upload/photo-cache.ts'
import { useT } from '../lib/i18n.ts'
import { color, fontSize, space } from '../styles/tokens.ts'
import { Skeleton } from './Skeleton.tsx'

// A trip photo as an <img> (e6-t02): fetched with the member's token through the shared object-URL
// cache in src/lib/upload/photo-cache.ts.

const Img = styled.img<{ $fit: 'cover' | 'contain' }>`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: ${({ $fit }) => $fit};
`

const Broken = styled.span`
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: ${space.sm}px;
  background: ${color.paper};
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  text-align: center;
`

export interface PhotoThumbProps {
  attachmentId: string
  variant?: PhotoVariant
  /** Already translated */
  alt: string
  /** Defaults to the trip of the surrounding trip layout */
  tripId?: string
  fit?: 'cover' | 'contain'
  className?: string
}

type State = { status: 'loading' | 'error'; url: null } | { status: 'ready'; url: string }

/**
 * A trip photo that fills its box: a Skeleton while it loads, a short note if it cannot be loaded.
 * A missing thumbnail falls back to the full photo.
 */
export function PhotoThumb({
  attachmentId,
  variant = 'thumb',
  alt,
  tripId,
  fit = 'cover',
  className,
}: PhotoThumbProps) {
  const t = useT()
  const contextTripId = useContext(TripContext)?.trip.id
  const trip = tripId ?? contextTripId ?? ''
  const key = `${variant}:${attachmentId}`
  const [state, setState] = useState<{ key: string } & State>(() => {
    const url = photoCache.peek(attachmentId, variant)
    return url ? { key, status: 'ready', url } : { key, status: 'loading', url: null }
  })

  useEffect(() => {
    let alive = true
    let held: PhotoVariant | null = variant
    const show = (url: string) => alive && setState({ key, status: 'ready', url })
    photoCache.acquire(trip, attachmentId, variant).then(show, () => {
      held = null
      if (!alive) return
      if (variant === 'full') return setState({ key, status: 'error', url: null })
      held = 'full'
      photoCache.acquire(trip, attachmentId, 'full').then(show, () => {
        held = null
        if (alive) setState({ key, status: 'error', url: null })
      })
    })
    return () => {
      alive = false
      if (held) photoCache.release(attachmentId, held)
    }
  }, [trip, attachmentId, variant, key])

  const current: State =
    state.key === key ? state : { status: 'loading', url: null }
  if (current.status === 'ready')
    return (
      <Img
        className={className}
        src={current.url}
        alt={alt}
        $fit={fit}
        decoding="async"
        draggable={false}
      />
    )
  if (current.status === 'error')
    return (
      <Broken className={className} role="img" aria-label={`${alt} · ${t('photos.broken')}`}>
        {t('photos.broken')}
      </Broken>
    )
  return <Skeleton className={className} $height={0} $radius="control" style={{ height: '100%' }} />
}
