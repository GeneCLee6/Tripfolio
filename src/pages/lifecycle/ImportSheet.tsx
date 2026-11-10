import { useState } from 'react'
import styled from 'styled-components'
import type { Trip } from '../../../shared/api/types.ts'
import { formatDateRange } from '../../../shared/i18n/format.ts'
import {
  Button,
  ColorSwatches,
  DateField,
  Input,
  Select,
  Sheet,
  useToast,
} from '../../components/index.ts'
import { isApiError } from '../../lib/api.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useT } from '../../lib/i18n.ts'
import { lifecycleApi, type ImportBody } from '../../lib/lifecycle/api.ts'
import { parseImportFile, shiftedEndDate, type ImportParse } from '../../lib/lifecycle/files.ts'
import { color, dayColors, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'
import { ErrorText, Muted } from './parts.tsx'

// Trip list → 匯入旅程檔 (e8-t03). Pick a .json export, see what is in it (name, dates, counts),
// say who you are (a new owner, or one of the file's members), optionally rename it or move it to
// a new start date, then POST /api/import. The new owner token is stored and the app opens the
// trip. A 422 shows the server's message, which names the field path that failed.

const Facts = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: ${space.xs}px ${space.lg}px;
  margin: 0;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  font-size: ${fontSize.sm}px;
  dt {
    color: ${color.muted};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
`

const SummaryTitle = styled.p`
  margin: 0;
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

export function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: (trip: Trip) => void }) {
  const t = useT()
  const toast = useToast()
  const [parsed, setParsed] = useState<ImportParse | null>(null)
  const [readError, setReadError] = useState(false)
  const [you, setYou] = useState('')
  const [youColor, setYouColor] = useState<string>(dayColors[0])
  const [asMember, setAsMember] = useState('')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [youError, setYouError] = useState<string | undefined>()
  const [serverError, setServerError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    setServerError(null)
    setReadError(false)
    setParsed(null)
    if (!file) return
    try {
      const text = await file.text()
      const result = parseImportFile(text, file.size)
      setParsed(result)
      if (result.ok) {
        setStartDate(result.summary.startDate)
        setAsMember('')
      }
    } catch {
      setReadError(true)
    }
  }

  async function submit() {
    if (!parsed?.ok) return
    if (!you.trim()) {
      setYouError(t('lifecycle.import.nameRequired'))
      return
    }
    setBusy(true)
    setServerError(null)
    const body: ImportBody = {
      ...parsed.file,
      owner: { name: you.trim(), color: youColor },
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(startDate && startDate !== parsed.summary.startDate ? { startDate } : {}),
      ...(asMember ? { asMember: Number(asMember) } : {}),
    }
    try {
      const response = await lifecycleApi.importTrip(body)
      toast.show(t('lifecycle.import.done', { name: response.trip.name }), { tone: 'success' })
      onDone(response.trip)
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        setServerError(t('lifecycle.import.rejected', { message: error.message }))
      } else if (isApiError(error) && error.status === 413) {
        setServerError(t('lifecycle.import.tooLargeServer'))
      } else {
        const { key, code } = errorMessageKey(error)
        setServerError(t(key, { code }))
      }
      setBusy(false)
    }
  }

  const summary = parsed?.ok ? parsed.summary : null
  const endDate = summary ? shiftedEndDate(summary.startDate, summary.endDate, startDate) : ''
  const fileError = readError
    ? t('lifecycle.import.problem.read')
    : parsed && !parsed.ok
      ? t(`lifecycle.import.problem.${parsed.problem}`)
      : undefined

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('lifecycle.import.title')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !summary}>
            {busy ? t('lifecycle.import.working') : t('lifecycle.import.submit')}
          </Button>
        </>
      }
    >
      <Stack $gap="lg">
        <Muted>{t('lifecycle.import.body')}</Muted>
        <Input
          type="file"
          accept=".json,application/json"
          label={t('lifecycle.import.file')}
          error={fileError}
          onChange={(event) => void pick(event.target.files?.[0])}
        />
        {summary && (
          <Stack $gap="sm" as="section" aria-label={t('lifecycle.import.summary')}>
            <SummaryTitle>
              {summary.name}
              {summary.destination ? ` · ${summary.destination}` : ''}
            </SummaryTitle>
            <Facts>
              <dt>{t('lifecycle.import.fact.dates')}</dt>
              <dd>{formatDateRange(summary.startDate, summary.endDate, t.locale)}</dd>
              <dt>{t('lifecycle.import.fact.days')}</dt>
              <dd>{summary.days}</dd>
              <dt>{t('lifecycle.import.fact.stops')}</dt>
              <dd>{summary.stops}</dd>
              <dt>{t('lifecycle.import.fact.places')}</dt>
              <dd>{summary.places}</dd>
              <dt>{t('lifecycle.import.fact.lodgings')}</dt>
              <dd>{summary.lodgings}</dd>
              <dt>{t('lifecycle.import.fact.bookings')}</dt>
              <dd>{summary.bookings}</dd>
              <dt>{t('lifecycle.import.fact.wishlist')}</dt>
              <dd>{summary.wishlist}</dd>
              <dt>{t('lifecycle.import.fact.members')}</dt>
              <dd>{summary.members.length}</dd>
              <dt>{t('lifecycle.import.fact.expenses')}</dt>
              <dd>{summary.expenses ?? t('lifecycle.import.notIncluded')}</dd>
              <dt>{t('lifecycle.import.fact.photos')}</dt>
              <dd>{summary.photos ?? t('lifecycle.import.notIncluded')}</dd>
            </Facts>
          </Stack>
        )}
        {summary && (
          <>
            <Input
              label={t('lifecycle.import.you')}
              value={you}
              maxLength={60}
              required
              autoComplete="nickname"
              error={youError}
              onChange={(event) => {
                setYou(event.target.value)
                setYouError(undefined)
              }}
            />
            <ColorSwatches
              label={t('lifecycle.import.youColor')}
              value={youColor}
              onChange={setYouColor}
            />
            {summary.members.length > 0 && (
              <Select
                label={t('lifecycle.import.asMember')}
                hint={t('lifecycle.import.asMemberHint')}
                optional
                value={asMember}
                onChange={(event) => setAsMember(event.target.value)}
              >
                <option value="">{t('lifecycle.import.asMemberNone')}</option>
                {summary.members.map((member) => (
                  <option key={member.id} value={String(member.id)}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
            <Input
              label={t('lifecycle.import.name')}
              hint={t('lifecycle.import.nameHint')}
              placeholder={summary.name}
              optional
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <DateField
              label={t('lifecycle.import.startDate')}
              hint={`${t('lifecycle.import.startDateHint')} ${formatDateRange(
                startDate || summary.startDate,
                endDate,
                t.locale,
              )}`}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </>
        )}
        {serverError && <ErrorText role="alert">{serverError}</ErrorText>}
      </Stack>
    </Sheet>
  )
}
