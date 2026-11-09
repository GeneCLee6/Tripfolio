import { useState } from 'react'
import styled from 'styled-components'
import type { Share } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import { Button, Card, Chip, Dialog, Skeleton, useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { sharesApi } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { activeShareOptions } from '../../lib/shares.ts'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { SectionTitle, Stack } from '../parts.tsx'
import { Note, Row } from '../members/MembersSection.tsx'
import { ShareDialog } from './ShareDialog.tsx'

// Settings → 分享連結 (owner, e1-t05). The list (GET /shares) never has tokens, only when each
// link was made and what it hides; a new link is shown once by ShareDialog. Revoking asks first.
// Sharing stays open on an archived trip (the API allows it). Others get a short explanation.

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  > li + li {
    border-top: 1px solid ${color.line};
  }
`

const Item = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px ${space.md}px;
  padding: ${space.sm}px 0;
  font-size: ${fontSize.sm}px;
`

const Meta = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

export interface ShareListProps {
  shares: readonly Share[]
  /** Formats a share's creation date */
  dateOf: (share: Share) => string
  busy?: boolean
  onRevoke: (share: Share) => void
}

/** The active links: when each was made, its options as chips, and a revoke button */
export function ShareList({ shares, dateOf, busy = false, onRevoke }: ShareListProps) {
  const t = useT()
  return (
    <List aria-label={t('shares.title')}>
      {shares.map((share) => {
        const active = activeShareOptions(share.options)
        return (
          <Item key={share.id}>
            <Meta>
              <span>{t('shares.item', { date: dateOf(share) })}</span>
              <Chips aria-label={t('shares.optionsLabel')}>
                {active.length === 0 ? (
                  <Chip>{t('shares.noOptions')}</Chip>
                ) : (
                  active.map((key) => (
                    <Chip key={key} tone={key === 'showRecap' ? 'tussock' : 'fjord'}>
                      {t(`shares.option.${key}`)}
                    </Chip>
                  ))
                )}
              </Chips>
            </Meta>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={t('shares.revokeLabel', { date: dateOf(share) })}
              onClick={() => onRevoke(share)}
            >
              {t('shares.revoke')}
            </Button>
          </Item>
        )
      })}
    </List>
  )
}

export function SharesSection() {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip } = useTripContext()
  const owner = useCan()('manageShares')
  const shares = useResource(`shares:${trip.id}:${owner}`, (signal) =>
    owner ? sharesApi.list(trip.id, signal) : Promise.resolve({ shares: [] }),
  )
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<Share | null>(null)
  const [busy, setBusy] = useState(false)

  if (!owner) {
    return (
      <Card as="section" aria-labelledby="settings-shares">
        <Stack $gap="sm">
          <SectionTitle id="settings-shares">{t('shares.title')}</SectionTitle>
          <Note>{t('shares.ownerOnly')}</Note>
        </Stack>
      </Card>
    )
  }

  async function revoke(share: Share) {
    setBusy(true)
    try {
      await sharesApi.revoke(trip.id, share.id)
      toast.show(t('shares.revoked'), { tone: 'success' })
      setRevoking(null)
      shares.reload()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const dateOf = (share: Share) =>
    formatDate(new Date(share.createdAt), t.locale, { timeZone: trip.tz, year: true })

  return (
    <Card as="section" aria-labelledby="settings-shares">
      <Stack $gap="md">
        <Row>
          <SectionTitle id="settings-shares">{t('shares.title')}</SectionTitle>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)} disabled={busy}>
            {t('shares.create')}
          </Button>
        </Row>
        <Note>{t('shares.body')}</Note>
        {shares.status === 'loading' && <Skeleton $height={40} />}
        {shares.status === 'ready' &&
          (shares.data.shares.length === 0 ? (
            <Note>{t('shares.empty')}</Note>
          ) : (
            <ShareList
              shares={shares.data.shares}
              dateOf={dateOf}
              busy={busy}
              onRevoke={setRevoking}
            />
          ))}
      </Stack>

      {creating && (
        <ShareDialog
          tripId={trip.id}
          onClose={() => setCreating(false)}
          onCreated={() => shares.reload()}
        />
      )}

      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={t('shares.revokeTitle')}
        actions={
          <>
            <Button onClick={() => setRevoking(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => revoking && revoke(revoking)} disabled={busy}>
              {t('shares.revoke')}
            </Button>
          </>
        }
      >
        <Note>{t('shares.revokeBody')}</Note>
      </Dialog>
    </Card>
  )
}
