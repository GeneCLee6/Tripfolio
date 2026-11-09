import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react'
import styled, { css } from 'styled-components'
import type { Attachment } from '../../shared/api/media.ts'
import type { AttachmentKind } from '../../shared/schema/attachment.ts'
import { useMediaQuery } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { useCan } from '../lib/role.ts'
import { createLimiter } from '../lib/upload/limiter.ts'
import {
  ACTIVE,
  describeUploadError,
  isAbort,
  isHeic,
  itemFraction,
  overallProgress,
  phaseText,
  readUseLocation,
  UPLOAD_CONCURRENCY,
  writeUseLocation,
  type ItemStatus,
  type UploadItem,
} from '../lib/upload/queue-items.ts'
import { uploadAttachment, uploadQueue, type UploadProgress } from '../lib/upload/upload.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'

// The photo uploader (e6-t02, AC-6.1): pick several photos, drop them, or (on touch screens) take
// one with the camera; each file goes through src/lib/upload (EXIF → 2048/400 WebP → sign → PUT
// with progress → complete) with at most three in flight in total, and shows its own phase,
// progress, cancel and retry. Rejections (too large, not an image, HEIC the browser cannot decode)
// are explained inline. Hidden for people who cannot edit (useCan).

// ---------------------------------------------------------------------------------------------
// Styles

const Root = styled.section`
  display: grid;
  gap: ${space.md}px;
  min-width: 0;
`

const Drop = styled.div<{ $active: boolean }>`
  display: grid;
  justify-items: center;
  gap: ${space.sm}px;
  padding: ${space.xl}px ${space.lg}px;
  border: 2px dashed ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  text-align: center;
  ${({ $active }) =>
    $active &&
    css`
      border-color: ${color.fjord};
      background: ${color.glacier};
    `}
`

const DropTitle = styled.p`
  margin: 0;
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  font-weight: ${fontWeight.semibold};
  color: ${color.ink};
  > svg {
    color: ${color.fjord};
  }
`

const Buttons = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: ${space.sm}px;
`

const Small = styled.p`
  margin: 0;
  max-width: 56ch;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Switch = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 ${space.sm}px;
  align-items: start;
  font-size: ${fontSize.body}px;
  cursor: pointer;
  input {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: ${color.fjord};
  }
  ${Small} {
    grid-column: 2;
  }
`

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li<{ $failed: boolean }>`
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space.xs}px ${space.md}px;
  padding: ${space.sm}px;
  border: 1px solid ${({ $failed }) => ($failed ? color.danger : color.line)};
  border-radius: ${radius.control}px;
  background: ${color.card};
`

const Preview = styled.span`
  grid-row: span 2;
  width: 48px;
  height: 48px;
  border-radius: ${radius.control - 4}px;
  background: ${color.paper};
  overflow: hidden;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`

const Name = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${fontSize.sm}px;
`

const Phase = styled.span<{ $tone: 'muted' | 'success' | 'danger' }>`
  grid-column: 2;
  font-size: ${fontSize.sm}px;
  color: ${({ $tone }) =>
    $tone === 'success' ? color.success : $tone === 'danger' ? color.danger : color.muted};
  font-variant-numeric: tabular-nums;
`

const RowActions = styled.span`
  grid-row: span 2;
  display: flex;
  align-items: center;
  gap: ${space.xs}px;
`

const Bar = styled.span`
  grid-column: 2;
  display: block;
  height: 4px;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  overflow: hidden;
  > span {
    display: block;
    height: 100%;
    background: ${color.fjord};
  }
`

const Summary = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  font-variant-numeric: tabular-nums;
`

const QueueTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.semibold};
  color: ${color.ink};
`

const LinkButton = styled.button`
  border: 0;
  background: none;
  padding: ${space.xs}px;
  color: ${color.fjord};
  font: inherit;
  cursor: pointer;
  ${focusRing}
  @media ${media.coarse} {
    min-height: 44px;
  }
`

const UploadIcon = () => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
)

// ---------------------------------------------------------------------------------------------
// The queue

export interface UploadListProps {
  items: readonly UploadItem[]
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
  onCancelAll: () => void
  onClear: () => void
}

/** The queue: one row per file, and the overall progress */
export function UploadList({
  items,
  onRetry,
  onCancel,
  onDismiss,
  onCancelAll,
  onClear,
}: UploadListProps) {
  const t = useT()
  const headingId = useId()
  const overall = overallProgress(items)
  const anyActive = items.some((item) => ACTIVE.has(item.status))
  const anyFinished = items.some((item) => item.status === 'done' || item.status === 'cancelled')
  return (
    <Root aria-labelledby={headingId}>
      <Summary>
        <QueueTitle id={headingId}>{t('photos.upload.queue')}</QueueTitle>
        <span role="status" aria-live="polite">
          {t('photos.upload.overall', overall)}
        </span>
        <span>
          {anyActive && (
            <LinkButton type="button" onClick={onCancelAll}>
              {t('photos.upload.cancelAll')}
            </LinkButton>
          )}
          {anyFinished && (
            <LinkButton type="button" onClick={onClear}>
              {t('photos.upload.clear')}
            </LinkButton>
          )}
        </span>
      </Summary>
      <List>
        {items.map((item) => {
          const active = ACTIVE.has(item.status)
          const failed = item.status === 'failed'
          const fraction = itemFraction(item)
          return (
            <Row key={item.id} $failed={failed} data-status={item.status}>
              <Preview>{item.previewUrl && <img src={item.previewUrl} alt="" />}</Preview>
              <Name title={item.name}>{item.name}</Name>
              <RowActions>
                {(failed ? item.error?.retryable !== false : item.status === 'cancelled') && (
                  <Button size="sm" onClick={() => onRetry(item.id)} aria-label={t('photos.upload.retryLabel', { name: item.name })}>
                    {t('photos.upload.retry')}
                  </Button>
                )}
                {active ? (
                  <IconButton
                    size="sm"
                    icon={<CloseIcon size={16} />}
                    label={t('photos.upload.cancelLabel', { name: item.name })}
                    onClick={() => onCancel(item.id)}
                  />
                ) : (
                  <IconButton
                    size="sm"
                    icon={<CloseIcon size={16} />}
                    label={t('photos.upload.dismissLabel', { name: item.name })}
                    onClick={() => onDismiss(item.id)}
                  />
                )}
              </RowActions>
              <Phase
                $tone={item.status === 'done' ? 'success' : failed ? 'danger' : 'muted'}
                role={failed ? 'alert' : undefined}
              >
                {failed && item.error
                  ? `${t('photos.upload.phase.failed')} · ${t(item.error.key, { code: item.error.code ?? '' })}`
                  : phaseText(t, item)}
              </Phase>
              {active && (
                <Bar
                  role="progressbar"
                  aria-label={item.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(fraction * 100)}
                >
                  <span style={{ width: `${Math.round(fraction * 100)}%` }} />
                </Bar>
              )}
            </Row>
          )
        })}
      </List>
    </Root>
  )
}

// ---------------------------------------------------------------------------------------------
// The uploader

export interface PhotoUploaderProps {
  tripId: string
  kind?: AttachmentKind
  dayId?: string | null
  stopId?: string | null
  /** Called as each file finishes, with the ready attachment(s) */
  onUploaded?: (attachments: Attachment[]) => void
}

interface Pending {
  file: File
  controller: AbortController
}

const statusOf = (progress: UploadProgress): ItemStatus => progress.phase

export function PhotoUploader({ tripId, kind = 'photo', dayId, stopId, onUploaded }: PhotoUploaderProps) {
  const t = useT()
  const can = useCan()
  const touch = useMediaQuery(media.coarse)
  const switchId = useId()
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [useLocation, setUseLocation] = useState(readUseLocation)
  const [limiter] = useState(() => createLimiter(UPLOAD_CONCURRENCY))
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const files = useRef(new Map<string, Pending>())
  const previews = useRef(new Map<string, string>())
  const nextId = useRef(0)
  const latest = useRef({ onUploaded, useLocation, tripId, kind, dayId, stopId })
  useEffect(() => {
    latest.current = { onUploaded, useLocation, tripId, kind, dayId, stopId }
  })

  // Leaving the page cancels what is still running and frees the previews
  useEffect(() => {
    const pending = files.current
    const urls = previews.current
    return () => {
      for (const { controller } of pending.values()) controller.abort()
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }, [])

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const forget = useCallback((ids: readonly string[]) => {
    for (const id of ids) {
      files.current.get(id)?.controller.abort()
      files.current.delete(id)
      const url = previews.current.get(id)
      if (url) URL.revokeObjectURL(url)
      previews.current.delete(id)
    }
    setItems((prev) => prev.filter((item) => !ids.includes(item.id)))
  }, [])

  /** Runs one file once a slot is free; never throws */
  const runOne = useCallback(
    async (id: string): Promise<void> => {
      const pending = files.current.get(id)
      if (!pending || pending.controller.signal.aborted) return
      const { file, controller } = pending
      const options = latest.current
      update(id, { status: 'preparing', loaded: 0, total: 0, error: null })
      try {
        const attachment = await uploadAttachment(options.tripId, file, {
          kind: options.kind,
          usePhotoLocation: options.useLocation,
          dayId: options.dayId ?? null,
          stopId: options.stopId ?? null,
          signal: controller.signal,
          onProgress: (progress) =>
            update(id, {
              status: statusOf(progress),
              loaded: progress.loaded,
              total: progress.total,
            }),
        })
        update(id, { status: 'done' })
        latest.current.onUploaded?.([attachment])
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) update(id, { status: 'cancelled' })
        else update(id, { status: 'failed', error: describeUploadError(error, file) })
      }
    },
    [update],
  )

  const enqueue = useCallback(
    (ids: readonly string[]) => {
      void uploadQueue(ids, (id) => limiter.run(() => runOne(id)), {
        concurrency: UPLOAD_CONCURRENCY,
      })
    },
    [limiter, runOne],
  )

  const start = useCallback(
    (picked: readonly File[]) => {
      if (picked.length === 0) return
      const fresh: UploadItem[] = picked.map((file) => {
        const id = `u${++nextId.current}`
        files.current.set(id, { file, controller: new AbortController() })
        let previewUrl: string | null = null
        if (file.type.startsWith('image/') && !isHeic(file)) {
          previewUrl = URL.createObjectURL(file)
          previews.current.set(id, previewUrl)
        }
        return { id, name: file.name, previewUrl, status: 'queued', loaded: 0, total: 0, error: null }
      })
      setItems((prev) => [...prev, ...fresh])
      enqueue(fresh.map((item) => item.id))
    },
    [enqueue],
  )

  const retry = useCallback(
    (id: string) => {
      const pending = files.current.get(id)
      if (!pending) return
      files.current.set(id, { file: pending.file, controller: new AbortController() })
      update(id, { status: 'queued', loaded: 0, total: 0, error: null })
      enqueue([id])
    },
    [enqueue, update],
  )

  const cancel = useCallback((id: string) => {
    files.current.get(id)?.controller.abort()
    // A queued file has no running upload to report back: mark it here
    setItems((prev) =>
      prev.map((item) => (item.id === id && item.status === 'queued' ? { ...item, status: 'cancelled' } : item)),
    )
  }, [])

  if (!can('editContent')) return null

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    start(Array.from(event.dataTransfer.files))
  }
  const onInput = (input: HTMLInputElement | null) => {
    if (!input?.files) return
    start(Array.from(input.files))
    // Lets the same file be picked again after a failure
    input.value = ''
  }

  return (
    <Root aria-label={t('photos.upload.title')}>
      <Drop
        $active={dragging}
        data-dragging={dragging || undefined}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={onDrop}
      >
        <DropTitle>
          <UploadIcon />
          {dragging ? t('photos.upload.dropActive') : t('photos.upload.drop')}
        </DropTitle>
        <Buttons>
          <Button variant="primary" onClick={() => pick.current?.click()}>
            {t('photos.upload.choose')}
          </Button>
          {touch && (
            <Button onClick={() => camera.current?.click()}>{t('photos.upload.camera')}</Button>
          )}
        </Buttons>
        <Small>{t('photos.upload.note')}</Small>
        <input
          ref={pick}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="photo-input"
          onChange={(event) => onInput(event.currentTarget)}
        />
        {touch && (
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => onInput(event.currentTarget)}
          />
        )}
      </Drop>
      {kind === 'photo' && (
        <Switch htmlFor={switchId}>
          <input
            id={switchId}
            type="checkbox"
            checked={useLocation}
            onChange={(event) => {
              setUseLocation(event.currentTarget.checked)
              writeUseLocation(event.currentTarget.checked)
            }}
          />
          <span>{t('photos.upload.useLocation')}</span>
          <Small>{t('photos.upload.useLocationHint')}</Small>
        </Switch>
      )}
      {items.length > 0 && (
        <UploadList
          items={items}
          onRetry={retry}
          onCancel={cancel}
          onDismiss={(id) => forget([id])}
          onCancelAll={() => {
            for (const item of items) if (ACTIVE.has(item.status)) cancel(item.id)
          }}
          onClear={() =>
            forget(
              items
                .filter((item) => item.status === 'done' || item.status === 'cancelled')
                .map((item) => item.id),
            )
          }
        />
      )}
    </Root>
  )
}
