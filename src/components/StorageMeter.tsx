import { useEffect } from 'react'
import styled, { css } from 'styled-components'
import type { AttachmentUsageResponse } from '../../shared/api/media.ts'
import { useResource } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { mediaApi } from '../lib/upload/api.ts'
import { formatBytes, usageRatio, usageTone, type UsageTone } from '../lib/upload/storage.ts'
import { color, fontSize, radius, space } from '../styles/tokens.ts'

// A trip's photo and attachment storage (e6-t05, AC-6.4): GET /api/trips/:id/attachments/usage →
// a bar of bytes / warnAtBytes (1.5 GB) with "X of 1.5 GB used"; amber from 80 %, red once over.
// This is the per-trip view only. The owner-wide view (whole bucket against the 8 GB warning, R2's
// free 10 GB) belongs to E11's usage page, which reads its own endpoint.

const toneColor = { ok: color.fjord, warning: color.warning, danger: color.danger } as const

const Wrap = styled.div<{ $compact: boolean }>`
  display: grid;
  gap: ${space.xs}px;
  min-width: ${({ $compact }) => ($compact ? 0 : 200)}px;
  font-size: ${fontSize.sm}px;
`

const Line = styled.p`
  margin: 0;
  display: flex;
  justify-content: space-between;
  gap: ${space.sm}px;
  color: ${color.muted};
  font-variant-numeric: tabular-nums;
`

const Track = styled.div`
  height: 6px;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  overflow: hidden;
`

const Fill = styled.div<{ $tone: UsageTone; $ratio: number }>`
  height: 100%;
  width: ${({ $ratio }) => Math.min(100, Math.max(2, $ratio * 100)).toFixed(1)}%;
  border-radius: ${radius.pill}px;
  background: ${({ $tone }) => toneColor[$tone]};
`

const Note = styled.p<{ $tone: UsageTone }>`
  margin: 0;
  ${({ $tone }) => css`
    color: ${$tone === 'danger' ? color.danger : color.ink};
  `}
`

export interface StorageMeterViewProps {
  usage: AttachmentUsageResponse
  /** One line, no label (the trip home) */
  compact?: boolean
}

/** The meter itself, for a usage already loaded */
export function StorageMeterView({ usage, compact = false }: StorageMeterViewProps) {
  const t = useT()
  const ratio = usageRatio(usage.bytes, usage.warnAtBytes)
  const tone = usageTone(usage.bytes, usage.warnAtBytes)
  const limit = formatBytes(usage.warnAtBytes, t.locale)
  const used = t('photos.storage.used', { used: formatBytes(usage.bytes, t.locale), limit })
  return (
    <Wrap $compact={compact} data-tone={tone}>
      <Line>
        {!compact && <span>{t('photos.storage.label')}</span>}
        <span>{used}</span>
      </Line>
      <Track
        role="meter"
        aria-label={t('photos.storage.label')}
        aria-valuemin={0}
        aria-valuemax={usage.warnAtBytes}
        aria-valuenow={Math.min(usage.bytes, usage.warnAtBytes)}
        aria-valuetext={used}
      >
        <Fill $tone={tone} $ratio={ratio} />
      </Track>
      {tone !== 'ok' && (
        <Note $tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
          {tone === 'danger' ? t('photos.storage.over', { limit }) : t('photos.storage.warning')}
        </Note>
      )}
    </Wrap>
  )
}

export interface StorageMeterProps {
  tripId: string
  compact?: boolean
  /** Show nothing until usage reaches this share of the warning size (the trip home: 0.5) */
  showFrom?: number
  /** Change it to fetch again (after an upload or a delete) */
  version?: number
}

/** A trip's storage use, loaded from the API */
export function StorageMeter({ tripId, compact, showFrom = 0, version = 0 }: StorageMeterProps) {
  const t = useT()
  const usage = useResource(tripId, (signal) => mediaApi.usage(tripId, signal))
  const { reload } = usage
  // A new version reloads in place (the old numbers stay up meanwhile, no flash)
  useEffect(() => {
    if (version) reload()
  }, [version, reload])
  if (usage.status === 'error')
    return showFrom > 0 ? null : <Line role="status">{t('photos.storage.error')}</Line>
  if (usage.status !== 'ready') return null
  if (usageRatio(usage.data.bytes, usage.data.warnAtBytes) < showFrom) return null
  return <StorageMeterView usage={usage.data} compact={compact} />
}
