import { useId, useState } from 'react'
import styled from 'styled-components'
import type { ShareOptions } from '../../../shared/schema/share.ts'
import { Button, Dialog, Input, useToast } from '../../components/index.ts'
import { sharesApi } from '../../lib/api.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { copyText, DEFAULT_SHARE_OPTIONS, SHARE_OPTION_KEYS, shareUrl } from '../../lib/shares.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'
import { Note } from '../members/MembersSection.tsx'

// Settings → 分享連結 → 建立 (e1-t05). Two steps in one dialog: the options (money and addresses
// hidden by default, recap off), then the new link, shown this once (POST /shares is the only
// response with the token) with copy and open-in-a-new-tab. Closing forgets the token.

const Options = styled.fieldset`
  display: grid;
  gap: ${space.md}px;
  margin: 0;
  padding: 0;
  border: 0;
  > legend {
    margin-bottom: ${space.sm}px;
    padding: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
  }
`

const Option = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px ${space.sm}px;
  align-items: start;
  cursor: pointer;
  > input {
    grid-row: span 2;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: ${color.fjord};
  }
`

const OptionName = styled.span`
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.medium};
`

const OptionHint = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const OpenLink = styled.a`
  color: ${color.fjord};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

export interface ShareDialogProps {
  tripId: string
  onClose: () => void
  /** After the link was created (the list reloads) */
  onCreated: () => void
}

/** Mounted while open: every opening starts from the defaults and never keeps an old token */
export function ShareDialog({ tripId, onClose, onCreated }: ShareDialogProps) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const fieldId = useId()
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    try {
      const response = await sharesApi.create(tripId, options)
      setUrl(shareUrl(response.shareToken, window.location.origin))
      onCreated()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!url) return
    const ok = await copyText(url, document.getElementById(fieldId) as HTMLInputElement | null)
    toast.show(ok ? t('shares.copied') : t('shares.copyManual'), {
      tone: ok ? 'success' : 'neutral',
    })
  }

  if (url !== null) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={t('shares.createdTitle')}
        actions={
          <>
            <Button onClick={onClose}>{t('shares.done')}</Button>
            <Button variant="primary" onClick={copy}>
              {t('shares.copy')}
            </Button>
          </>
        }
      >
        <Stack $gap="md">
          <Note>{t('shares.once')}</Note>
          <Input
            id={fieldId}
            label={t('shares.link')}
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <div>
            <OpenLink href={url} target="_blank" rel="noopener noreferrer">
              {t('shares.open')}
            </OpenLink>
          </div>
        </Stack>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('shares.create')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? t('shares.creating') : t('shares.create')}
          </Button>
        </>
      }
    >
      <Stack $gap="md">
        <Options>
          <legend>{t('shares.optionsLabel')}</legend>
          {SHARE_OPTION_KEYS.map((key) => (
            <Option key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
              />
              <OptionName>{t(`shares.option.${key}`)}</OptionName>
              <OptionHint>{t(`shares.hint.${key}`)}</OptionHint>
            </Option>
          ))}
        </Options>
        <Note>{t('shares.alwaysHidden')}</Note>
      </Stack>
    </Dialog>
  )
}
