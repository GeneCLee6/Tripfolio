import { useEffect, useId, useMemo, useState } from 'react'
import styled from 'styled-components'
import type { ExpenseView, FxSource } from '../../../shared/api/expenses.ts'
import type { DayWithStops } from '../../../shared/api/types.ts'
import { formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/expense-form.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { useTripContext } from '../../app/trip-context.ts'
import {
  Button,
  CategoryIcon,
  DateField,
  Input,
  MemberPicker,
  MoneyField,
  Select,
  Sheet,
  SplitEditor,
  useToast,
  type PickerMember,
  type SplitValueKind,
} from '../../components/index.ts'
import { ChevronDownIcon } from '../../components/icons.tsx'
import { itineraryApi } from '../../lib/api.ts'
import {
  expensesApi,
  isFxUnavailable,
  notifyExpensesChanged,
  submitExpense,
} from '../../lib/expenses/api.ts'
import {
  POOL,
  baseEstimate,
  categoryOrder,
  currencyOptions,
  exactRemainder,
  formFromExpense,
  newExpenseForm,
  parseRate,
  previewSplit,
  toCreateBody,
  toggleParticipant,
  withMethod,
  type ExpenseForm,
  type FormProblem,
} from '../../lib/expenses/form.ts'
import { loadRecent, rememberExpense } from '../../lib/expenses/recent.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { focusRing } from '../../styles/mixins.ts'
import {
  color,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
} from '../../styles/tokens.ts'
import { categoryLabel } from './labels.ts'
import { useUndoBar } from './UndoBar.tsx'

// 記一筆 (e7-t02, E7 需求「記一筆」): a Sheet on phones, a centered panel from tablet width. Built for
// speed: the amount field has focus, the currency is the last one used, I paid and everyone shares
// equally, so amount → category → 儲存 is enough. Everything else is one tap away. Editing reuses
// the same form with PATCH. Every write goes through submitExpense() (the offline queue's seam).

const Form = styled.form`
  display: grid;
  gap: ${space.lg}px;
`

const Group = styled.div`
  display: grid;
  gap: ${space.sm}px;
  min-width: 0;
`

const GroupLabel = styled.span`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Categories = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${space.xs}px;
`

const CategoryButton = styled.button<{ $selected: boolean }>`
  display: grid;
  justify-items: center;
  gap: 2px;
  min-height: ${touchTarget + 16}px;
  padding: ${space.xs}px 2px;
  border: 1px solid ${({ $selected }) => ($selected ? color.fjord : 'transparent')};
  border-radius: ${radius.control}px;
  background: ${({ $selected }) => ($selected ? color.glacier : 'transparent')};
  color: ${({ $selected }) => ($selected ? color.fjordInk : color.ink)};
  font: inherit;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${({ $selected }) => ($selected ? fontWeight.semibold : fontWeight.regular)};
  cursor: pointer;
  ${focusRing}
`

const RateLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  > b {
    color: ${color.ink};
    font-weight: ${fontWeight.semibold};
  }
`

const Warning = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
`

const MoreToggle = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 ${space.xs}px;
  border: 0;
  border-top: 1px solid ${color.line};
  background: none;
  color: ${color.muted};
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  > svg {
    transform: rotate(${({ $open }) => ($open ? 180 : 0)}deg);
  }
  ${focusRing}
`

const Receipt = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  > input {
    display: none;
  }
`

const FileLabel = styled.label`
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  cursor: pointer;
  &:focus-within {
    outline: 2px solid ${color.fjord};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
`

const Footer = styled.div`
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${space.sm}px;
  > div {
    display: flex;
    gap: ${space.sm}px;
    margin-left: auto;
  }
`

const PROBLEM: Record<FormProblem, MessageKey> = {
  amount: 'expenses.problem.amount',
  category: 'expenses.problem.category',
  participants: 'expenses.problem.participants',
  weights: 'expenses.problem.weights',
  percents: 'expenses.problem.percents',
  percentSum: 'expenses.problem.percentSum',
  exacts: 'expenses.problem.exacts',
  exactSum: 'expenses.problem.exactSum',
  selfPool: 'expenses.problem.selfPool',
  rate: 'expenses.problem.rate',
}
const SPLIT_PROBLEMS = new Set<FormProblem>([
  'participants',
  'weights',
  'percents',
  'percentSum',
  'exacts',
  'exactSum',
  'selfPool',
])

const SOURCE_LABEL: Record<FxSource, MessageKey> = {
  base: 'expenses.rate.source.base',
  manual: 'expenses.rate.source.manual',
  trip: 'expenses.rate.source.trip',
  auto: 'expenses.rate.source.auto',
}

interface KnownRate {
  rate: number | null
  source: FxSource | null
}

export interface ExpenseFormSheetProps {
  open: boolean
  onClose: () => void
  /** Edit this expense; omitted: log a new one */
  expense?: ExpenseView | null
  /** After a successful save (the list may want the row at once) */
  onSaved?: (expense: ExpenseView, created: boolean) => void
  /** Editing only: a 刪除 button that hands the expense back (the page confirms and deletes) */
  onDelete?: (expense: ExpenseView) => void
}

/**
 * The 記一筆 sheet. Stays mounted while closed so the 「已記一筆 · 復原」 bar can outlive it; the
 * form itself starts fresh on every open.
 */
export function ExpenseFormSheet({
  open,
  onClose,
  expense,
  onSaved,
  onDelete,
}: ExpenseFormSheetProps) {
  const t = useT()
  const { trip } = useTripContext()
  const toast = useToast()
  const showError = useApiErrorToast()
  const [bar, showUndo] = useUndoBar()
  const [generation, setGeneration] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setGeneration((n) => n + 1)
  }

  const saved = (result: ExpenseView, created: boolean) => {
    onSaved?.(result, created)
    onClose()
    if (!created) {
      toast.show(t('expenses.updated'), { tone: 'success' })
      return
    }
    showUndo({
      message: t('expenses.saved', {
        amount: formatMoney(result.amountMinor, result.currency, t.locale),
      }),
      undo: () => {
        expensesApi.remove(trip.id, result.id).then(() => {
          notifyExpensesChanged(trip.id)
          toast.show(t('expenses.undone'))
        }, showError)
      },
    })
  }

  return (
    <>
      {open && (
        <ExpenseFormBody
          key={generation}
          expense={expense ?? null}
          onClose={onClose}
          onSaved={saved}
          onDelete={onDelete}
        />
      )}
      {bar}
    </>
  )
}

export default ExpenseFormSheet

function ExpenseFormBody({
  expense,
  onClose,
  onSaved,
  onDelete,
}: {
  expense: ExpenseView | null
  onClose: () => void
  onSaved: (expense: ExpenseView, created: boolean) => void
  onDelete?: (expense: ExpenseView) => void
}) {
  const t = useT()
  const { trip, me, members } = useTripContext()
  const showError = useApiErrorToast()
  const amountId = useId()
  const rateId = useId()
  const fileId = useId()
  const recent = useMemo(() => loadRecent(trip.id), [trip.id])
  const [form, setForm] = useState<ExpenseForm>(() =>
    expense ? formFromExpense(expense, members) : newExpenseForm({ trip, me, members, recent }),
  )
  const [problem, setProblem] = useState<FormProblem | null>(null)
  const [splitOpen, setSplitOpen] = useState(() =>
    Boolean(expense && expense.splitMethod !== 'equal'),
  )
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(expense?.stopId || expense?.receiptAttachmentId),
  )
  const [rateOpen, setRateOpen] = useState(() => expense?.fxSource === 'manual')
  const [needsRate, setNeedsRate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<'idle' | 'uploading' | 'error' | MessageKey>('idle')
  const [known, setKnown] = useState<KnownRate>(() =>
    expense && expense.currency !== trip.baseCurrency
      ? { rate: expense.fxRate, source: expense.fxSource }
      : { rate: null, source: null },
  )
  const [days, setDays] = useState<DayWithStops[] | null>(null)
  const update = (patch: Partial<ExpenseForm>) => setForm((current) => ({ ...current, ...patch }))

  const foreign = form.currency !== trip.baseCurrency

  // Put the cursor in the amount: on phones that brings up the number pad straight away
  useEffect(() => {
    if (!expense) document.getElementById(amountId)?.focus()
  }, [amountId, expense])

  // The rate the server would use (trip default → fxRates), for the 「≈ A$」 line and the prompt
  const keepSaved = expense && expense.currency === form.currency && expense.date === form.date
  useEffect(() => {
    if (!foreign || keepSaved) return
    const controller = new AbortController()
    expensesApi.fx(trip.id, { quote: form.currency, date: form.date }, controller.signal).then(
      (response) => {
        const found = response.rates.find((rate) => rate.quote === form.currency)
        const rate = found?.rate ?? null
        setKnown({ rate, source: found?.source ?? null })
        setNeedsRate(rate === null)
        if (rate === null) setRateOpen(true)
        setForm((current) =>
          current.rateEdited || current.currency !== form.currency
            ? current
            : { ...current, fxRate: rate === null ? '' : String(rate) },
        )
      },
      () => {
        // Unknown: the server still resolves the rate on save, and answers 422 if it cannot
      },
    )
    return () => controller.abort()
  }, [trip.id, form.currency, form.date, foreign, keepSaved])

  // Today's stops for 連結行程點, once the section is open
  useEffect(() => {
    if (!moreOpen || days) return
    const controller = new AbortController()
    itineraryApi.listDays(trip.id, controller.signal).then(
      (response) => setDays(response.days),
      () => setDays([]),
    )
    return () => controller.abort()
  }, [moreOpen, days, trip.id])

  const pickerMembers: PickerMember[] = members
  const nameOf = (id: string) =>
    members.find((member) => member.id === id)?.name ?? t('expenses.removedMember')
  const participantRows: PickerMember[] =
    form.method === 'self'
      ? [{ id: form.payer, name: nameOf(form.payer), color: '' }]
      : form.participants.map((id) => ({
          id,
          name: nameOf(id),
          color: members.find((member) => member.id === id)?.color ?? '',
        }))
  const preview = previewSplit(form)
  const splitProblem =
    !preview.ok && preview.problem !== 'amount' && SPLIT_PROBLEMS.has(preview.problem)
      ? t(PROBLEM[preview.problem])
      : problem && SPLIT_PROBLEMS.has(problem)
        ? t(PROBLEM[problem])
        : undefined

  const typedRate = parseRate(form.fxRate)
  const shownRate = form.rateEdited || needsRate ? typedRate : (known.rate ?? typedRate)
  const shownSource: FxSource | null = form.rateEdited ? 'manual' : known.source
  const estimate = foreign ? baseEstimate(form, trip.baseCurrency, shownRate) : null
  const dayStops = days?.find((day) => day.date === form.date)?.stops ?? []

  const save = async () => {
    if (saving) return
    const options = { baseCurrency: trip.baseCurrency, needsRate }
    // The create body is also a complete PATCH (every field; the server records only real changes)
    const body = toCreateBody(form, options)
    if (!body.ok) {
      setProblem(body.problem)
      if (body.problem === 'rate') setRateOpen(true)
      if (SPLIT_PROBLEMS.has(body.problem)) setSplitOpen(true)
      if (body.problem === 'amount') document.getElementById(amountId)?.focus()
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      const response = expense
        ? await submitExpense(trip.id, { id: expense.id, body: body.value })
        : await submitExpense(trip.id, { body: body.value })
      if (form.category)
        rememberExpense(trip.id, { currency: form.currency, category: form.category })
      onSaved(response.expense, !expense)
    } catch (error) {
      setSaving(false)
      if (isFxUnavailable(error)) {
        setNeedsRate(true)
        setRateOpen(true)
        setProblem('rate')
        setTimeout(() => document.getElementById(rateId)?.focus(), 0)
        return
      }
      showError(error)
    }
  }

  const pickReceipt = async (file: File | undefined) => {
    if (!file) return
    setReceipt('uploading')
    try {
      const { uploadAttachment } = await import('../../lib/upload/upload.ts')
      const attachment = await uploadAttachment(trip.id, file, {
        kind: 'receipt',
        stopId: form.stopId,
      })
      update({ receiptAttachmentId: attachment.id })
      setReceipt('idle')
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? (error as { code: unknown }).code : null
      setReceipt(
        code === 'too_large'
          ? 'expenses.receipt.tooLarge'
          : code === 'unsupported_type'
            ? 'expenses.receipt.unsupported'
            : 'error',
      )
    }
  }

  const title = expense ? t('expenses.editTitle') : t('term.logExpense')
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      actions={
        <Footer>
          {expense && onDelete ? (
            <Button variant="danger" onClick={() => onDelete(expense)}>
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={`${amountId}-form`}
              disabled={saving || receipt === 'uploading'}
            >
              {t('common.save')}
            </Button>
          </div>
        </Footer>
      }
    >
      <Form
        id={`${amountId}-form`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Group>
          <MoneyField
            id={amountId}
            label={t('money.amount')}
            value={form.amountMinor}
            currency={form.currency as CurrencyCode}
            currencies={currencyOptions(trip, form.currency)}
            onChange={(amountMinor) => update({ amountMinor })}
            onCurrencyChange={(currency) =>
              update({ currency, fxRate: '', rateEdited: false, exacts: {} })
            }
            error={problem === 'amount' ? t(PROBLEM.amount) : undefined}
          />
          {foreign && (
            <RateLine>
              {estimate !== null && (
                <b>
                  {t('expenses.rate.approx', {
                    amount: formatMoney(estimate, trip.baseCurrency, t.locale),
                  })}
                </b>
              )}
              {shownRate !== null && shownSource && (
                <span>
                  {t('expenses.rate.source', {
                    rate: String(shownRate),
                    source: t(SOURCE_LABEL[shownSource]),
                  })}
                </span>
              )}
              {!rateOpen && (
                <Button size="sm" variant="ghost" onClick={() => setRateOpen(true)}>
                  {t('expenses.rate.edit')}
                </Button>
              )}
            </RateLine>
          )}
          {foreign && rateOpen && (
            <>
              {needsRate && (
                <Warning>{t('expenses.rate.needed', { currency: form.currency })}</Warning>
              )}
              <Input
                id={rateId}
                label={t('expenses.rate', { currency: form.currency, base: trip.baseCurrency })}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.fxRate}
                error={problem === 'rate' && typedRate === null ? t(PROBLEM.rate) : undefined}
                onChange={(event) => update({ fxRate: event.target.value, rateEdited: true })}
              />
            </>
          )}
        </Group>

        <Group role="radiogroup" aria-label={t('expenses.category')}>
          <GroupLabel aria-hidden="true">{t('expenses.category')}</GroupLabel>
          <Categories>
            {categoryOrder(recent.categories).map((category: ExpenseCategory) => (
              <CategoryButton
                key={category}
                type="button"
                role="radio"
                aria-checked={form.category === category}
                $selected={form.category === category}
                onClick={() => update({ category })}
              >
                <CategoryIcon category={category} size={32} />
                {categoryLabel(t, category)}
              </CategoryButton>
            ))}
          </Categories>
          {problem === 'category' && !form.category && <Warning>{t(PROBLEM.category)}</Warning>}
        </Group>

        <Input
          label={t('expenses.note')}
          optional
          placeholder={t('expenses.notePlaceholder')}
          value={form.note}
          maxLength={2000}
          onChange={(event) => update({ note: event.target.value })}
        />

        <Group>
          <GroupLabel>{t('term.paidBy')}</GroupLabel>
          <MemberPicker
            mode="single"
            label={t('term.paidBy')}
            members={pickerMembers}
            selected={[form.payer]}
            extra={{ id: POOL, label: t('term.sharedFund') }}
            onSelect={(payer) =>
              setForm((current) => ({
                ...current,
                payer,
                method: payer === POOL && current.method === 'self' ? 'equal' : current.method,
              }))
            }
          />
        </Group>

        <Group>
          <GroupLabel>{t('expenses.splitAmong')}</GroupLabel>
          {form.method !== 'self' && (
            <MemberPicker
              label={t('expenses.splitAmong')}
              members={pickerMembers}
              selected={form.participants}
              onSelect={(id) => setForm((current) => toggleParticipant(current, id, members))}
            />
          )}
          <SplitEditor
            method={form.method}
            onMethodChange={(method) => setForm((current) => withMethod(current, method, me.id))}
            participants={participantRows}
            currency={form.currency}
            values={{ weights: form.weights, percents: form.percents, exacts: form.exacts }}
            onValueChange={(kind: SplitValueKind, memberId, text) =>
              setForm((current) => ({ ...current, [kind]: { ...current[kind], [memberId]: text } }))
            }
            preview={preview.ok ? preview.value : null}
            problem={splitProblem}
            remainderMinor={exactRemainder(form)}
            expanded={splitOpen}
            onExpandedChange={setSplitOpen}
          />
        </Group>

        <Group>
          <MoreToggle
            type="button"
            aria-expanded={moreOpen}
            $open={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
          >
            <span>{t('expenses.more')}</span>
            <ChevronDownIcon size={18} />
          </MoreToggle>
          {moreOpen && (
            <Group>
              <DateField
                label={t('expenses.date')}
                value={form.date}
                required
                onChange={(event) => {
                  if (event.target.value)
                    update({ date: event.target.value, stopId: null, dayId: null })
                }}
              />
              <Group>
                <GroupLabel>{t('expenses.receipt')}</GroupLabel>
                <Receipt>
                  {form.receiptAttachmentId ? (
                    <>
                      <span>{t('expenses.receipt.attached')}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update({ receiptAttachmentId: null })}
                      >
                        {t('expenses.receipt.remove')}
                      </Button>
                    </>
                  ) : (
                    <FileLabel htmlFor={fileId}>
                      {receipt === 'uploading'
                        ? t('expenses.receipt.uploading')
                        : t('expenses.receipt.add')}
                    </FileLabel>
                  )}
                  <input
                    id={fileId}
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={receipt === 'uploading'}
                    onChange={(event) => {
                      void pickReceipt(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </Receipt>
                {receipt === 'error' && <Warning>{t('expenses.receipt.failed')}</Warning>}
                {receipt !== 'error' && receipt !== 'idle' && receipt !== 'uploading' && (
                  <Warning>{t(receipt)}</Warning>
                )}
              </Group>
              <Select
                label={t('expenses.stop')}
                optional
                value={form.stopId ?? ''}
                disabled={days === null}
                hint={days && dayStops.length === 0 ? t('expenses.stop.empty') : undefined}
                onChange={(event) => {
                  const stop = dayStops.find((item) => item.id === event.target.value)
                  update({ stopId: stop?.id ?? null, dayId: stop?.dayId ?? null })
                }}
              >
                <option value="">{t('expenses.stop.none')}</option>
                {form.stopId && !dayStops.some((stop) => stop.id === form.stopId) && (
                  <option value={form.stopId}>{t('expenses.stop')}</option>
                )}
                {dayStops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {stop.title}
                  </option>
                ))}
              </Select>
            </Group>
          )}
        </Group>
        {problem &&
          !SPLIT_PROBLEMS.has(problem) &&
          problem !== 'amount' &&
          problem !== 'category' &&
          problem !== 'rate' && <Warning>{t(PROBLEM[problem])}</Warning>}
      </Form>
    </Sheet>
  )
}
