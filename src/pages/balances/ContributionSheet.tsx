import { useId, useState, type FormEvent } from 'react'
import type { PoolContribution } from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import type { PoolContributionPatch } from '../../../shared/schema/expense.ts'
import { Button, DateField, Input, MoneyField, Select, Sheet } from '../../components/index.ts'
import { isApiError } from '../../lib/api.ts'
import type { ContributionCreateBody } from '../../lib/balances/api.ts'
import { parseRate } from '../../lib/balances/view.ts'
import { useT } from '../../lib/i18n.ts'
import { Stack } from '../parts.tsx'

// Add or edit a contribution into the shared pool (e7-t04): who, how much in which currency, the
// date (empty = today in the trip's zone) and a note. When the Worker has no rate for that
// currency and day (422 fx_unavailable) a rate field appears and the save is sent again with it.

export type ContributionSave =
  | { kind: 'create'; body: ContributionCreateBody }
  | { kind: 'patch'; id: string; patch: PoolContributionPatch }

export function ContributionSheet({
  contribution,
  members,
  defaultMemberId,
  baseCurrency,
  currencies,
  onSave,
  onClose,
}: {
  /** null: a new contribution */
  contribution: PoolContribution | null
  /** Current members (a contribution names one of them) */
  members: readonly Member[]
  defaultMemberId: string
  baseCurrency: string
  /** Currencies offered in the amount chip */
  currencies: readonly CurrencyCode[]
  /** Saves; resolves true when done, false on an error it showed; rejects only on fx_unavailable */
  onSave: (save: ContributionSave) => Promise<boolean>
  onClose: () => void
}) {
  const t = useT()
  const formId = useId()
  const [memberId, setMemberId] = useState(contribution?.memberId ?? defaultMemberId)
  const [amount, setAmount] = useState<number | null>(contribution?.amountMinor ?? null)
  const [currency, setCurrency] = useState<CurrencyCode>(
    (contribution?.currency ?? currencies[0] ?? baseCurrency) as CurrencyCode,
  )
  const [date, setDate] = useState(contribution?.date ?? '')
  const [note, setNote] = useState(contribution?.note ?? '')
  const [needsRate, setNeedsRate] = useState(false)
  const [rateText, setRateText] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const amountError = touched && (amount === null || amount <= 0) ? t('balances.amountRequired') : undefined
  const rate = parseRate(rateText)
  const rateError = touched && needsRate && rate === null ? t('balances.contribution.rateInvalid') : undefined
  // A member who has since been removed keeps their name in the list while editing
  const memberOptions =
    contribution && !members.some((member) => member.id === contribution.memberId)
      ? [...members, { id: contribution.memberId, name: t('balances.removedMember') }]
      : members

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (amount === null || amount <= 0 || (needsRate && rate === null)) return
    const fxRate = needsRate && rate !== null ? rate : undefined
    let save: ContributionSave
    if (!contribution) {
      save = {
        kind: 'create',
        body: { memberId, amountMinor: amount, currency, note: note.trim(), ...(date ? { date } : {}), fxRate },
      }
    } else {
      const patch: PoolContributionPatch = {}
      if (memberId !== contribution.memberId) patch.memberId = memberId
      if (amount !== contribution.amountMinor) patch.amountMinor = amount
      if (currency !== contribution.currency) patch.currency = currency
      if (date && date !== contribution.date) patch.date = date
      if (note.trim() !== contribution.note) patch.note = note.trim()
      if (fxRate !== undefined) patch.fxRate = fxRate
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      save = { kind: 'patch', id: contribution.id, patch }
    }
    setBusy(true)
    try {
      const ok = await onSave(save)
      if (ok) onClose()
    } catch (error) {
      // onSave shows every other error itself and only lets this one through
      if (isApiError(error) && error.code === 'fx_unavailable') setNeedsRate(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={contribution ? t('balances.contribution.editTitle') : t('balances.contribution.addTitle')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? t('balances.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Stack $gap="lg">
          <Select
            label={t('balances.contribution.member')}
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            {memberOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <MoneyField
            label={t('balances.contribution.amount')}
            error={amountError}
            value={amount}
            currency={currency}
            currencies={currencies}
            onChange={setAmount}
            onCurrencyChange={(next) => {
              setCurrency(next)
              setNeedsRate(false)
            }}
          />
          {needsRate && currency !== baseCurrency && (
            <Input
              label={t('balances.contribution.rate', { currency, base: baseCurrency })}
              hint={t('balances.contribution.rateNeeded', { currency })}
              error={rateError}
              inputMode="decimal"
              autoComplete="off"
              value={rateText}
              onChange={(event) => setRateText(event.target.value)}
            />
          )}
          <DateField
            label={t('balances.contribution.date')}
            hint={contribution ? undefined : t('balances.contribution.dateHint')}
            optional={!contribution}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            label={t('balances.note')}
            optional
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </Stack>
      </form>
    </Sheet>
  )
}
