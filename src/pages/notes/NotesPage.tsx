import { Fragment, useState } from 'react'
import styled from 'styled-components'
import type { Note } from '../../../shared/api/prep.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import { Button, Dialog, EmptyState, Input, Skeleton, useToast } from '../../components/index.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { notesApi } from '../../lib/prep/api.ts'
import { parseNote, type Inline } from '../../lib/prep/markdown.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { Muted, Notice, Panel, PanelHead, PanelTitle, Row, Switch } from '../checklists/prep-ui.tsx'
import { PageHeading, Stack } from '../parts.tsx'

// /trips/:id/notes (e9-t05): destination notes (emergency numbers, plugs, driving rules…), copied
// from a destination template (New Zealand first) and edited freely. Bodies are markdown-lite
// (src/lib/prep/markdown.ts), rendered as elements, never as HTML. 「可分享」 marks a section the
// share page may show later (E8).

const Body = styled.div`
  display: grid;
  gap: ${space.sm}px;
  font-size: ${fontSize.body}px;
  overflow-wrap: anywhere;
  h3 {
    margin: ${space.xs}px 0 0;
    font-size: ${fontSize.body}px;
    font-weight: ${fontWeight.bold};
  }
  p,
  ul {
    margin: 0;
  }
  ul {
    padding-left: ${space.lg}px;
    display: grid;
    gap: 2px;
  }
  a {
    color: ${color.fjordInk};
  }
`

const Textarea = styled.textarea`
  width: 100%;
  min-height: 220px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
  color: ${color.ink};
  font-family: ${font.mono};
  font-size: ${fontSize.sm}px;
  line-height: 1.6;
  resize: vertical;
  ${focusRing}
`

const Label = styled.label`
  display: grid;
  gap: ${space.xs}px;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
`

const Shared = styled.span`
  font-size: ${fontSize.sm}px;
  color: ${color.success};
  font-weight: ${fontWeight.semibold};
`

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'link' ? (
          <a key={i} href={part.url} target="_blank" rel="noopener noreferrer">
            {part.url.replace(/^https:\/\//, '')}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}

export function NoteBody({ body }: { body: string }) {
  return (
    <Body>
      {parseNote(body).map((block, i) =>
        block.kind === 'heading' ? (
          <h3 key={i}>
            <Inlines parts={block.content} />
          </h3>
        ) : block.kind === 'list' ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Inlines parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inlines parts={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </Body>
  )
}

export default function NotesPage() {
  const t = useT()
  const { trip } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [applying, setApplying] = useState(false)

  const notes = useResource(`notes:${trip.id}`, (signal) => notesApi.list(trip.id, signal))
  const list = notes.status === 'ready' ? notes.data.notes : []
  const replace = (note: Note) => {
    if (notes.status === 'ready')
      notes.set({ ...notes.data, notes: notes.data.notes.map((n) => (n.id === note.id ? note : n)) })
  }

  const applyTemplate = async () => {
    setApplying(true)
    try {
      const res = await notesApi.applyTemplate(trip.id, { destination: 'nz', locale: t.locale })
      if (notes.status === 'ready') notes.set({ notes: res.notes, rev: res.rev })
      else notes.reload()
      toast.show(
        res.added
          ? t('prep.notes.template.done', { count: res.added })
          : t('prep.notes.template.nothing'),
      )
    } catch (error) {
      showError(error)
    } finally {
      setApplying(false)
    }
  }

  const save = async (note: Note, patch: { title?: string; body?: string; shareable?: boolean }) => {
    try {
      const res = await notesApi.patch(trip.id, note.id, patch)
      replace(res.note)
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  const remove = async (note: Note) => {
    try {
      await notesApi.remove(trip.id, note.id)
      setDeleting(null)
      notes.reload()
    } catch (error) {
      showError(error)
    }
  }

  const hasTemplate = list.some((n) => n.templateKey?.startsWith('nz.'))

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('prep.notes.title')}
        lead={t('prep.notes.lead')}
        actions={
          <Row>
            {editable && !hasTemplate && (
              <Button variant="primary" disabled={applying} onClick={applyTemplate}>
                {t('prep.notes.template.button')}
              </Button>
            )}
            <ButtonLink to=".." relative="path" variant="ghost">
              {t('prep.back')}
            </ButtonLink>
          </Row>
        }
      />

      {hasTemplate && (
        <Notice $tone="warning" role="note">
          <p>{t('prep.notes.disclaimer')}</p>
        </Notice>
      )}

      {notes.status === 'loading' && <Skeleton $height={200} />}
      {notes.status === 'error' && (
        <EmptyState
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={notes.reload}>
              {t('error.retry')}
            </Button>
          }
        />
      )}
      {notes.status === 'ready' && list.length === 0 && (
        <EmptyState
          title={t('prep.notes.empty.title')}
          body={t('prep.notes.empty.body')}
          action={
            editable ? (
              <Button variant="primary" disabled={applying} onClick={applyTemplate}>
                {t('prep.notes.template.button')}
              </Button>
            ) : undefined
          }
        />
      )}

      {list.map((note) =>
        editing === note.id ? (
          <NoteEditor
            key={note.id}
            note={note}
            onCancel={() => setEditing(null)}
            onSave={async (patch) => {
              if (await save(note, patch)) {
                setEditing(null)
                toast.show(t('prep.notes.saved'))
              }
            }}
          />
        ) : (
          <Panel key={note.id} aria-label={note.title} data-note={note.templateKey ?? note.id}>
            <PanelHead>
              <PanelTitle>{note.title}</PanelTitle>
              <Row>
                {note.shareable && <Shared>{t('prep.notes.sharedBadge')}</Shared>}
                {editable && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(note.id)}>
                    {t('prep.notes.edit')}
                  </Button>
                )}
              </Row>
            </PanelHead>
            {note.body.trim() ? <NoteBody body={note.body} /> : <Muted>{t('prep.notes.emptyBody')}</Muted>}
            {editable && (
              <Row>
                <Switch>
                  <input
                    type="checkbox"
                    checked={note.shareable}
                    onChange={(event) => void save(note, { shareable: event.target.checked })}
                  />
                  {t('prep.notes.shareable')}
                </Switch>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(note)}>
                  {t('prep.notes.delete')}
                </Button>
              </Row>
            )}
          </Panel>
        ),
      )}

      {editable && notes.status === 'ready' && (
        <div>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('prep.notes.add')}
          </Button>
        </div>
      )}

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={async (title) => {
          try {
            const res = await notesApi.create(trip.id, { title })
            setAdding(false)
            notes.reload()
            setEditing(res.note.id)
          } catch (error) {
            showError(error)
          }
        }}
      />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('prep.notes.delete')}
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
        {deleting && <p>{t('prep.notes.deleteConfirm', { title: deleting.title })}</p>}
      </Dialog>
    </Stack>
  )
}

function NoteEditor({
  note,
  onCancel,
  onSave,
}: {
  note: Note
  onCancel: () => void
  onSave: (patch: { title: string; body: string; shareable: boolean }) => Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [shareable, setShareable] = useState(note.shareable)
  const [busy, setBusy] = useState(false)
  return (
    <Panel aria-label={t('prep.notes.editing', { title: note.title })} data-note-editor={note.id}>
      <Input
        label={t('prep.notes.titleField')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Label>
        {t('prep.notes.body')}
        <Textarea
          value={body}
          maxLength={20_000}
          onChange={(event) => setBody(event.target.value)}
        />
      </Label>
      <Muted>{t('prep.notes.bodyHint')}</Muted>
      <Switch>
        <input
          type="checkbox"
          checked={shareable}
          onChange={(event) => setShareable(event.target.checked)}
        />
        {t('prep.notes.shareable')}
      </Switch>
      <Muted>{t('prep.notes.shareableHint')}</Muted>
      <Row>
        <Button
          variant="primary"
          disabled={busy || !title.trim()}
          onClick={async () => {
            setBusy(true)
            await onSave({ title: title.trim(), body, shareable })
            setBusy(false)
          }}
        >
          {t('prep.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('prep.cancel')}
        </Button>
      </Row>
    </Panel>
  )
}

function AddDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (title: string) => Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('prep.notes.add')}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('prep.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={async () => {
              await onCreate(title.trim())
              setTitle('')
            }}
          >
            {t('prep.notes.create')}
          </Button>
        </>
      }
    >
      <Input
        label={t('prep.notes.titleField')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
    </Dialog>
  )
}
