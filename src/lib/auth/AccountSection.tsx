import { useState } from 'react'
import { Button, Card, useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { Note, Row } from '../../pages/members/MembersSection.tsx'
import { SectionTitle, Stack } from '../../pages/parts.tsx'
import { useResource } from '../hooks.ts'
import { useT } from '../i18n.ts'
import { useApiErrorToast } from '../role.ts'
import { authApi, GOOGLE_START_PATH } from './api.ts'
import { useAuth } from './auth.ts'

// Settings → 帳號 (e1-t06): binds this device's member of the trip to the signed-in Google account,
// so the account finds the trip again on another device (POST /api/auth/trips mints a token there).
// Hidden while loading and when Google sign-in is not configured.

function LinkControls({ account }: { account: string }) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, me } = useTripContext()
  const link = useResource(`auth-link:${trip.id}:${me.id}`, (signal) =>
    authApi.getLink(trip.id, signal),
  )
  const [busy, setBusy] = useState(false)

  async function change(next: boolean) {
    setBusy(true)
    try {
      link.set(next ? await authApi.link(trip.id) : await authApi.unlink(trip.id))
      toast.show(t(next ? 'auth.account.linkDone' : 'auth.account.unlinkDone'), { tone: 'success' })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  if (link.status === 'loading') return null
  if (link.status === 'error') return <Note>{t('auth.account.loadError')}</Note>
  if (link.data.linked)
    return (
      <Row>
        <Note role="status">{t('auth.account.linked', { name: me.name, account })}</Note>
        <Button size="sm" disabled={busy} onClick={() => change(false)}>
          {t('auth.account.unlink')}
        </Button>
      </Row>
    )
  return (
    <Stack $gap="sm">
      {link.data.linkedToOther && <Note>{t('auth.account.linkedToOther')}</Note>}
      <div>
        <Button variant="primary" disabled={busy} onClick={() => change(true)}>
          {t('auth.account.link')}
        </Button>
      </div>
    </Stack>
  )
}

export function AccountSection() {
  const t = useT()
  const auth = useAuth()
  if (auth.status === 'loading' || auth.status === 'disabled') return null
  return (
    <Card as="section" aria-labelledby="settings-account">
      <Stack $gap="md">
        <SectionTitle id="settings-account">{t('auth.account.title')}</SectionTitle>
        <Note>{t('auth.account.body')}</Note>
        {auth.status === 'signedIn' ? (
          <LinkControls account={auth.user.email ?? auth.user.name ?? t('auth.account.google')} />
        ) : (
          <div>
            <Button onClick={() => window.location.assign(GOOGLE_START_PATH)}>
              {t('auth.account.signIn')}
            </Button>
          </div>
        )}
      </Stack>
    </Card>
  )
}
