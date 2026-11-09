import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { formatDateRange } from '../../shared/i18n/format.ts'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ColorSwatches,
  EmptyState,
  Input,
  Skeleton,
  useToast,
} from '../components/index.ts'
import { ButtonLink } from '../components/ButtonLink.tsx'
import { Page } from '../app/TopBar.tsx'
import { tripPath } from '../app/sections.ts'
import { api } from '../lib/api.ts'
import { paletteIndex, safeColor } from '../lib/colors.ts'
import { errorMessageKey } from '../lib/errors.ts'
import { useResource } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { rememberInvite } from '../lib/members.ts'
import { getToken } from '../lib/tokens.ts'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  dayColors,
  fontSize,
  fontWeight,
  radius,
  space,
  touchTarget,
} from '../styles/tokens.ts'
import { PageHeading, SectionTitle, Stack } from './parts.tsx'

// /join/:token — "who are you?" (E1 設計方向): the invite shows the trip and the members one can
// claim, big avatars and names so nobody picks the wrong person; or a new member. The memberToken
// the Worker returns is kept on this device and the trip opens.

const NEW = 'new'

const Cover = styled.div<{ $color: string }>`
  height: 72px;
  margin: -${space.lg}px -${space.lg}px ${space.md}px;
  background: ${({ $color }) => $color};
`

const Choices = styled.div`
  display: grid;
  gap: ${space.sm}px;
`

const Choice = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  min-height: ${touchTarget + 12}px;
  padding: ${space.sm}px ${space.lg}px;
  border: 2px solid ${({ $active }) => ($active ? color.fjord : color.line)};
  border-radius: ${radius.card}px;
  background: ${color.card};
  color: ${color.ink};
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.semibold};
  text-align: left;
  cursor: pointer;
  ${({ $active }) =>
    $active &&
    css`
      background: ${color.glacier};
    `}
  ${focusRing}
`

const ChoiceName = styled.span`
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
`

const Muted = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const ErrorText = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
`

export default function JoinPage() {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { token = '' } = useParams()
  const preview = useResource(`join:${token}`, (signal) => api.previewJoin(token, signal))
  const [choice, setChoice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [memberColor, setMemberColor] = useState<string>(dayColors[2])
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  if (preview.status === 'loading') {
    return (
      <Page $width={560} aria-busy="true">
        <Skeleton $height={240} />
      </Page>
    )
  }
  if (preview.status === 'error') {
    return (
      <Page $width={560}>
        <EmptyState
          illustration="pin"
          title={t('join.invalid.title')}
          body={t('join.invalid.body')}
          action={
            <ButtonLink to="/" variant="primary">
              {t('shell.home')}
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  const { trip, members } = preview.data
  const alreadyJoined = Boolean(getToken(trip.id))
  // With nobody to claim, the only choice is a new member
  const selected = members.length === 0 ? NEW : choice

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const body =
      selected && selected !== NEW
        ? { memberId: selected }
        : { name: name.trim(), color: memberColor }
    if (!selected || ('name' in body && !body.name)) {
      setError(t('join.pickError'))
      return
    }
    setJoining(true)
    try {
      const response = await api.join(token, body)
      // 「這不是我」 in settings can bring this tab back here (src/lib/members.ts)
      rememberInvite(response.trip.id, token)
      toast.show(t('join.joined', { name: response.member.name }), { tone: 'success' })
      navigate(tripPath(response.trip.id), { replace: true })
    } catch (failure) {
      const { key, code } = errorMessageKey(failure)
      setError(t(key, { code }))
      setJoining(false)
    }
  }

  return (
    <Page $width={560}>
      <Stack>
        <Card>
          <Cover $color={safeColor(trip.coverColor, trip.id)} />
          <Stack $gap="xs">
            <Muted>{t('join.invitedTo')}</Muted>
            <SectionTitle as="p">{trip.name}</SectionTitle>
            <Muted>
              {formatDateRange(trip.startDate, trip.endDate, t.locale)}
              {trip.destination && ` · ${trip.destination}`}
            </Muted>
            {members.length > 0 && (
              <Muted>{t('members.join.members', { count: members.length })}</Muted>
            )}
          </Stack>
        </Card>

        <PageHeading title={t('join.title')} lead={t('join.body')} />

        {alreadyJoined && (
          <Card>
            <Stack $gap="sm">
              <Muted>{t('join.already')}</Muted>
              <div>
                <ButtonLink to={tripPath(trip.id)}>{t('join.openTrip')}</ButtonLink>
              </div>
            </Stack>
          </Card>
        )}

        <form onSubmit={submit} noValidate>
          <Stack $gap="lg">
            <Choices role="radiogroup" aria-label={t('join.existing')}>
              {members.map((member) => (
                <Choice
                  key={member.id}
                  type="button"
                  role="radio"
                  aria-checked={selected === member.id}
                  $active={selected === member.id}
                  onClick={() => setChoice(member.id)}
                >
                  <Avatar
                    name={member.name}
                    colorIndex={paletteIndex(member.color, member.id)}
                    size="lg"
                  />
                  <ChoiceName>{member.name}</ChoiceName>
                  {member.role === 'viewer' && <Chip tone="tussock">{t('role.viewer')}</Chip>}
                </Choice>
              ))}
              <Choice
                type="button"
                role="radio"
                aria-checked={selected === NEW}
                $active={selected === NEW}
                onClick={() => setChoice(NEW)}
              >
                <Avatar name={name || '+'} colorIndex={paletteIndex(memberColor, NEW)} size="lg" />
                {t('join.newMember')}
              </Choice>
            </Choices>
            {selected === NEW && (
              <Stack $gap="md">
                <Input
                  label={t('join.newName')}
                  value={name}
                  maxLength={60}
                  required
                  autoComplete="nickname"
                  onChange={(event) => setName(event.target.value)}
                />
                <ColorSwatches
                  label={t('join.newColor')}
                  value={memberColor}
                  onChange={setMemberColor}
                />
              </Stack>
            )}
            {error && <ErrorText role="alert">{error}</ErrorText>}
            <div>
              <Button type="submit" variant="primary" size="lg" disabled={joining}>
                {joining ? t('join.joining') : t('join.submit')}
              </Button>
            </div>
          </Stack>
        </form>
      </Stack>
    </Page>
  )
}
