import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Button, Sheet, useToast } from '../../components/index.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, radius, space, zIndex } from '../../styles/tokens.ts'
import { useT } from '../i18n.ts'
import { applyUpdate, registerServiceWorker, useUpdateWaiting } from './register.ts'
import { offlineQueue, replayNow, startSync, usePendingMutations } from './sync.ts'
import { useOnline } from './useOnline.ts'

// The top bar's offline badge (「離線 · N 筆待同步」, e10-t05) with a Sheet listing what waits,
// and the 「有新版本」 bar. Mounting it starts the Service Worker and the queue's replay.

const Badge = styled.button<{ $tone: 'offline' | 'pending' | 'blocked' }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 32px;
  padding: 0 ${space.md}px;
  border: 1px solid
    ${({ $tone }) => ($tone === 'blocked' ? color.danger : $tone === 'offline' ? color.warning : color.line)};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${({ $tone }) => ($tone === 'blocked' ? color.danger : color.ink)};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  white-space: nowrap;
  cursor: pointer;
  ${focusRing}
`

const Dot = styled.span<{ $on: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $on }) => ($on ? color.success : color.warning)};
`

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li<{ $refused: boolean }>`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.md}px;
  border: 1px solid ${({ $refused }) => ($refused ? color.danger : color.line)};
  border-radius: ${radius.control}px;
  background: ${color.card};
`

const RowTitle = styled.div`
  font-weight: ${fontWeight.semibold};
`

const Muted = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Actions = styled.div`
  display: flex;
  gap: ${space.sm}px;
`

const Body = styled.div`
  display: grid;
  gap: ${space.md}px;
`

export function OfflineBadge() {
  const t = useT()
  const toast = useToast()
  const online = useOnline()
  const pending = usePendingMutations()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    registerServiceWorker()
    startSync()
  }, [])

  const blocked = pending.filter((item) => item.failure).length
  if (online && pending.length === 0 && !open) return null

  const label =
    blocked > 0
      ? t.plural('offline.badge.blocked', blocked)
      : !online
        ? pending.length > 0
          ? t.plural('offline.badge.offlinePending', pending.length)
          : t('offline.badge.offline')
        : t.plural('offline.badge.pending', pending.length)

  return (
    <>
      <Badge
        type="button"
        data-testid="offline-badge"
        $tone={blocked > 0 ? 'blocked' : online ? 'pending' : 'offline'}
        onClick={() => setOpen(true)}
      >
        <Dot $on={online} aria-hidden="true" />
        {label}
      </Badge>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('offline.sheet.title')}
        actions={
          online && pending.length > 0 && blocked === 0 ? (
            <Button variant="primary" onClick={() => void replayNow()}>
              {t('offline.syncNow')}
            </Button>
          ) : undefined
        }
      >
        <Body>
          <Muted>{online ? t('offline.sheet.online') : t('offline.sheet.offline')}</Muted>
          {pending.length === 0 ? (
            <Muted>{t('offline.sheet.empty')}</Muted>
          ) : (
            <List>
              {pending.map((item) => {
                const note = (item.body as { note?: unknown } | undefined)?.note
                return (
                  <Row key={item.id} $refused={Boolean(item.failure)}>
                    <RowTitle>
                      {item.method === 'POST' ? t('offline.item.create') : t('offline.item.update')}
                      {typeof note === 'string' && note ? ` · ${note}` : ''}
                    </RowTitle>
                    <Muted>
                      {item.failure
                        ? t('offline.item.refused', { message: item.failure.message })
                        : t('offline.item.waiting')}
                    </Muted>
                    {item.failure && (
                      <Actions>
                        <Button
                          size="sm"
                          onClick={() =>
                            void offlineQueue.retry(item.id).then(() => replayNow())
                          }
                        >
                          {t('offline.retry')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            void offlineQueue.discard(item.id).then(() => {
                              toast.show(t('offline.discarded'))
                              return replayNow()
                            })
                          }
                        >
                          {t('offline.discard')}
                        </Button>
                      </Actions>
                    )}
                  </Row>
                )
              })}
            </List>
          )}
          <Muted>{t('offline.sheet.notQueued')}</Muted>
        </Body>
      </Sheet>
    </>
  )
}

const UpdateBar = styled.div`
  position: fixed;
  left: 50%;
  top: calc(64px + env(safe-area-inset-top, 0px));
  transform: translateX(-50%);
  z-index: ${zIndex.toast};
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  padding: ${space.xs}px ${space.xs}px ${space.xs}px ${space.lg}px;
  border-radius: ${radius.control}px;
  background: ${color.ink};
  color: ${color.paper};
  box-shadow: 0 8px 24px ${color.shadow};
`

/** 「有新版本，重新整理」 while a new Service Worker waits */
export function UpdatePrompt() {
  const t = useT()
  const waiting = useUpdateWaiting()
  if (!waiting) return null
  return (
    <UpdateBar role="status">
      <span>{t('offline.update.message')}</span>
      <Button size="sm" variant="primary" onClick={applyUpdate}>
        {t('offline.update.reload')}
      </Button>
    </UpdateBar>
  )
}
