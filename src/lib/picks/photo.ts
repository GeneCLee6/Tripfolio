import { useEffect, useState } from 'react'
import type { WishlistItemView } from '../../../shared/api/types.ts'
import { mediaApi } from '../upload/api.ts'

// The picture on a pick: its uploaded photo (members fetch it with their token and show it as an
// object URL, src/lib/upload/api.ts), else the og:image kept from its source link, else nothing (the
// card draws a category placeholder). Object URLs are kept for the session, one per attachment, so
// the wall and the detail pane share them.

const cache = new Map<string, Promise<string>>()

/** `/api/media/:aid/thumb` (400 px) for cards, the 2048 px original for the detail pane */
export function mediaUrl(attachmentId: string, size: 'thumb' | 'full'): string {
  const base = `/api/media/${encodeURIComponent(attachmentId)}`
  return size === 'thumb' ? `${base}/thumb` : base
}

function objectUrl(tripId: string, url: string): Promise<string> {
  let hit = cache.get(url)
  if (!hit) {
    hit = mediaApi.fetchBlob(tripId, url).then((blob) => URL.createObjectURL(blob))
    hit.catch(() => cache.delete(url))
    cache.set(url, hit)
  }
  return hit
}

/** The image to show for `item`, or null (placeholder) */
export function usePickImage(
  tripId: string,
  item: Pick<WishlistItemView, 'photoAttachmentId' | 'sourceImageUrl'>,
  size: 'thumb' | 'full' = 'thumb',
): string | null {
  const url = item.photoAttachmentId ? mediaUrl(item.photoAttachmentId, size) : null
  const [loaded, setLoaded] = useState<{ url: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    objectUrl(tripId, url).then(
      (src) => live && setLoaded({ url, src }),
      () => live && setLoaded({ url, src: null }),
    )
    return () => {
      live = false
    }
  }, [tripId, url])
  if (url) {
    if (loaded?.url === url && loaded.src) return loaded.src
    // While the photo loads (or when it failed) the source image stands in
    return item.sourceImageUrl
  }
  return item.sourceImageUrl
}
