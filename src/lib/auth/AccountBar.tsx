import { useState } from 'react'
import styled from 'styled-components'
import { Avatar, Button } from '../../components/index.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { paletteIndex } from '../colors.ts'
import { useT } from '../i18n.ts'
import { GOOGLE_START_PATH } from './api.ts'
import { signOut, useAuth } from './auth.ts'

// The trip list's account strip (e1-t06): signed out → "sign in with Google"; signed in → avatar,
// name and sign out. Renders nothing while loading or when Google sign-in is not configured.

const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px ${space.md}px;
`

const Who = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  min-width: 0;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  overflow-wrap: anywhere;
`

const Muted = styled.p`
  margin: 0;
  flex-basis: 100%;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const failedSignIn = () => {
  try {
    return new URLSearchParams(window.location.search).get('signin') === 'failed'
  } catch {
    return false
  }
}

export function AccountBar() {
  const t = useT()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  if (auth.status === 'loading' || auth.status === 'disabled') return null
  if (auth.status === 'signedOut')
    return (
      <Strip>
        <Button onClick={() => window.location.assign(GOOGLE_START_PATH)}>{t('auth.signIn')}</Button>
        {failedSignIn() && <Muted role="status">{t('auth.failed')}</Muted>}
      </Strip>
    )
  const name = auth.user.name ?? auth.user.email ?? t('auth.account.google')
  return (
    <Strip>
      <Who data-testid="account-user">
        <Avatar name={name} colorIndex={paletteIndex(null, auth.user.id)} size="md" />
        {t('auth.signedInAs', { name })}
      </Who>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await signOut()
          } finally {
            setBusy(false)
          }
        }}
      >
        {t('auth.signOut')}
      </Button>
    </Strip>
  )
}
