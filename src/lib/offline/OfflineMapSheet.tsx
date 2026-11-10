import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { Button, Sheet, useToast } from '../../components/index.ts'
import { MAP_STYLE_URL } from '../../map/config.ts'
import { color, fontSize, radius, space } from '../../styles/tokens.ts'
import { useT } from '../i18n.ts'
import { formatBytes } from '../upload/storage.ts'
import {
  clearTiles,
  downloadTiles,
  MAX_ZOOM,
  MIN_ZOOM,
  offlineMapsSupported,
  offlineTileCount,
  planSize,
  storageEstimate,
  tripBounds,
  type DownloadProgress,
  type LngLat,
} from './tiles.ts'

// 下載離線地圖 (e3-t06): the size estimate, the download with progress and 停止, and 清除. Opened
// from the map page; the work is in tiles.ts.

const Body = styled.div`
  display: grid;
  gap: ${space.md}px;
`

const Text = styled.p<{ $tone?: 'muted' | 'danger' }>`
  margin: 0;
  color: ${({ $tone }) => ($tone === 'danger' ? color.danger : $tone === 'muted' ? color.muted : color.ink)};
  font-size: ${({ $tone }) => ($tone ? fontSize.sm : fontSize.body)}px;
`

const Bar = styled.progress`
  width: 100%;
  height: 8px;
  appearance: none;
  border: 0;
  border-radius: ${radius.pill}px;
  overflow: hidden;
  background: ${color.line};
  &::-webkit-progress-bar {
    background: ${color.line};
  }
  &::-webkit-progress-value {
    background: ${color.fjord};
  }
  &::-moz-progress-bar {
    background: ${color.fjord};
  }
`

type Phase = 'idle' | 'downloading' | 'done' | 'error'

export interface OfflineMapSheetProps {
  open: boolean
  onClose: () => void
  tripId: string
  points: readonly LngLat[]
}

export default function OfflineMapSheet({ open, onClose, tripId, points }: OfflineMapSheetProps) {
  const t = useT()
  const toast = useToast()
  const bounds = useMemo(() => tripBounds(points), [points])
  const fullPlan = useMemo(() => (bounds ? planSize(bounds) : null), [bounds])
  const [maxZoom, setMaxZoom] = useState(MAX_ZOOM)
  const plan = useMemo(
    () => (bounds ? planSize(bounds, undefined, MIN_ZOOM, maxZoom) : null),
    [bounds, maxZoom],
  )
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [saved, setSaved] = useState(0)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const supported = offlineMapsSupported()

  const refresh = useCallback(() => {
    if (!supported) return
    void offlineTileCount(tripId).then(setSaved, () => setSaved(0))
    void storageEstimate().then(setStorage, () => setStorage(null))
  }, [supported, tripId])

  useEffect(() => {
    if (open) refresh()
    // Leaving the sheet stops a download in progress
    if (!open) abort.current?.abort()
  }, [open, refresh])

  const start = async () => {
    if (!bounds) return
    const controller = new AbortController()
    abort.current = controller
    setPhase('downloading')
    setProgress(null)
    try {
      const result = await downloadTiles(tripId, bounds, MAP_STYLE_URL, {
        maxZoom,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (controller.signal.aborted) {
        setPhase('idle')
      } else {
        setPhase('done')
        if (result.failed === 0) toast.show(t('offline.map.done'), { tone: 'success' })
      }
    } catch {
      setPhase(controller.signal.aborted ? 'idle' : 'error')
    } finally {
      abort.current = null
      refresh()
    }
  }

  const clear = async () => {
    await clearTiles(tripId)
    setPhase('idle')
    setProgress(null)
    toast.show(t('offline.map.cleared'))
    refresh()
  }

  const size = (bytes: number) => formatBytes(bytes, t.locale)
  const percent = progress && progress.total ? (progress.done + progress.failed) / progress.total : 0

  const actions =
    phase === 'downloading' ? (
      <Button onClick={() => abort.current?.abort()}>{t('offline.map.stop')}</Button>
    ) : (
      <>
        {saved > 0 && (
          <Button variant="danger" onClick={() => void clear()}>
            {t('offline.map.clear')}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!supported || !plan?.ok}
          onClick={() => void start()}
        >
          {t('offline.map.download')}
        </Button>
      </>
    )

  return (
    <Sheet open={open} onClose={onClose} title={t('offline.map.title')} actions={actions}>
      <Body data-testid="offline-map">
        <Text>{t('offline.map.body')}</Text>
        {!supported ? (
          <Text $tone="danger">{t('offline.map.unsupported')}</Text>
        ) : !bounds || !plan || !fullPlan ? (
          <Text $tone="muted">{t('offline.map.noPoints')}</Text>
        ) : (
          <>
            {plan.ok ? (
              <Text data-testid="offline-map-estimate">
                {t('offline.map.estimate', {
                  size: size(plan.bytes),
                  tiles: new Intl.NumberFormat(t.locale).format(plan.tiles),
                })}
              </Text>
            ) : fullPlan.suggestedMaxZoom !== null ? (
              <>
                <Text $tone="danger">
                  {t('offline.map.tooLarge', {
                    size: size(plan.bytes),
                    zoom: fullPlan.suggestedMaxZoom,
                  })}
                </Text>
                <div>
                  <Button size="sm" onClick={() => setMaxZoom(fullPlan.suggestedMaxZoom ?? MAX_ZOOM)}>
                    {t('offline.map.zoomTo', { zoom: fullPlan.suggestedMaxZoom })}
                  </Button>
                </div>
              </>
            ) : (
              <Text $tone="danger">{t('offline.map.tooLargeNoZoom')}</Text>
            )}
            {progress && (
              <>
                <Bar value={percent} max={1} aria-label={t('offline.map.title')} />
                <Text $tone="muted" role="status">
                  {t('offline.map.progress', { done: progress.done, total: progress.total })}
                </Text>
              </>
            )}
            {phase === 'done' && progress && progress.failed > 0 && (
              <Text $tone="danger">{t('offline.map.failed', { count: progress.failed })}</Text>
            )}
            {phase === 'error' && <Text $tone="danger">{t('offline.map.error')}</Text>}
            {saved > 0 && (
              <Text $tone="muted" data-testid="offline-map-saved">
                {t('offline.map.saved', { count: saved })}
              </Text>
            )}
            {storage && (
              <Text $tone="muted">
                {t('offline.map.storage', { used: size(storage.usage), quota: size(storage.quota) })}
              </Text>
            )}
          </>
        )}
      </Body>
    </Sheet>
  )
}
