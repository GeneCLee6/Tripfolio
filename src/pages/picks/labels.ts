import type { Member, WishlistItemView } from '../../../shared/api/types.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import type { WishlistStatus } from '../../../shared/schema/index.ts'
import type { PickTag } from '../../components/index.ts'
import type { Translate } from '../../lib/i18n.ts'
import { claimSummary, type StopDay } from '../../lib/picks/picks.ts'

export const STATUS_LABEL: Record<WishlistStatus, MessageKey> = {
  wish: 'picks.status.wish',
  scheduled: 'picks.status.scheduled',
  done: 'picks.status.done',
  dropped: 'picks.status.dropped',
}

/** 「Day 3」, or the unassigned-day label */
export function dayLabel(day: StopDay, t: Translate): string {
  return day.idx !== null ? t('day.short', { n: day.idx }) : t('picks.unassignedDay')
}

/** The tags under a card: its day, the claim summary of a must-buy, done / dropped, pocket list */
export function pickTags(
  item: WishlistItemView,
  day: StopDay | undefined,
  members: ReadonlyMap<string, Member>,
  t: Translate,
): PickTag[] {
  const tags: PickTag[] = []
  if (day) tags.push({ key: 'day', label: dayLabel(day, t), tone: 'fjord' })
  if (item.category === 'buy' && item.claims.length > 0) {
    const summary = claimSummary(item.claims)
    tags.push({ key: 'qty', label: t('picks.claim.summary', { qty: summary.qty }) })
    const names = summary.buyerIds
      .map((id) => members.get(id)?.name)
      .filter((name): name is string => Boolean(name))
    if (names.length) {
      tags.push({
        key: 'buyers',
        label: t('picks.claim.buyers', { names: names.join(t('picks.vote.separator')) }),
      })
    }
  }
  if (item.status === 'done') tags.push({ key: 'status', label: t('picks.status.done'), tone: 'success' })
  else if (item.status === 'dropped')
    tags.push({ key: 'status', label: t('picks.status.dropped'), tone: 'muted' })
  else if (item.status === 'wish') tags.push({ key: 'status', label: t('picks.pocket') })
  return tags
}
