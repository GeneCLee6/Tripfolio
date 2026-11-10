import styled from 'styled-components'
import type { Member, Trip, WishlistItemView } from '../../../shared/api/types.ts'
import { formatMoney } from '../../../shared/i18n/format.ts'
import {
  Avatar,
  Button,
  CategoryChip,
  CategoryGlyph,
  ClaimRow,
  VoteButton,
} from '../../components/index.ts'
import { PlusIcon } from '../../components/icons.tsx'
import { paletteIndex } from '../../lib/colors.ts'
import { useT } from '../../lib/i18n.ts'
import { placeName } from '../../lib/itinerary/places.ts'
import { claimSummary, stopDays } from '../../lib/picks/picks.ts'
import { usePickImage } from '../../lib/picks/photo.ts'
import { usePicksState, type PicksStore } from '../../lib/picks/store.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { dayLabel, STATUS_LABEL } from './labels.ts'

// One pick in the detail pane (desktop) or a Sheet: the big picture, everything about it, who wants
// to go, the claims of a must-buy (e5-t04), and its actions. It reads the page's store, so a vote or
// claim made here shows on the wall at once and the other way round.

const Wrapper = styled.div`
  display: grid;
  gap: ${space.lg}px;
  min-width: 0;
`

const Picture = styled.div`
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  border-radius: ${radius.card}px;
  background: ${color.glacier};
  color: ${color.fjord};
  overflow: hidden;
  > img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  > span {
    position: absolute;
    left: ${space.sm + 2}px;
    top: ${space.sm + 2}px;
  }
`

const Name = styled.h3`
  margin: 0;
  font-family: ${font.display};
  font-size: ${fontSize.lg}px;
  line-height: 1.2;
  overflow-wrap: anywhere;
`

const Facts = styled.dl`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: ${space.xs + 2}px ${space.md}px;
  margin: 0;
  font-size: ${fontSize.sm}px;
  > dt {
    color: ${color.muted};
  }
  > dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`

const Price = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  color: ${color.tussock};
  font-weight: ${fontWeight.medium};
`

const Note = styled.p`
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`

const Section = styled.section`
  display: grid;
  gap: ${space.sm}px;
  > h4 {
    margin: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
  }
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
`

const Muted = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Who = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
`

export interface PickActions {
  edit: (item: WishlistItemView) => void
  schedule: (item: WishlistItemView) => void
  unschedule: (item: WishlistItemView) => void
  setStatus: (item: WishlistItemView, status: WishlistItemView['status']) => void
  /** 「完成並記帳」: open the prefilled 記一筆 form; the pick is done once it is saved */
  complete: (item: WishlistItemView) => void
  remove: (item: WishlistItemView) => void
  vote: (item: WishlistItemView, on: boolean) => void
}

export interface PickDetailProps {
  itemId: string
  store: PicksStore
  trip: Trip
  me: Member
  members: readonly Member[]
  canEdit: boolean
  actions: PickActions
}

export function PickDetail({ itemId, store, trip, me, members, canEdit, actions }: PickDetailProps) {
  const t = useT()
  const showError = useApiErrorToast()
  const state = usePicksState(store)
  const item = state.items.find((other) => other.id === itemId)
  const image = usePickImage(trip.id, item ?? { photoAttachmentId: null, sourceImageUrl: null }, 'full')
  if (!item) return <Muted>{t('picks.detail.gone')}</Muted>

  const byId = new Map(members.map((member) => [member.id, member]))
  const day = item.stopId ? stopDays(state.days).get(item.stopId) : undefined
  const recommender = item.recommenderMemberId ? byId.get(item.recommenderMemberId) : undefined
  const voters = item.votes
    .map((id) => byId.get(id))
    .filter((member): member is Member => Boolean(member))
  const price =
    item.estMinor === null || !item.currency
      ? null
      : item.estMinor === 0
        ? t('picks.free')
        : formatMoney(item.estMinor, item.currency, t.locale)
  const summary = claimSummary(item.claims)
  const run = (work: Promise<unknown>) => work.catch(showError)

  return (
    <Wrapper data-pick-detail={item.id}>
      <Picture>
        {image ? (
          <img src={image} alt={t('picks.detail.photoAlt', { name: item.name })} referrerPolicy="no-referrer" />
        ) : (
          <CategoryGlyph category={item.category} size={64} />
        )}
        <span>
          <CategoryChip category={item.category} overlay />
        </span>
      </Picture>
      <Name>{item.name}</Name>
      <Facts>
        <dt>{t('picks.editor.status')}</dt>
        <dd>
          {t(STATUS_LABEL[item.status])}
          {day ? ` · ${dayLabel(day, t)}` : ''}
        </dd>
        {price && (
          <>
            <dt>{t('picks.editor.price')}</dt>
            <dd>
              <Price>{price}</Price>
            </dd>
          </>
        )}
        {item.place && (
          <>
            <dt>{t('picks.editor.place')}</dt>
            <dd>{placeName(item.place, t.locale)}</dd>
          </>
        )}
        {recommender && (
          <>
            <dt>{t('picks.editor.recommender')}</dt>
            <dd>
              <Who>
                <Avatar
                  name={recommender.name}
                  colorIndex={paletteIndex(recommender.color, recommender.id)}
                  size="sm"
                />
                {recommender.name}
              </Who>
            </dd>
          </>
        )}
        {item.sourceUrl && (
          <>
            <dt>{t('picks.editor.source')}</dt>
            <dd>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                {item.sourceTitle || item.sourceUrl}
              </a>
            </dd>
          </>
        )}
      </Facts>
      {item.note.trim() && <Note>{item.note}</Note>}

      <Section aria-label={t('picks.detail.voters')}>
        <h4>{t('picks.detail.voters')}</h4>
        <Row>
          <VoteButton
            itemName={item.name}
            voters={voters}
            voted={item.votes.includes(me.id)}
            disabled={!canEdit}
            onToggle={(on) => actions.vote(item, on)}
          />
          {voters.length > 0 && (
            <Muted>{voters.map((voter) => voter.name).join(t('picks.vote.separator'))}</Muted>
          )}
        </Row>
      </Section>

      {(item.category === 'buy' || item.claims.length > 0) && (
        <Section aria-label={t('picks.claim.title')}>
          <h4>
            {t('picks.claim.title')}
            {summary.count > 0 && ` · ${t('picks.claim.summary', { qty: summary.qty })}`}
          </h4>
          {item.claims.length === 0 && <Muted>{t('picks.claim.empty')}</Muted>}
          {item.claims.map((claim) => (
            <ClaimRow
              key={claim.id}
              claim={claim}
              members={members}
              disabled={!canEdit}
              onChange={(patch) => void run(store.patchClaim(item.id, claim.id, patch))}
              onRemove={() => void run(store.removeClaim(item.id, claim.id))}
            />
          ))}
          {canEdit && (
            <Row>
              <Button
                size="sm"
                onClick={() => void run(store.addClaim(item.id, { buyerMemberId: me.id, qty: 1 }))}
              >
                <PlusIcon size={16} />
                {t('picks.claim.add')}
              </Button>
            </Row>
          )}
        </Section>
      )}

      {canEdit && (
        <Row>
          <Button size="sm" onClick={() => actions.edit(item)}>
            {t('picks.action.edit')}
          </Button>
          {item.stopId ? (
            <Button size="sm" onClick={() => actions.unschedule(item)}>
              {t('picks.action.unschedule')}
            </Button>
          ) : item.status === 'wish' ? (
            <Button size="sm" onClick={() => actions.schedule(item)}>
              {t('picks.action.schedule')}
            </Button>
          ) : null}
          {item.status === 'done' ? (
            <Button size="sm" onClick={() => actions.setStatus(item, item.stopId ? 'scheduled' : 'wish')}>
              {t('picks.action.reopen')}
            </Button>
          ) : item.status !== 'dropped' ? (
            <>
              <Button size="sm" variant="primary" onClick={() => actions.complete(item)}>
                {t('picks.action.done')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => actions.setStatus(item, 'done')}>
                {t('picks.action.doneNoExpense')}
              </Button>
            </>
          ) : null}
          {item.status === 'wish' && (
            <Button size="sm" variant="ghost" onClick={() => actions.setStatus(item, 'dropped')}>
              {t('picks.action.drop')}
            </Button>
          )}
          {item.status === 'dropped' && (
            <Button size="sm" onClick={() => actions.setStatus(item, 'wish')}>
              {t('picks.action.restore')}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => actions.remove(item)}>
            {t('picks.action.delete')}
          </Button>
        </Row>
      )}
    </Wrapper>
  )
}
