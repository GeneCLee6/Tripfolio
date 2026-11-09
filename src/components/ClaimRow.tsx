import { useId, useState } from 'react'
import styled from 'styled-components'
import type { WishlistClaim } from '../../shared/api/types.ts'
import type { WishlistClaimPatch } from '../../shared/schema/index.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'
import { Select } from './Field.tsx'
import { IconButton } from './IconButton.tsx'
import { CloseIcon, PlusIcon } from './icons.tsx'
import { controlBox } from './styles.ts'

// One claim on a must-buy pick (e5-t04): who buys it (a member, or not decided), who it is for (free
// text: family back home are not members), how many, and whether it is bought. Text is saved when
// the field loses focus; the rest at once.

const Row = styled.div<{ $done: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: ${space.sm}px;
  padding: ${space.sm + 2}px ${space.md - 2}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${({ $done }) => ($done ? color.paper : color.card)};
`

const Bottom = styled.div`
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
`

const Label = styled.label`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.medium};
  color: ${color.muted};
`

const TextBox = styled.input`
  ${controlBox}
  min-height: 36px;
  font: inherit;
  font-size: ${fontSize.sm}px;
  color: ${color.ink};
`

const Stepper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  > output {
    min-width: 3ch;
    text-align: center;
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    font-size: ${fontSize.body}px;
  }
`

const StepLabel = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
  margin-right: ${space.xs}px;
`

const Check = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  > input {
    width: 18px;
    height: 18px;
    accent-color: ${color.fjord};
  }
`

const MinusIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M5 12h14" />
  </svg>
)

export interface ClaimRowProps {
  claim: WishlistClaim
  members: readonly { id: string; name: string }[]
  onChange: (patch: WishlistClaimPatch) => void
  onRemove: () => void
  disabled?: boolean
}

export const MAX_CLAIM_QTY = 999

export function ClaimRow({ claim, members, onChange, onRemove, disabled = false }: ClaimRowProps) {
  const t = useT()
  const qtyId = useId()
  const [forName, setForName] = useState(claim.forName)
  // Follow a save from elsewhere unless it is being typed over
  const [seen, setSeen] = useState(claim.forName)
  if (seen !== claim.forName) {
    setSeen(claim.forName)
    setForName(claim.forName)
  }

  return (
    <Row $done={claim.done} data-claim-id={claim.id}>
      <Select
        label={t('picks.claim.buyer')}
        value={claim.buyerMemberId ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ buyerMemberId: event.target.value || null })}
      >
        <option value="">{t('picks.claim.buyerNone')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
      <Label>
        {t('picks.claim.for')}
        <TextBox
          type="text"
          maxLength={100}
          placeholder={t('picks.claim.forPlaceholder')}
          value={forName}
          disabled={disabled}
          onChange={(event) => setForName(event.target.value)}
          onBlur={() => {
            if (forName.trim() !== claim.forName) onChange({ forName: forName.trim() })
          }}
        />
      </Label>
      <Bottom>
        <Stepper role="group" aria-labelledby={qtyId}>
          <StepLabel id={qtyId}>{t('picks.claim.qty')}</StepLabel>
          <IconButton
            size="sm"
            variant="secondary"
            label={t('picks.claim.less')}
            icon={<MinusIcon />}
            disabled={disabled || claim.qty <= 1}
            onClick={() => onChange({ qty: claim.qty - 1 })}
          />
          <output aria-live="polite">{claim.qty}</output>
          <IconButton
            size="sm"
            variant="secondary"
            label={t('picks.claim.more')}
            icon={<PlusIcon size={16} />}
            disabled={disabled || claim.qty >= MAX_CLAIM_QTY}
            onClick={() => onChange({ qty: claim.qty + 1 })}
          />
        </Stepper>
        <Check>
          <input
            type="checkbox"
            checked={claim.done}
            disabled={disabled}
            onChange={(event) => onChange({ done: event.target.checked })}
          />
          {t('picks.claim.done')}
        </Check>
        {!disabled && (
          <IconButton
            size="sm"
            label={t('picks.claim.remove')}
            icon={<CloseIcon size={16} />}
            onClick={onRemove}
          />
        )}
      </Bottom>
    </Row>
  )
}
