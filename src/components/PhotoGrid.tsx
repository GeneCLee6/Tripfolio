import { useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, media, radius, space } from '../styles/tokens.ts'
import { PhotoThumb } from './PhotoThumb.tsx'

// A grid of trip photos (DESIGN.md §3, e6-t04): 3 columns on phones, 4 on tablets, 5 on desktops.
// Every tile is a button (Tab reaches it, Enter or Space opens it); a thumbnail is only fetched
// once its tile comes near the viewport.

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
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

/** Mounts its children once the box is within 800 px of the viewport */
function Lazy({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (seen || !ref.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: '800px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [seen])
  if (seen) return children
  return <span ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
}

export interface PhotoGridProps<P extends { id: string }> {
  photos: readonly P[]
  /** Defaults to the trip of the surrounding trip layout */
  tripId?: string
  onOpen: (index: number) => void
  /** The tile's name, e.g. 「查看照片 3」 (already translated) */
  labelFor: (index: number) => string
  /** The image's alt text (already translated) */
  altFor: (index: number) => string
  /** Chips over the tile's corner (cover marks) */
  badge?: (photo: P, index: number) => ReactNode
  'data-testid'?: string
}

export function PhotoGrid<P extends { id: string }>({
  photos,
  tripId,
  onOpen,
  labelFor,
  altFor,
  badge,
  'data-testid': testId,
}: PhotoGridProps<P>) {
  return (
    <Grid data-testid={testId}>
      {photos.map((photo, index) => {
        const mark = badge?.(photo, index)
        return (
          <li key={photo.id}>
            <Tile
              type="button"
              aria-label={labelFor(index)}
              data-photo-id={photo.id}
              onClick={() => onOpen(index)}
            >
              <Lazy>
                <PhotoThumb
                  attachmentId={photo.id}
                  tripId={tripId}
                  variant="thumb"
                  alt={altFor(index)}
                />
              </Lazy>
              {mark && <Badge>{mark}</Badge>}
            </Tile>
          </li>
        )
      })}
    </Grid>
  )
}
