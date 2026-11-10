import styled from 'styled-components'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { useT } from '../i18n.ts'
import { useOnline } from '../offline/useOnline.ts'
import { useTripSyncContext } from './trip-sync-context.ts'

// The trip's live sync state (e2-t08b): 「即時」 while the socket is up, 「重新連線中」 while it
// retries, 「離線」 when the device has no connection. Shown in the trip layout.

export type SyncDotState = 'live' | 'connecting' | 'offline'

const LABEL = {
  live: 'sync.status.live',
  connecting: 'sync.status.connecting',
  offline: 'sync.status.offline',
} as const

const Wrap = styled.span<{ $state: SyncDotState }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  white-space: nowrap;
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $state }) =>
      $state === 'live' ? color.success : $state === 'connecting' ? color.warning : color.muted};
  }
`

export function SyncStatusDot() {
  const t = useT()
  const online = useOnline()
  const sync = useTripSyncContext()
  if (!sync) return null
  const state: SyncDotState = !online ? 'offline' : sync.status === 'online' ? 'live' : 'connecting'
  return (
    <Wrap $state={state} role="status" data-testid="sync-status" data-state={state}>
      {t(LABEL[state])}
    </Wrap>
  )
}
