import type { PayStatus } from '../../shared/schema/lodging.ts'
import { useT } from '../lib/i18n.ts'
import { Chip, type ChipTone } from './Chip.tsx'

// A booking's or lodging's payment state (e4-t02): unpaid in warning, a deposit in tussock, paid in
// full in success. The words carry the meaning; the colour only helps.

const tones: Record<PayStatus, ChipTone> = {
  unpaid: 'warning',
  deposit: 'tussock',
  paid: 'success',
}

export function PayStatusChip({ status }: { status: PayStatus }) {
  const t = useT()
  return <Chip tone={tones[status]}>{t(`bookings.pay.${status}`)}</Chip>
}
