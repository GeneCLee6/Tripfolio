import { Fragment, Suspense, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import {
  formatDate,
  formatDateRange,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
  formatTzAbbrev,
} from '../../shared/i18n/format.ts'
import type { Locale } from '../../shared/i18n/t.ts'
import type { CurrencyCode } from '../../shared/money/currencies.ts'
import {
  Avatar,
  AvatarGroup,
  Button,
  Card,
  CardText,
  CardTitle,
  Chip,
  DateField,
  DayChip,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  LanguageSwitch,
  MoneyField,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Tabs,
  ThemeSwitch,
  TimeField,
  Timeline,
  TimelineItem,
  useToast,
} from '../components/index.ts'
import { MapPinIcon, PlusIcon, TrashIcon } from '../components/icons.tsx'
import { useT } from '../lib/i18n.ts'
import {
  LAYER_LABEL_KEYS,
  LazyTripMap,
  MAP_LAYER_KEYS,
  SAMPLE_DAY_COUNT,
  googleMapsUrl,
  sampleFuel,
  sampleLodging,
  sampleOvernightLinks,
  samplePicks,
  samplePocket,
  sampleRoutes,
  sampleStops,
  type MapAction,
  type MapLayers,
  type MapPoint,
} from '../map/index.ts'
import { color, dayColor, dayColors, font, fontSize, radius, space } from '../styles/tokens.ts'

// /dev/ui (AC-10.1): every base component, light and dark side by side. Development only: the route
// is added behind import.meta.env.DEV in src/app/App.tsx, so production builds never include this.

const Page = styled.main`
  max-width: 1440px;
  margin: 0 auto;
  padding: ${space.xl}px max(${space.lg}px, env(safe-area-inset-left, 0px));
`

const Bar = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.md}px;
  margin-bottom: ${space.xl}px;
  h1 {
    margin: 0;
    font-size: ${fontSize.xl}px;
  }
  p {
    flex-basis: 100%;
    margin: 0;
    color: ${color.muted};
  }
`

const Spacer = styled.span`
  flex: 1;
`

const Columns = styled.div`
  display: grid;
  gap: ${space.xl}px;
  @media (min-width: 1100px) {
    grid-template-columns: 1fr 1fr;
  }
`

const ThemePanel = styled.div`
  min-width: 0;
  padding: ${space.xl}px;
  border-radius: ${radius.cover}px;
  border: 1px solid ${color.line};
  background: ${color.paper};
  color: ${color.ink};
  display: grid;
  gap: ${space.xl}px;
  align-content: start;
`

const PanelLabel = styled.p`
  margin: 0;
  font-family: ${font.mono};
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${color.muted};
`

const Section = styled.section`
  display: grid;
  gap: ${space.md}px;
  h2 {
    margin: 0;
    font-size: ${fontSize.lg}px;
  }
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
`

const Grid = styled.div`
  display: grid;
  gap: ${space.md}px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
`

const Swatch = styled.span<{ $color: string }>`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: ${({ $color }) => $color};
`

const StopBox = styled.div`
  padding: ${space.sm + 2}px ${space.md}px;
  margin-bottom: ${space.xs}px;
  border: 1px solid ${color.line};
  border-radius: 12px;
  background: ${color.paper};
`

const Mono = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const FormatList = styled.dl`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space.xs}px ${space.lg}px;
  margin: 0;
  font-size: ${fontSize.sm + 1}px;
  dt {
    color: ${color.muted};
    font-family: ${font.mono};
  }
  dd {
    margin: 0;
  }
`

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section>
      <h2>{title}</h2>
      {children}
    </Section>
  )
}

type Category = 'eat' | 'buy' | 'see'

/** Function name and its output, for the formats block */
const formatSamples = (locale: Locale): [string, string][] => [
  ['formatMoney', formatMoney(4250, 'AUD', locale, { secondary: { minor: 88690, currency: 'TWD' } })],
  ['formatMoney', formatMoney(150000, 'IDR', locale)],
  ['formatDate', formatDate('2026-11-09', locale)],
  ['formatDateRange', formatDateRange('2026-11-09', '2026-11-22', locale)],
  ['formatTime', formatTime('07:05', locale)],
  ['formatDuration', formatDuration(200, locale)],
  ['formatDistance', `${formatDistance(95230, locale)} · ${formatDistance(640, locale)}`],
  ['formatTzAbbrev', formatTzAbbrev('Pacific/Auckland', locale, new Date('2026-11-09T00:00:00Z'))],
]

function Gallery({ scheme }: { scheme: 'light' | 'dark' }) {
  const t = useT()
  const toast = useToast()
  const [tab, setTab] = useState<'itinerary' | 'ledger'>('itinerary')
  const [segment, setSegment] = useState<'all' | 'day'>('all')
  const [day, setDay] = useState(0)
  const [amount, setAmount] = useState<number | null>(4250)
  const [currency, setCurrency] = useState<CurrencyCode>('AUD')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [filter, setFilter] = useState<Category>('eat')
  const id = `ui-${scheme}`
  const locale = t.locale

  return (
    <ThemePanel data-theme={scheme}>
      <PanelLabel>{t(scheme === 'light' ? 'theme.light' : 'theme.dark')}</PanelLabel>

      <Block title={t('dev.ui.buttons')}>
        <Row>
          <Button variant="primary">{t('term.logExpense')}</Button>
          <Button>{t('common.edit')}</Button>
          <Button variant="ghost">{t('common.cancel')}</Button>
          <Button variant="danger">{t('common.delete')}</Button>
        </Row>
        <Row>
          <Button size="sm" variant="primary">
            {t('dev.ui.small')}
          </Button>
          <Button size="lg" variant="primary">
            <PlusIcon size={18} />
            {t('dev.ui.large')}
          </Button>
          <Button disabled>{t('dev.ui.disabled')}</Button>
          <IconButton label={t('common.add')} icon={<PlusIcon />} variant="primary" />
          <IconButton label={t('term.stop')} icon={<MapPinIcon />} variant="secondary" />
          <IconButton label={t('common.delete')} icon={<TrashIcon />} />
        </Row>
      </Block>

      <Block title={t('dev.ui.fields')}>
        <Grid>
          <Input
            label={t('dev.ui.placeName')}
            hint={t('dev.ui.placeHint')}
            placeholder={t('dev.ui.placePlaceholder')}
            id={`${id}-place`}
          />
          <Input label={t('term.lodging')} error={t('dev.ui.errorExample')} id={`${id}-lodging`} />
          <Select label={t('dev.ui.category')} defaultValue="eat" id={`${id}-category`}>
            <option value="eat">{t('term.mustEat')}</option>
            <option value="buy">{t('term.mustBuy')}</option>
            <option value="see">{t('term.mustSee')}</option>
          </Select>
          <DateField label={t('dev.ui.date')} defaultValue="2026-11-09" id={`${id}-date`} />
          <TimeField label={t('dev.ui.time')} defaultValue="14:05" optional id={`${id}-time`} />
          <MoneyField
            label={t('money.amount')}
            value={amount}
            currency={currency}
            onChange={setAmount}
            onCurrencyChange={setCurrency}
            id={`${id}-money`}
          />
        </Grid>
      </Block>

      <Block title={t('dev.ui.surfaces')}>
        <Grid>
          <Card $interactive $accent={dayColor(2)}>
            <CardTitle>{t('dev.ui.cardTitle')}</CardTitle>
            <CardText>{t('dev.ui.cardBody')}</CardText>
          </Card>
          <Card>
            <Row>
              <Chip tone="fjord">{t('term.booking')}</Chip>
              <Chip tone="warning">{t('term.cancelBy')}</Chip>
              <Chip tone="tussock">{t('term.sharedFund')}</Chip>
              <Chip>
                <Mono>{currency}</Mono>
              </Chip>
            </Row>
          </Card>
        </Grid>
        <Row>
          <Button onClick={() => setSheetOpen(true)}>{t('dev.ui.openSheet')}</Button>
          <Button onClick={() => setDialogOpen(true)}>{t('dev.ui.openDialog')}</Button>
        </Row>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t('term.logExpense')}
          actions={
            <>
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={() => setSheetOpen(false)}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <p>{t('dev.ui.sheetBody')}</p>
          <MoneyField
            label={t('money.amount')}
            value={amount}
            currency={currency}
            onChange={setAmount}
            onCurrencyChange={setCurrency}
            id={`${id}-sheet-money`}
          />
        </Sheet>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title={t('dev.ui.dialogTitle')}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p>{t('dev.ui.dialogBody')}</p>
        </Dialog>
      </Block>

      <Block title={t('dev.ui.navigation')}>
        <Tabs
          label={t('term.trip')}
          idPrefix={`${id}-tabs`}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'itinerary', label: t('term.itinerary') },
            { value: 'ledger', label: t('term.balance') },
          ]}
        />
        <div role="tabpanel" id={`${id}-tabs-panel-${tab}`} aria-labelledby={`${id}-tabs-tab-${tab}`}>
          <CardText>{tab === 'itinerary' ? t.plural('count.stops', 3) : t.plural('count.members', 1)}</CardText>
        </div>
        <Row>
          <SegmentedControl
            label={t('term.itinerary')}
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'all', label: t('term.trip') },
              { value: 'day', label: t('day.short', { n: 1 }) },
            ]}
          />
          <Chip tone="fjord" selected={filter === 'eat'} onClick={() => setFilter('eat')}>
            {t('term.mustEat')}
          </Chip>
          <Chip tone="fjord" selected={filter === 'buy'} onClick={() => setFilter('buy')}>
            {t('term.mustBuy')}
          </Chip>
          <Chip tone="fjord" selected={filter === 'see'} onClick={() => setFilter('see')}>
            {t('term.mustSee')}
          </Chip>
        </Row>
        <Row>
          <LanguageSwitch />
          <ThemeSwitch />
        </Row>
      </Block>

      <Block title={t('dev.ui.people')}>
        <Row>
          <Avatar name="Gene" colorIndex={0} size="lg" />
          <Avatar name="mia" colorIndex={1} />
          <AvatarGroup>
            {['Kai', 'Lena', 'Omar', 'Pita'].map((name, index) => (
              <Avatar key={name} name={name} colorIndex={index + 3} size="sm" />
            ))}
          </AvatarGroup>
        </Row>
        <Row>
          {dayColors.map((swatch) => (
            <Swatch key={swatch} $color={swatch} />
          ))}
        </Row>
        <Row>
          {[0, 1, 2, 3].map((index) => (
            <DayChip
              key={index}
              index={index}
              date={formatDate(`2026-11-${String(9 + index).padStart(2, '0')}`, locale)}
              title={index === 2 ? t('dev.ui.dayTitle') : undefined}
              selected={day === index}
              onClick={() => setDay(index)}
            />
          ))}
        </Row>
      </Block>

      <Block title={t('dev.ui.timeline')}>
        <Timeline>
          {(['dev.ui.stopA', 'dev.ui.stopB', 'dev.ui.stopC'] as const).map((key, index) => (
            <TimelineItem key={key} color={dayColor(day)}>
              <StopBox>
                <Row>
                  <strong>{t(key)}</strong>
                  <Spacer />
                  <Mono>{formatTime(['09:30', '13:10', '16:45'][index], locale)}</Mono>
                </Row>
              </StopBox>
              {index < 2 && (
                <CardText>
                  <Mono>
                    {formatDuration([200, 95][index], locale)} · {formatDistance([228400, 104700][index], locale)}
                  </Mono>
                </CardText>
              )}
            </TimelineItem>
          ))}
        </Timeline>
      </Block>

      <Block title={t('dev.ui.feedback')}>
        <Row>
          <Button onClick={() => toast.show(t('dev.ui.toastMessage'), { tone: 'success' })}>
            {t('dev.ui.showToast')}
          </Button>
        </Row>
        <div aria-busy="true" aria-label={t('common.loading')}>
          <Grid>
            <Skeleton $height={120} $radius="card" />
            <div>
              <Skeleton $width="60%" $height={18} />
              <br />
              <Skeleton />
              <br />
              <Skeleton $width="80%" />
            </div>
          </Grid>
        </div>
        <EmptyState
          illustration="receipt"
          title={t('dev.ui.emptyTitle')}
          body={t('dev.ui.emptyBody')}
          action={<Button variant="primary">{t('term.logExpense')}</Button>}
        />
        <Grid>
          <EmptyState illustration="suitcase" title={t('term.packingList')} />
          <EmptyState illustration="pin" title={t('term.pocketList')} />
        </Grid>
      </Block>

      <Block title={t('dev.ui.formats')}>
        <FormatList>
          {formatSamples(locale).map(([name, value], index) => (
            <Fragment key={index}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </FormatList>
      </Block>
    </ThemePanel>
  )
}

/** The map (e3-t03) on the sample trip; lazy, so the maplibre chunk loads only here */
function MapShowcase() {
  const t = useT()
  const toast = useToast()
  const [view, setView] = useState<'trip' | 'day'>('trip')
  const [day, setDay] = useState(0)
  const [layers, setLayers] = useState<MapLayers>({
    itinerary: true,
    pocket: true,
    lodging: true,
    picks: true,
    fuel: false,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const places = [...sampleStops, ...samplePocket, ...sampleLodging, ...samplePicks, ...sampleFuel]

  const onAction = (id: string, action: MapAction) => {
    const place = places.find((item) => item.id === id)
    if (!place) return
    if (action === 'openGoogleMaps') window.open(googleMapsUrl(place), '_blank', 'noopener')
    else toast.show(t('map.showcaseScheduled', { name: place.name }), { tone: 'success' })
  }
  const onLongPress = ({ lat, lng }: MapPoint) =>
    toast.show(t('map.showcaseDropped', { coords: `${lat.toFixed(4)}, ${lng.toFixed(4)}` }))

  return (
    <MapPanel>
      <Block title={t('map.showcaseTitle')}>
        <p>{t('map.showcaseHint')}</p>
        <Row>
          <SegmentedControl
            label={t('map.viewMode')}
            value={view}
            onChange={setView}
            options={[
              { value: 'trip', label: t('map.trip') },
              { value: 'day', label: t('day.short', { n: day + 1 }) },
            ]}
          />
        </Row>
        <Row>
          {Array.from({ length: SAMPLE_DAY_COUNT }, (_, index) => (
            <DayChip
              key={index}
              index={index}
              selected={view === 'day' && day === index}
              onClick={() => {
                setDay(index)
                setView('day')
              }}
            />
          ))}
        </Row>
        <Row role="group" aria-label={t('map.layers')}>
          {MAP_LAYER_KEYS.map((key) => (
            <Chip
              key={key}
              tone="fjord"
              selected={layers[key]}
              onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
            >
              {t(LAYER_LABEL_KEYS[key])}
            </Chip>
          ))}
        </Row>
        <MapBox>
          <Suspense fallback={<Skeleton $height={480} $radius="card" />}>
            <LazyTripMap
              stops={sampleStops}
              routes={sampleRoutes}
              overnightLinks={sampleOvernightLinks}
              pocket={samplePocket}
              lodging={sampleLodging}
              picks={samplePicks}
              fuel={sampleFuel}
              mode={view === 'trip' ? 'trip' : { day }}
              layers={layers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAction={onAction}
              onLongPress={onLongPress}
              height="480px"
            />
          </Suspense>
        </MapBox>
      </Block>
    </MapPanel>
  )
}

const MapPanel = styled.div`
  margin-top: ${space.xl}px;
  padding: ${space.xl}px;
  border-radius: ${radius.cover}px;
  border: 1px solid ${color.line};
  background: ${color.paper};
  color: ${color.ink};
  p {
    margin: 0;
    color: ${color.muted};
  }
`

const MapBox = styled.div`
  min-width: 0;
`

export default function UiShowcase() {
  const t = useT()
  return (
    <Page>
      <Bar>
        <h1>{t('dev.ui.title')}</h1>
        <Spacer />
        <LanguageSwitch />
        <ThemeSwitch />
        <p>{t('dev.ui.intro')}</p>
      </Bar>
      <Columns>
        <Gallery scheme="light" />
        <Gallery scheme="dark" />
      </Columns>
      <MapShowcase />
    </Page>
  )
}
