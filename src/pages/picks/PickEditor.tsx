import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import type { OgResponse } from '../../../shared/api/geo.ts'
import type { Member, Place, Trip, WishlistItemView } from '../../../shared/api/types.ts'
import { isCurrencyCode, type CurrencyCode } from '../../../shared/money/currencies.ts'
import type { WishlistCategory, WishlistStatus } from '../../../shared/schema/index.ts'
import {
  Button,
  Dialog,
  Input,
  MoneyField,
  PlacePicker,
  SegmentedControl,
  Select,
  type PlacePick,
} from '../../components/index.ts'
import { TrashIcon } from '../../components/icons.tsx'
import { controlBox } from '../../components/styles.ts'
import { wishlistApi } from '../../lib/api.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useT } from '../../lib/i18n.ts'
import { CATEGORY_LABEL } from '../../lib/picks/labels.ts'
import { placeName } from '../../lib/itinerary/places.ts'
import {
  isHttpUrl,
  PICK_CATEGORIES,
  priceCurrencies,
  statusChoices,
} from '../../lib/picks/picks.ts'
import { usePickImage } from '../../lib/picks/photo.ts'
import type { PicksStore } from '../../lib/picks/store.ts'
import { UploadRejected, uploadAttachment } from '../../lib/upload/upload.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { STATUS_LABEL } from './labels.ts'

// The pick form (e5-t02): in the detail pane on desktop, a Sheet below (the trip layout decides).
// Pasting a source link asks the Worker for the page's og:title / og:image (POST /og): the title
// fills an empty name, and 「用這張圖」 keeps the image as the card's picture. A photo goes through
// the media pipeline (src/lib/upload) and is stored as photoAttachmentId.

const Form = styled.form`
  display: grid;
  gap: ${space.lg}px;
`

const Group = styled.fieldset`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  > legend {
    padding: 0;
    margin-bottom: ${space.xs}px;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
  }
`

const Scroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
  padding: 2px;
`

const Box = styled.div`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
  min-width: 0;
`

const Strong = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Muted = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const Preview = styled.img`
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border-radius: ${radius.control - 2}px;
  background: ${color.line};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  align-items: center;
`

const Label = styled.label`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Textarea = styled.textarea`
  ${controlBox}
  min-height: 88px;
  padding: ${space.sm}px ${space.md}px;
  resize: vertical;
  font: inherit;
`

const FileInput = styled.input`
  font-size: ${fontSize.sm}px;
  max-width: 100%;
`

const Hint = styled.p<{ $error?: boolean }>`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $error }) => ($error ? color.danger : color.muted)};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  justify-content: space-between;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
`

export interface PickEditorProps {
  trip: Trip
  me: Member
  members: readonly Member[]
  /** null: a new pick */
  item: WishlistItemView | null
  places: readonly Place[]
  store: PicksStore
  onSaved: (item: WishlistItemView) => void
  onDeleted: (name: string) => void
  onClose: () => void
}

type OgState =
  | { kind: 'idle' }
  | { kind: 'loading'; url: string }
  | { kind: 'ready'; url: string; og: OgResponse }
  | { kind: 'failed'; url: string }

type PhotoState =
  | { kind: 'idle' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'failed'; message: string }

export function PickEditor({
  trip,
  me,
  members,
  item,
  places,
  store,
  onSaved,
  onDeleted,
  onClose,
}: PickEditorProps) {
  const t = useT()
  const showError = useApiErrorToast()
  const noteId = useId()
  const photoId = useId()
  const currencies = priceCurrencies(trip, item?.currency ?? null)
  const [category, setCategory] = useState<WishlistCategory>(item?.category ?? 'eat')
  const [name, setName] = useState(item?.name ?? '')
  const [placeId, setPlaceId] = useState<string | null>(item?.placeId ?? null)
  const [known, setKnown] = useState<readonly Place[]>(places)
  const [picking, setPicking] = useState(false)
  const [manual, setManual] = useState(false)
  const [estMinor, setEstMinor] = useState<number | null>(item?.estMinor ?? null)
  const [currency, setCurrency] = useState<CurrencyCode>(
    (item?.currency && isCurrencyCode(item.currency) ? item.currency : currencies[0]) ?? 'AUD',
  )
  const [sourceUrl, setSourceUrl] = useState(item?.sourceUrl ?? '')
  const [sourceTitle, setSourceTitle] = useState<string | null>(item?.sourceTitle ?? null)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(item?.sourceImageUrl ?? null)
  const [recommender, setRecommender] = useState<string>(
    item ? (item.recommenderMemberId ?? '') : me.id,
  )
  const [note, setNote] = useState(item?.note ?? '')
  const [photoAttachmentId, setPhotoAttachmentId] = useState<string | null>(
    item?.photoAttachmentId ?? null,
  )
  const [localPhoto, setLocalPhoto] = useState<string | null>(null)
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'idle' })
  const [status, setStatus] = useState<WishlistStatus>(item?.status ?? 'wish')
  const [og, setOg] = useState<OgState>({ kind: 'idle' })
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ogAbort = useRef<AbortController | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const storedPhoto = usePickImage(
    trip.id,
    { photoAttachmentId, sourceImageUrl: null },
    'thumb',
  )

  useEffect(
    () => () => {
      ogAbort.current?.abort()
      uploadAbort.current?.abort()
    },
    [],
  )
  useEffect(
    () => () => {
      if (localPhoto) URL.revokeObjectURL(localPhoto)
    },
    [localPhoto],
  )

  const place = placeId ? known.find((other) => other.id === placeId) : undefined
  const nameMissing = name.trim() === ''
  const urlInvalid = sourceUrl.trim() !== '' && !isHttpUrl(sourceUrl)
  const bias =
    trip.centerLat !== null && trip.centerLng !== null
      ? { lat: trip.centerLat, lng: trip.centerLng }
      : null

  const fetchPreview = () => {
    const url = sourceUrl.trim()
    if (!isHttpUrl(url)) return
    if (og.kind !== 'idle' && og.url === url) return
    if (og.kind === 'idle' && item?.sourceUrl === url) return
    ogAbort.current?.abort()
    const controller = new AbortController()
    ogAbort.current = controller
    setOg({ kind: 'loading', url })
    wishlistApi.og(trip.id, url, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setOg({ kind: 'ready', url, og: result })
        setSourceTitle(result.title)
        if (result.title) setName((current) => (current.trim() ? current : result.title!.slice(0, 200)))
      },
      () => {
        if (!controller.signal.aborted) setOg({ kind: 'failed', url })
      },
    )
  }

  const pickPlace = (pick: PlacePick) => {
    if (pick.manual) {
      setManual(true)
      return
    }
    setManual(false)
    setKnown((list) => (list.some((other) => other.id === pick.placeId) ? list : [...list, pick.place]))
    setPlaceId(pick.placeId)
    setPicking(false)
  }

  const choosePhoto = async (file: File) => {
    uploadAbort.current?.abort()
    const controller = new AbortController()
    uploadAbort.current = controller
    setPhoto({ kind: 'uploading', percent: 0 })
    try {
      const attachment = await uploadAttachment(trip.id, file, {
        kind: 'photo',
        wishlistItemId: item?.id ?? null,
        signal: controller.signal,
        onProgress: ({ loaded, total }) =>
          setPhoto({ kind: 'uploading', percent: total ? Math.round((loaded / total) * 100) : 0 }),
      })
      setPhotoAttachmentId(attachment.id)
      setLocalPhoto(URL.createObjectURL(file))
      setPhoto({ kind: 'idle' })
    } catch (error) {
      if (controller.signal.aborted) return
      let message: string
      if (error instanceof UploadRejected) {
        message = t(error.code === 'too_large' ? 'picks.editor.photoTooLarge' : 'picks.editor.photoUnsupported')
      } else if (error instanceof Error && !('status' in error)) {
        message = t('picks.editor.photoUnreadable')
      } else {
        const { key, code } = errorMessageKey(error)
        message = t(key, { code })
      }
      setPhoto({ kind: 'failed', message })
    }
  }

  const submit = async () => {
    if (nameMissing || urlInvalid || photo.kind === 'uploading') {
      setShowErrors(true)
      return
    }
    const url = sourceUrl.trim()
    const body = {
      category,
      name: name.trim(),
      placeId,
      photoAttachmentId,
      estMinor,
      currency: estMinor === null ? null : currency,
      sourceUrl: url || null,
      sourceTitle: url ? sourceTitle : null,
      sourceImageUrl,
      recommenderMemberId: recommender || null,
      note,
    }
    setSaving(true)
    try {
      const saved = item
        ? await store.patch(item.id, status !== item.status ? { ...body, status } : body)
        : await store.create(body)
      onSaved(saved)
      onClose()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  const shownPhoto = localPhoto ?? storedPhoto
  const ogImage = og.kind === 'ready' ? og.og.imageUrl : null

  return (
    <Form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Group>
        <legend>{t('picks.editor.category')}</legend>
        <Scroll>
          <SegmentedControl
            label={t('picks.editor.category')}
            size="sm"
            value={category}
            onChange={setCategory}
            options={PICK_CATEGORIES.map((value) => ({ value, label: t(CATEGORY_LABEL[value]) }))}
          />
        </Scroll>
      </Group>

      <Input
        label={t('picks.editor.source')}
        type="url"
        inputMode="url"
        placeholder={t('picks.editor.sourcePlaceholder')}
        hint={t('picks.editor.sourceHint')}
        value={sourceUrl}
        error={showErrors && urlInvalid ? t('picks.editor.sourceInvalid') : undefined}
        onChange={(event) => setSourceUrl(event.target.value)}
        onBlur={fetchPreview}
      />
      {og.kind === 'loading' && <Hint aria-live="polite">{t('picks.editor.ogLoading')}</Hint>}
      {og.kind === 'failed' && <Hint aria-live="polite">{t('picks.editor.ogFailed')}</Hint>}
      {og.kind === 'ready' && (og.og.title || ogImage) && (
        <Box data-testid="og-preview">
          {ogImage && (
            <Preview src={ogImage} alt={t('picks.editor.ogImageAlt')} referrerPolicy="no-referrer" />
          )}
          {og.og.title && <Strong>{og.og.title}</Strong>}
          {og.og.siteName && <Muted>{og.og.siteName}</Muted>}
          {ogImage && (
            <Row>
              {sourceImageUrl === ogImage ? (
                <Muted>{t('picks.editor.ogImageUsed')}</Muted>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setSourceImageUrl(ogImage)}>
                  {t('picks.editor.ogUseImage')}
                </Button>
              )}
            </Row>
          )}
        </Box>
      )}
      {sourceImageUrl && sourceImageUrl !== ogImage && (
        <Box>
          <Preview src={sourceImageUrl} alt={t('picks.editor.ogImageAlt')} referrerPolicy="no-referrer" />
          <Row>
            <Button size="sm" variant="ghost" onClick={() => setSourceImageUrl(null)}>
              {t('picks.editor.removeImage')}
            </Button>
          </Row>
        </Box>
      )}

      <Input
        label={t('picks.editor.name')}
        placeholder={t('picks.editor.namePlaceholder')}
        value={name}
        maxLength={200}
        error={showErrors && nameMissing ? t('picks.editor.nameRequired') : undefined}
        onChange={(event) => setName(event.target.value)}
      />

      <Group>
        <legend>{t('picks.editor.place')}</legend>
        {place && !picking ? (
          <Box>
            <Strong>{placeName(place, t.locale)}</Strong>
            {place.address && <Muted>{place.address}</Muted>}
            <Row>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                {t('picks.editor.changePlace')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlaceId(null)}>
                {t('picks.editor.removePlace')}
              </Button>
            </Row>
          </Box>
        ) : (
          <>
            <PlacePicker
              tripId={trip.id}
              places={known}
              bias={bias}
              onPick={pickPlace}
              onPlaceCreated={(created) => store.addPlace(created)}
            />
            <Hint>{t('picks.editor.placeHint')}</Hint>
          </>
        )}
        {manual && <Hint role="status">{t('picks.editor.manualPin')}</Hint>}
      </Group>

      <MoneyField
        label={t('picks.editor.price')}
        optional
        value={estMinor}
        currency={currency}
        currencies={currencies}
        onChange={setEstMinor}
        onCurrencyChange={setCurrency}
      />

      <Select
        label={t('picks.editor.recommender')}
        value={recommender}
        onChange={(event) => setRecommender(event.target.value)}
      >
        <option value="">{t('picks.editor.recommenderNone')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>

      <Group>
        <Label htmlFor={photoId}>{t('picks.editor.photo')}</Label>
        {shownPhoto && <Preview src={shownPhoto} alt={t('picks.editor.photoAlt')} />}
        <FileInput
          id={photoId}
          type="file"
          accept="image/*"
          disabled={photo.kind === 'uploading'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void choosePhoto(file)
          }}
        />
        {photo.kind === 'uploading' && (
          <Hint aria-live="polite">{t('picks.editor.photoUploading', { percent: photo.percent })}</Hint>
        )}
        {photo.kind === 'failed' && (
          <Hint role="alert" $error>
            {photo.message}
          </Hint>
        )}
        {photoAttachmentId && photo.kind !== 'uploading' && (
          <Row>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPhotoAttachmentId(null)
                setLocalPhoto(null)
              }}
            >
              {t('picks.editor.photoRemove')}
            </Button>
          </Row>
        )}
      </Group>

      <Group>
        <Label htmlFor={noteId}>{t('picks.editor.note')}</Label>
        <Textarea
          id={noteId}
          maxLength={5000}
          placeholder={t('picks.editor.notePlaceholder')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Group>

      {item && (
        <Group>
          <legend>{t('picks.editor.status')}</legend>
          <SegmentedControl
            label={t('picks.editor.status')}
            size="sm"
            value={status}
            onChange={setStatus}
            options={statusChoices(item).map((value) => ({ value, label: t(STATUS_LABEL[value]) }))}
          />
          {item.status === 'scheduled' && <Hint>{t('picks.editor.statusScheduledHint')}</Hint>}
        </Group>
      )}

      {showErrors && (nameMissing || urlInvalid) && (
        <Hint role="alert" $error>
          {t('picks.editor.invalid')}
        </Hint>
      )}

      <Actions>
        {item ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <TrashIcon size={16} />
            {t('picks.action.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Row>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={saving || photo.kind === 'uploading'}>
            {t('common.save')}
          </Button>
        </Row>
      </Actions>

      {item && (
        <Dialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={t('picks.delete.title', { name: item.name })}
          actions={
            <>
              <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  setConfirmDelete(false)
                  try {
                    await store.remove(item.id)
                    onDeleted(item.name)
                    onClose()
                  } catch (error) {
                    showError(error)
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p>{t('picks.delete.body')}</p>
        </Dialog>
      )}
    </Form>
  )
}
