import { useId, useState } from 'react'
import styled from 'styled-components'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import { AttachmentList, useToast, type AttachmentListItem } from '../../components/index.ts'
import {
  listOwnerAttachments,
  openInNewTab,
  type AttachmentOwner,
} from '../../lib/bookings/attachments.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { mediaApi } from '../../lib/upload/api.ts'
import { color, fontSize, media, radius, space, touchTarget } from '../../styles/tokens.ts'
import { Group, Hint } from './parts.tsx'

// 確認信／附件 (e4-t04, AC-4.3): a lodging's or booking's confirmation PDFs and screenshots. They
// go up through the E6 channel as `document` attachments (members-only, never resized), list with
// AttachmentList, open in a new tab from the bytes fetched with the member token, and never reach
// the share page (the Worker filters there; this section only says so).

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  > input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
`

const FileLabel = styled.label<{ $busy: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  cursor: ${({ $busy }) => ($busy ? 'progress' : 'pointer')};
  opacity: ${({ $busy }) => ($busy ? 0.6 : 1)};
  &:focus-within {
    outline: 2px solid ${color.fjord};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
`

type Upload = 'idle' | 'uploading' | MessageKey

export function BookingAttachments({
  tripId,
  owner,
}: {
  tripId: string
  /** null: not saved yet (attachments need its id) */
  owner: AttachmentOwner | null
}) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const canEdit = useCan()('editContent')
  const inputId = useId()
  const ownerKey = owner ? ('bookingId' in owner ? `b:${owner.bookingId}` : `l:${owner.lodgingId}`) : ''
  const list = useResource(`booking-attachments:${tripId}:${ownerKey}`, (signal) =>
    owner ? listOwnerAttachments(tripId, owner, signal) : Promise.resolve([]),
  )
  const [upload, setUpload] = useState<Upload>('idle')
  const [busyId, setBusyId] = useState<string | null>(null)

  const pick = async (files: File[]) => {
    if (!owner || files.length === 0) return
    setUpload('uploading')
    try {
      const { uploadAttachment } = await import('../../lib/upload/upload.ts')
      for (const file of files) {
        await uploadAttachment(tripId, file, { kind: 'document', ...owner })
      }
      setUpload('idle')
      list.reload()
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? (error as { code: unknown }).code : null
      setUpload(
        code === 'too_large'
          ? 'bookings.attachments.tooLarge'
          : code === 'unsupported_type'
            ? 'bookings.attachments.unsupported'
            : 'bookings.attachments.error',
      )
      list.reload()
    }
  }

  const open = (attachment: AttachmentListItem) => {
    const found = list.status === 'ready' ? list.data.find((a) => a.id === attachment.id) : null
    if (!found) return
    setBusyId(found.id)
    openInNewTab(() => mediaApi.fetchBlob(tripId, found.url))
      .catch(() => toast.show(t('bookings.attachments.openError'), { tone: 'danger' }))
      .finally(() => setBusyId(null))
  }

  const remove = async (attachment: AttachmentListItem) => {
    setBusyId(attachment.id)
    try {
      await mediaApi.remove(tripId, attachment.id)
      toast.show(t('bookings.attachments.deleted'))
      list.reload()
    } catch (error) {
      showError(error)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Group data-booking-attachments="">
      <legend>{t('bookings.attachments.title')}</legend>
      <Hint>{t('bookings.attachments.notice')}</Hint>
      {!owner ? (
        <Hint>{t('bookings.attachments.saveFirst')}</Hint>
      ) : (
        <>
          {list.status === 'error' ? (
            <Hint $tone="danger">{t('bookings.attachments.loadError')}</Hint>
          ) : list.status === 'ready' && list.data.length > 0 ? (
            <AttachmentList
              attachments={list.data}
              busyId={busyId}
              onOpen={open}
              onDelete={canEdit ? (attachment) => void remove(attachment) : undefined}
            />
          ) : list.status === 'ready' ? (
            <Hint>{t('bookings.attachments.empty')}</Hint>
          ) : null}
          {canEdit && (
            <Bar>
              <input
                id={inputId}
                type="file"
                multiple
                accept="application/pdf,image/*"
                disabled={upload === 'uploading'}
                onChange={(event) => {
                  // Copy first: clearing the input empties its live FileList
                  void pick(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }}
              />
              <FileLabel htmlFor={inputId} $busy={upload === 'uploading'}>
                {upload === 'uploading'
                  ? t('bookings.attachments.uploading')
                  : t('bookings.attachments.add')}
              </FileLabel>
              {upload !== 'idle' && upload !== 'uploading' && <Hint $tone="danger">{t(upload)}</Hint>}
            </Bar>
          )}
        </>
      )}
    </Group>
  )
}
