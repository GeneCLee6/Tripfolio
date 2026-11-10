import { useId, useState } from 'react'
import { Button, Input, useToast } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { lifecycleApi } from '../../lib/lifecycle/api.ts'
import { saveBlob, webcalUrl } from '../../lib/lifecycle/files.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { copyText } from '../../lib/shares.ts'
import { Stack } from '../parts.tsx'
import { Actions, Block, BlockTitle, Muted } from './parts.tsx'

// Calendar export (e8-t05). Settings: a one-off .ics download for any member (fetched with the
// Bearer token, saved under the server's file name), and where the subscription URL comes from.
// The subscription URL is a share token's feed (GET /api/share/:token/calendar.ics), and share
// tokens are shown only once, so ShareDialog shows it next to the new link (ShareCalendarFeed).

export function CalendarSection({ tripId }: { tripId: string }) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const file = await lifecycleApi.calendar(tripId)
      saveBlob(file.blob, file.fileName)
      toast.show(t('lifecycle.calendar.done', { file: file.fileName }), { tone: 'success' })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Block>
      <BlockTitle>{t('lifecycle.calendar.title')}</BlockTitle>
      <Muted>{t('lifecycle.calendar.body')}</Muted>
      <Actions>
        <Button size="sm" onClick={download} disabled={busy}>
          {busy ? t('lifecycle.calendar.working') : t('lifecycle.calendar.download')}
        </Button>
      </Actions>
      <BlockTitle as="h4">{t('lifecycle.calendar.subscribeTitle')}</BlockTitle>
      <Muted>{t('lifecycle.calendar.subscribeBody')}</Muted>
    </Block>
  )
}

/** The webcal:// feed of a share link that was just created (ShareDialog, shown once like the link) */
export function ShareCalendarFeed({ shareToken }: { shareToken: string }) {
  const t = useT()
  const toast = useToast()
  const fieldId = useId()
  const url = webcalUrl(shareToken, window.location.origin)

  async function copy() {
    const ok = await copyText(url, document.getElementById(fieldId) as HTMLInputElement | null)
    toast.show(ok ? t('lifecycle.calendar.copied') : t('shares.copyManual'), {
      tone: ok ? 'success' : 'neutral',
    })
  }

  return (
    <Stack $gap="sm">
      <Input
        id={fieldId}
        label={t('lifecycle.calendar.feed')}
        hint={t('lifecycle.calendar.feedHint')}
        value={url}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <Actions>
        <Button size="sm" onClick={copy}>
          {t('lifecycle.calendar.copy')}
        </Button>
      </Actions>
    </Stack>
  )
}
