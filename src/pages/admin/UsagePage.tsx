import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'
import type { AdminUsageResponse } from '../../../shared/api/admin.ts'
import { Page } from '../../app/TopBar.tsx'
import {
  Button,
  Card,
  CardText,
  CardTitle,
  Input,
  Meter,
  Skeleton,
  StorageMeterView,
  WarningList,
} from '../../components/index.ts'
import {
  adminApi,
  bytesText,
  cfMeters,
  formatCount,
  formatPct,
  metricLabelKey,
  PROVIDERS,
  providerLabelKey,
  usageErrorKind,
} from '../../lib/admin/usage.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { PageHeading, SectionTitle, Stack } from '../parts.tsx'

// /admin/usage?key=<ADMIN_KEY> (e11-t05, AC-11.5): the operator's view of the free-tier budget.
// Meters for external API calls today, R2 storage, D1 writes and (with an analytics token) the
// Cloudflare numbers; amber from 80 %, red over the limit, each with an icon line. Without a key in
// the address the page asks for one; the key is never stored on the device.

const Grid = styled.div`
  display: grid;
  gap: ${space.lg}px;
  align-items: start;
  @media ${media.tablet} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const Note = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  max-width: 70ch;
`

const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.sm}px;
  th,
  td {
    padding: ${space.sm}px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid ${color.line};
  }
  tr:last-child td {
    border-bottom: none;
  }
  @media ${media.tablet} {
    th,
    td {
      padding: ${space.sm}px ${space.md}px;
    }
  }
  th {
    white-space: nowrap;
    color: ${color.muted};
    font-weight: ${fontWeight.medium};
  }
  td.num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  th.num {
    text-align: right;
  }
  td.meter {
    min-width: 88px;
    width: 40%;
  }
  code {
    font-family: ${font.mono};
  }
`

const Tiles = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: ${space.md}px;
  margin: 0;
  > div {
    display: grid;
    gap: 2px;
    padding: ${space.md}px;
    border: 1px solid ${color.line};
    border-radius: ${radius.card}px;
    background: ${color.card};
  }
  dt {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
  dd {
    margin: 0;
    font-size: ${fontSize.xl}px;
    font-weight: ${fontWeight.bold};
    font-variant-numeric: tabular-nums;
  }
`

const TripList = styled.ol`
  display: grid;
  gap: ${space.md}px;
  margin: 0;
  padding: 0;
  list-style: none;
  > li {
    display: grid;
    gap: ${space.xs}px;
  }
`

const TripName = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const KeyForm = styled.form`
  display: grid;
  gap: ${space.md}px;
  max-width: 420px;
`

const Status = styled.p<{ $tone?: 'danger' }>`
  margin: 0;
  color: ${({ $tone }) => ($tone === 'danger' ? color.danger : color.ink)};
`

function meterTexts(t: Translate) {
  return { nearText: t('admin.usage.meterNear'), overText: t('admin.usage.meterOver') }
}

function KeyPrompt({ onSubmit }: { onSubmit: (key: string) => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Card>
      <KeyForm onSubmit={submit}>
        <CardTitle>{t('admin.usage.keyTitle')}</CardTitle>
        <CardText>{t('admin.usage.keyBody')}</CardText>
        <Input
          label={t('admin.usage.keyLabel')}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div>
          <Button type="submit" variant="primary">
            {t('admin.usage.keySubmit')}
          </Button>
        </div>
      </KeyForm>
    </Card>
  )
}

function Warnings({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  if (data.warnings.length === 0) return <Status role="status">{t('admin.usage.allClear')}</Status>
  return (
    <div role="alert">
      <WarningList
        label={t('admin.usage.warnings')}
        items={data.warnings.map((w) => ({
          key: w.metric,
          text: t(w.over ? 'admin.usage.warning.over' : 'admin.usage.warning.near', {
            metric: t(metricLabelKey(w.metric)),
            pct: formatPct(w.pct, t.locale),
          }),
        }))}
      />
    </div>
  )
}

function External({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  return (
    <Stack $gap="sm" as="section" aria-labelledby="usage-external">
      <SectionTitle id="usage-external">{t('admin.usage.external')}</SectionTitle>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <th scope="col">{t('admin.usage.col.provider')}</th>
              <th scope="col" className="num">
                {t('admin.usage.col.today')}
              </th>
              <th scope="col" className="num">
                {t('admin.usage.col.limit')}
              </th>
              <th scope="col">{t('admin.usage.col.usage')}</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((p) => {
              const m = data.external[p]
              return (
                <tr key={p} data-provider={p}>
                  <td>{t(providerLabelKey(p))}</td>
                  <td className="num">{formatCount(m.today, t.locale)}</td>
                  <td className="num">{formatCount(m.limit, t.locale)}</td>
                  <td className="meter">
                    <Meter
                      ariaLabel={t(providerLabelKey(p))}
                      value={m.today}
                      limit={m.limit}
                      valueText={formatPct(m.pct, t.locale)}
                      {...meterTexts(t)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
      <Note>{t('admin.usage.externalNote')}</Note>
    </Stack>
  )
}

function Storage({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  const { r2 } = data
  return (
    <Card as="section" aria-labelledby="usage-r2">
      <Stack $gap="md">
        <SectionTitle id="usage-r2">{t('admin.usage.r2')}</SectionTitle>
        <Meter
          ariaLabel={t('admin.usage.r2')}
          value={r2.bytes}
          limit={r2.limitBytes}
          valueText={t('admin.usage.ofLimit', {
            used: bytesText(r2.bytes, t.locale),
            limit: bytesText(r2.limitBytes, t.locale),
          })}
          {...meterTexts(t)}
        />
        <CardTitle as="h3">{t('admin.usage.r2Top')}</CardTitle>
        {r2.byTrip.length === 0 ? (
          <Note>{t('admin.usage.r2Empty')}</Note>
        ) : (
          <TripList>
            {r2.byTrip.map((trip) => (
              <li key={trip.tripId}>
                <TripName>{trip.name || t('admin.usage.untitledTrip')}</TripName>
                <StorageMeterView
                  compact
                  usage={{ bytes: trip.bytes, count: 0, warnAtBytes: r2.tripWarnBytes }}
                />
              </li>
            ))}
          </TripList>
        )}
        <Note>{t('admin.usage.r2Note')}</Note>
      </Stack>
    </Card>
  )
}

function Database({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  const { d1 } = data
  return (
    <Card as="section" aria-labelledby="usage-d1">
      <Stack $gap="md">
        <SectionTitle id="usage-d1">{t('admin.usage.d1')}</SectionTitle>
        <Meter
          label={t('admin.usage.d1Writes')}
          value={d1.estimatedWritesToday}
          limit={d1.limitWrites}
          valueText={t('admin.usage.ofLimit', {
            used: formatCount(d1.estimatedWritesToday, t.locale),
            limit: formatCount(d1.limitWrites, t.locale),
          })}
          {...meterTexts(t)}
        />
        <Note>{t('admin.usage.d1WritesNote')}</Note>
        <CardTitle as="h3">{t('admin.usage.d1Rows')}</CardTitle>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th scope="col">{t('admin.usage.col.table')}</th>
                <th scope="col" className="num">
                  {t('admin.usage.col.rows')}
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d1.rows).map(([name, rows]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td className="num">{formatCount(rows, t.locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Stack>
    </Card>
  )
}

function Trips({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  const items = [
    ['active', t('admin.usage.trips.active')],
    ['archived', t('admin.usage.trips.archived')],
    ['deleted', t('admin.usage.trips.deleted')],
    ['pendingPurge', t('admin.usage.trips.pendingPurge')],
  ] as const
  return (
    <Stack $gap="sm" as="section" aria-labelledby="usage-trips">
      <SectionTitle id="usage-trips">{t('admin.usage.trips')}</SectionTitle>
      <Tiles>
        {items.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{formatCount(data.trips[key], t.locale)}</dd>
          </div>
        ))}
      </Tiles>
    </Stack>
  )
}

function Cloudflare({ data }: { data: AdminUsageResponse }) {
  const t = useT()
  return (
    <Card as="section" aria-labelledby="usage-cf">
      <Stack $gap="md">
        <SectionTitle id="usage-cf">{t('admin.usage.cf')}</SectionTitle>
        {data.cf ? (
          <Grid>
            {cfMeters(data.cf, t.locale).map((m) => (
              <Meter
                key={m.key}
                label={t(m.labelKey)}
                value={m.value}
                limit={m.limit}
                valueText={
                  m.key === 'do'
                    ? t('admin.usage.unit.gbs', {
                        value: t('admin.usage.ofLimit', { used: m.used, limit: m.max }),
                      })
                    : t('admin.usage.ofLimit', { used: m.used, limit: m.max })
                }
                {...meterTexts(t)}
              />
            ))}
          </Grid>
        ) : (
          <Note data-testid="cf-setup">
            {data.cfStatus === 'error' ? t('admin.usage.cf.error') : t('admin.usage.cf.setup')}
          </Note>
        )}
      </Stack>
    </Card>
  )
}

function UsageView({ adminKey }: { adminKey: string }) {
  const t = useT()
  const usage = useResource(adminKey, (signal) => adminApi.usage(adminKey, signal))
  const refresh = (
    <Button variant="secondary" onClick={usage.reload}>
      {t('admin.usage.refresh')}
    </Button>
  )
  if (usage.status === 'loading')
    return (
      <Stack>
        <PageHeading eyebrow={t('admin.usage.eyebrow')} title={t('admin.usage.title')} />
        <Skeleton $height={240} aria-label={t('admin.usage.loading')} />
      </Stack>
    )
  if (usage.status === 'error')
    return (
      <Stack>
        <PageHeading
          eyebrow={t('admin.usage.eyebrow')}
          title={t('admin.usage.title')}
          actions={refresh}
        />
        <Status role="alert" $tone="danger">
          {t(`admin.usage.error.${usageErrorKind(usage.error)}`)}
        </Status>
      </Stack>
    )
  const data = usage.data
  return (
    <Stack>
      <PageHeading
        eyebrow={t('admin.usage.eyebrow')}
        title={t('admin.usage.title')}
        lead={t('admin.usage.lead', { date: data.date })}
        actions={refresh}
      />
      <Warnings data={data} />
      <External data={data} />
      <Grid>
        <Storage data={data} />
        <Database data={data} />
      </Grid>
      <Trips data={data} />
      <Cloudflare data={data} />
    </Stack>
  )
}

/** The operator's usage page */
export default function UsagePage() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const key = params.get('key') ?? ''
  return (
    <Page $width={1080}>
      {key ? (
        <UsageView adminKey={key} />
      ) : (
        <Stack>
          <PageHeading eyebrow={t('admin.usage.eyebrow')} title={t('admin.usage.title')} />
          <KeyPrompt onSubmit={(next) => setParams({ key: next }, { replace: true })} />
        </Stack>
      )}
    </Page>
  )
}
