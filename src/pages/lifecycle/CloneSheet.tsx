import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Trip } from '../../../shared/api/types.ts'
import { formatDateRange } from '../../../shared/i18n/format.ts'
import { Button, DateField, Input, Sheet, useToast } from '../../components/index.ts'
import { tripPath } from '../../app/sections.ts'
import { useT } from '../../lib/i18n.ts'
import { lifecycleApi } from '../../lib/lifecycle/api.ts'
import { shiftedEndDate } from '../../lib/lifecycle/files.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { Stack } from '../parts.tsx'
import { CheckOption, Muted, Options } from './parts.tsx'

// Settings → 旅程檔案 → 複製為範本 (e1-t07). POST /clone with a name, a new start date (every date
// moves with it) and what to keep; members, expenses and photos are cleared by default. Expenses
// need the members, so ticking expenses ticks members too. The copy's owner token is stored and the
// app opens the new trip. Mounted while open, so every opening starts from the defaults.

export function CloneSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const showError = useApiErrorToast()
  const [name, setName] = useState(() => t('lifecycle.clone.defaultName', { name: trip.name }))
  const [startDate, setStartDate] = useState(trip.startDate)
  const [members, setMembers] = useState(false)
  const [expenses, setExpenses] = useState(false)
  const [photos, setPhotos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState<string | undefined>()

  const endDate = shiftedEndDate(trip.startDate, trip.endDate, startDate)

  async function submit() {
    if (!name.trim()) {
      setNameError(t('lifecycle.clone.nameRequired'))
      return
    }
    setBusy(true)
    try {
      const response = await lifecycleApi.clone(trip.id, {
        name: name.trim(),
        ...(startDate && startDate !== trip.startDate ? { startDate } : {}),
        keep: { members: members || expenses, expenses, photos },
      })
      toast.show(t('lifecycle.clone.done', { name: response.trip.name }), { tone: 'success' })
      onClose()
      navigate(tripPath(response.trip.id))
    } catch (error) {
      showError(error)
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('lifecycle.clone.title')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? t('lifecycle.clone.working') : t('lifecycle.clone.submit')}
          </Button>
        </>
      }
    >
      <Stack $gap="lg">
        <Muted>{t('lifecycle.clone.body')}</Muted>
        <Input
          label={t('lifecycle.clone.name')}
          value={name}
          maxLength={120}
          required
          error={nameError}
          onChange={(event) => {
            setName(event.target.value)
            setNameError(undefined)
          }}
        />
        <DateField
          label={t('lifecycle.clone.startDate')}
          value={startDate}
          required
          hint={t('lifecycle.clone.dates', {
            range: formatDateRange(startDate || trip.startDate, endDate, t.locale),
          })}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <Options>
          <legend>{t('lifecycle.clone.keepLabel')}</legend>
          <CheckOption
            label={t('lifecycle.clone.keepMembers')}
            hint={t('lifecycle.clone.keepMembersHint')}
            checked={members || expenses}
            disabled={expenses}
            onChange={setMembers}
          />
          <CheckOption
            label={t('lifecycle.clone.keepExpenses')}
            hint={t('lifecycle.clone.keepExpensesHint')}
            checked={expenses}
            onChange={setExpenses}
          />
          <CheckOption
            label={t('lifecycle.clone.keepPhotos')}
            hint={t('lifecycle.clone.keepPhotosHint')}
            checked={photos}
            onChange={setPhotos}
          />
        </Options>
      </Stack>
    </Sheet>
  )
}
