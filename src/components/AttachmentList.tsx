import styled from 'styled-components'
import type { Attachment } from '../../shared/api/media.ts'
import { formatDate } from '../../shared/i18n/format.ts'
import { useT } from '../lib/i18n.ts'
import { formatBytes } from '../lib/upload/storage.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, radius, space, touchTarget } from '../styles/tokens.ts'
import { IconButton } from './IconButton.tsx'
import { TrashIcon } from './icons.tsx'

// A list of document attachments (e4-t04 booking confirmations; e9 documents later): what it is
// (PDF / image), its size and when it was added. Tapping a row opens it (the caller fetches the
// bytes with the member token and shows an object URL); editors get a delete button. Attachments
// keep no file name, so a row is named by its type and position.

export type AttachmentListItem = Pick<Attachment, 'id' | 'mime' | 'bytes' | 'createdAt'>

export interface AttachmentListProps {
  attachments: readonly AttachmentListItem[]
  /** Open (preview) one */
  onOpen: (attachment: AttachmentListItem) => void
  /** Editors: delete one */
  onDelete?: (attachment: AttachmentListItem) => void
  /** The one being opened or deleted (its buttons are disabled) */
  busyId?: string | null
}

const List = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  padding: ${space.xs}px ${space.xs}px ${space.xs}px ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
`

const Open = styled.button`
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  min-height: ${touchTarget}px;
  padding: ${space.xs}px 0;
  border: 0;
  background: none;
  color: ${color.ink};
  font: inherit;
  text-align: left;
  cursor: pointer;
  ${focusRing}
  &:disabled {
    cursor: progress;
    opacity: 0.6;
  }
`

const Name = styled.span`
  font-weight: ${fontWeight.semibold};
  color: ${color.fjordInk};
  text-decoration: underline;
  text-underline-offset: 2px;
`

const Meta = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

/** PDF, or the image subtype in capitals (PNG, JPEG, HEIC…) */
function attachmentTypeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  const sub = mime.split('/')[1] ?? ''
  return sub.toUpperCase()
}

export function AttachmentList({ attachments, onOpen, onDelete, busyId = null }: AttachmentListProps) {
  const t = useT()
  return (
    <List>
      {attachments.map((attachment, index) => {
        const pdf = attachment.mime === 'application/pdf'
        const name = t(pdf ? 'attachments.namePdf' : 'attachments.nameImage', { n: index + 1 })
        const busy = busyId === attachment.id
        return (
          <Row key={attachment.id} data-attachment-id={attachment.id}>
            <Open
              type="button"
              disabled={busy}
              aria-label={t('attachments.open', { name })}
              onClick={() => onOpen(attachment)}
            >
              <Name>{name}</Name>
              <Meta>
                {t('attachments.meta', {
                  type: attachmentTypeLabel(attachment.mime),
                  size: formatBytes(attachment.bytes, t.locale),
                  date: formatDate(new Date(attachment.createdAt), t.locale),
                })}
              </Meta>
            </Open>
            {onDelete && (
              <IconButton
                label={t('attachments.delete', { name })}
                size="sm"
                disabled={busy}
                icon={<TrashIcon size={16} />}
                onClick={() => onDelete(attachment)}
              />
            )}
          </Row>
        )
      })}
    </List>
  )
}
