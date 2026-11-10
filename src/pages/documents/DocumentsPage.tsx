import { useRef, useState } from 'react'
import styled from 'styled-components'
import type { TripDocument } from '../../../shared/api/prep.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import type { DocCategory } from '../../../shared/schema/prep.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import {
  Button,
  Dialog,
  EmptyState,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { documentsApi } from '../../lib/prep/api.ts'
import { DOC_CATEGORIES, DOC_LABEL } from '../../lib/prep/constants.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { mediaApi } from '../../lib/upload/api.ts'
import { formatBytes } from '../../lib/upload/storage.ts'
import { UploadRejected, uploadAttachment } from '../../lib/upload/upload.ts'
import { color, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { Muted, Notice, Panel, Row } from '../checklists/prep-ui.tsx'
import { PageHeading, Stack } from '../parts.tsx'

// /trips/:id/documents (e9-t04): passports, visas, insurance, licences. Uploads go through the
// attachment channel with kind 'document' (members-only, never resized); opening fetches the bytes
// with the member token (no-store) into an object URL in a new tab. Documents never reach a share
// page: the server leaves them out of every share payload and refuses share tokens for them.

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif'

type Filter = 'all' | DocCategory | 'none'

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Item = styled.li`
  display: grid;
  gap: ${space.sm}px;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  @media ${media.tablet} {
    grid-template-columns: minmax(0, 1fr) minmax(160px, 200px) auto;
    align-items: end;
  }
`

const Title = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  > strong {
    font-size: ${fontSize.body}px;
    font-weight: ${fontWeight.semibold};
  }
  > span {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
`

const ScrollRow = styled.div`
  display: flex;
  overflow-x: auto;
  padding: 2px;
`

export default function DocumentsPage() {
  const t = useT()
  const { trip, members } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const input = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [uploadCategory, setUploadCategory] = useState<DocCategory>('passport')
  const [percent, setPercent] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<TripDocument | null>(null)

  const docs = useResource(`documents:${trip.id}`, (signal) => documentsApi.list(trip.id, signal))
  const list = docs.status === 'ready' ? docs.data.documents : []
  const shown = list.filter((d) =>
    filter === 'all' ? true : filter === 'none' ? d.docCategory === null : d.docCategory === filter,
  )

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      setPercent(0)
      try {
        const attachment = await uploadAttachment(trip.id, file, {
          kind: 'document',
          onProgress: (p) => setPercent(p.total ? Math.round((p.loaded / p.total) * 100) : 0),
        })
        await documentsApi.patch(trip.id, attachment.id, { docCategory: uploadCategory })
        toast.show(t('prep.documents.uploaded'))
      } catch (error) {
        if (error instanceof UploadRejected)
          toast.show(
            t(error.code === 'too_large' ? 'prep.documents.tooLarge' : 'prep.documents.badType'),
            { tone: 'danger' },
          )
        else showError(error)
      }
    }
    setPercent(null)
    if (input.current) input.current.value = ''
    docs.reload()
  }

  const open = async (doc: TripDocument) => {
    // Open the tab synchronously (popup blockers), then point it at the object URL
    const tab = window.open('', '_blank')
    try {
      const blob = await mediaApi.fetchBlob(trip.id, doc.url)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.location.assign(url)
      // The tab has loaded it by then; the URL only lives as long as this page anyway
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      tab?.close()
      showError(error)
    }
  }

  const recategorise = async (doc: TripDocument, docCategory: DocCategory | null) => {
    try {
      const res = await documentsApi.patch(trip.id, doc.id, { docCategory })
      if (docs.status === 'ready')
        docs.set({
          ...docs.data,
          documents: docs.data.documents.map((d) => (d.id === doc.id ? res.document : d)),
        })
    } catch (error) {
      showError(error)
    }
  }

  const remove = async (doc: TripDocument) => {
    try {
      await mediaApi.remove(trip.id, doc.id)
      setDeleting(null)
      toast.show(t('prep.documents.deleted'))
      docs.reload()
    } catch (error) {
      showError(error)
    }
  }

  const label = (doc: TripDocument) =>
    doc.docCategory ? t(DOC_LABEL[doc.docCategory]) : t('prep.documents.category.none')
  const filters = [
    { value: 'all' as const, label: t('prep.documents.all') },
    ...DOC_CATEGORIES.map((value) => ({ value, label: t(DOC_LABEL[value]) })),
    { value: 'none' as const, label: t('prep.documents.category.none') },
  ]

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('prep.documents.title')}
        lead={t('prep.documents.lead')}
        actions={
          <ButtonLink to=".." relative="path" variant="ghost">
            {t('prep.back')}
          </ButtonLink>
        }
      />

      <Notice role="note" data-never-shared="">
        <strong>{t('prep.documents.never')}</strong>
        <p>{t('prep.documents.neverBody')}</p>
      </Notice>

      {editable && (
        <Panel aria-label={t('prep.documents.upload')}>
          <Row>
            <Select
              label={t('prep.documents.uploadCategory')}
              value={uploadCategory}
              onChange={(event) => setUploadCategory(event.target.value as DocCategory)}
            >
              {DOC_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(DOC_LABEL[value])}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              disabled={percent !== null}
              onClick={() => input.current?.click()}
            >
              {percent === null
                ? t('prep.documents.upload')
                : t('prep.documents.uploading', { percent })}
            </Button>
          </Row>
          <Muted>{t('prep.documents.accept')}</Muted>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            data-testid="document-input"
            onChange={(event) => void upload(event.currentTarget.files)}
          />
        </Panel>
      )}

      {docs.status === 'loading' && <Skeleton $height={160} />}
      {docs.status === 'error' && (
        <EmptyState
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={docs.reload}>
              {t('error.retry')}
            </Button>
          }
        />
      )}
      {docs.status === 'ready' && list.length === 0 && (
        <EmptyState
          title={t('prep.documents.empty.title')}
          body={t('prep.documents.empty.body')}
        />
      )}
      {list.length > 0 && (
        <Stack $gap="md">
          <ScrollRow>
            <SegmentedControl
              size="sm"
              label={t('prep.documents.filter')}
              value={filter}
              onChange={setFilter}
              options={filters}
            />
          </ScrollRow>
          <List>
            {shown.map((doc) => {
              const uploader = members.find((m) => m.id === doc.uploaderMemberId)?.name
              return (
                <Item key={doc.id} data-document={doc.id}>
                  <Title>
                    <strong>{label(doc)}</strong>
                    <span>
                      {t('prep.documents.meta', {
                        kind:
                          doc.mime === 'application/pdf'
                            ? t('prep.documents.pdf')
                            : t('prep.documents.image'),
                        size: formatBytes(doc.bytes, t.locale),
                        date: formatDate(new Date(doc.createdAt), t.locale, { timeZone: trip.tz }),
                      })}
                      {uploader ? ` · ${uploader}` : ''}
                    </span>
                  </Title>
                  <Select
                    label={t('prep.documents.categoryOf')}
                    value={doc.docCategory ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      void recategorise(doc, (event.target.value || null) as DocCategory | null)
                    }
                  >
                    <option value="">{t('prep.documents.category.none')}</option>
                    {DOC_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {t(DOC_LABEL[value])}
                      </option>
                    ))}
                  </Select>
                  <Row>
                    <Button onClick={() => void open(doc)}>{t('prep.documents.open')}</Button>
                    {editable && (
                      <Button variant="ghost" onClick={() => setDeleting(doc)}>
                        {t('prep.delete')}
                      </Button>
                    )}
                  </Row>
                </Item>
              )
            })}
          </List>
        </Stack>
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('prep.documents.deleteTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('prep.cancel')}
            </Button>
            <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
              {t('prep.delete')}
            </Button>
          </>
        }
      >
        {deleting && <p>{t('prep.documents.deleteConfirm', { name: label(deleting) })}</p>}
      </Dialog>
    </Stack>
  )
}
