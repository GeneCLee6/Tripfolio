import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, Skeleton } from '../components/index.ts'
import { ButtonLink } from '../components/ButtonLink.tsx'
import { Page } from '../app/TopBar.tsx'
import { tripPath } from '../app/sections.ts'
import { api } from '../lib/api.ts'
import { errorMessageKey, isAccessError } from '../lib/errors.ts'
import { useResource } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { PageHeading, Stack } from './parts.tsx'
import { TripForm } from './trip-form/TripForm.tsx'

// /trips/new and /trips/:id/edit: the trip form as a page (phones; any width by direct link)

function EditTrip({ id }: { id: string }) {
  const t = useT()
  const navigate = useNavigate()
  const resource = useResource(`trip:${id}`, (signal) => api.getTrip(id, signal))
  if (resource.status === 'loading') return <Skeleton $height={320} />
  if (resource.status === 'error') {
    const access = isAccessError(resource.error)
    const { key, code } = errorMessageKey(resource.error)
    return (
      <EmptyState
        illustration="pin"
        title={access ? t('tripAccess.title') : t('error.title')}
        body={access ? t('tripAccess.body') : t(key, { code })}
        action={
          access ? (
            <ButtonLink to="/" variant="primary">
              {t('shell.home')}
            </ButtonLink>
          ) : (
            <Button variant="primary" onClick={resource.reload}>
              {t('error.retry')}
            </Button>
          )
        }
      />
    )
  }
  const trip = resource.data.trip
  return (
    <TripForm
      trip={trip}
      onDone={(saved) => navigate(tripPath(saved.id), { replace: true })}
      onCancel={() => navigate(tripPath(trip.id))}
    />
  )
}

export default function TripFormPage() {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams()
  return (
    <Page $width={720}>
      <Stack>
        <PageHeading title={id ? t('tripForm.editTitle') : t('tripForm.createTitle')} />
        {id ? (
          <EditTrip id={id} />
        ) : (
          <TripForm
            onDone={(trip) => navigate(tripPath(trip.id), { replace: true })}
            onCancel={() => navigate('/')}
          />
        )}
      </Stack>
    </Page>
  )
}
