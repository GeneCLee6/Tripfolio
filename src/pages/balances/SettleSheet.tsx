import { useId, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import { formatMoney } from '../../../shared/i18n/format.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import { settlementMethods, type SettlementMethod } from '../../../shared/schema/expense.ts'
import { Button, Input, MoneyField, SegmentedControl, Sheet } from '../../components/index.ts'
import { checkSettleAmount, METHOD_LABEL, type SuggestionCard } from '../../lib/balances/view.ts'
import { useT } from '../../lib/i18n.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'

// 「已結清」 on a suggestion: how much was paid (the suggestion, or less for a partial settlement),
// how (cash / transfer / other) and a note. POST /settlements happens in the page.

const Who = styled.p`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.medium};
`

const Label = styled.span`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  color: ${color.ink};
`

const Field = styled.div`
  display: grid;
  gap: ${space.xs}px;
`

export interface SettleValues {
  amountMinor: number
  method: SettlementMethod
  note: string
}

export function SettleSheet({
  card,
  currency,
  names,
  onSubmit,
  onClose,
}: {
  card: SuggestionCard
  currency: string
  /** Display names of the two people (removed members already have their stand-in) */
  names: { from: string; to: string }
  /** Resolves true when saved (the sheet then closes) */
  onSubmit: (values: SettleValues) => Promise<boolean>
  onClose: () => void
}) {
  const t = useT()
  const formId = useId()
  const [amount, setAmount] = useState<number | null>(card.amountMinor)
  const [method, setMethod] = useState<SettlementMethod>('transfer')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const suggested = formatMoney(card.amountMinor, currency, t.locale)
  const problem = checkSettleAmount(amount, card.amountMinor)
  const error = !touched
    ? undefined
    : problem === 'empty'
      ? t('balances.amountRequired')
      : problem === 'tooMuch'
        ? t('balances.settle.tooMuch', { amount: suggested })
        : undefined

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (problem || amount === null) return
    setBusy(true)
    const ok = await onSubmit({ amountMinor: amount, method, note: note.trim() })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('balances.settle.title')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? t('balances.saving') : t('balances.settle.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Stack $gap="lg">
          <Who>{t('balances.settle.who', names)}</Who>
          <MoneyField
            label={t('balances.settle.amount')}
            hint={t('balances.settle.amountHint', { amount: suggested })}
            error={error}
            value={amount}
            currency={currency as CurrencyCode}
            currencies={[currency as CurrencyCode]}
            onChange={(next) => {
              setAmount(next)
              setTouched(true)
            }}
          />
          <Field>
            <Label>{t('balances.settle.method')}</Label>
            <SegmentedControl
              label={t('balances.settle.method')}
              options={settlementMethods.map((value) => ({ value, label: t(METHOD_LABEL[value]) }))}
              value={method}
              onChange={setMethod}
            />
          </Field>
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
