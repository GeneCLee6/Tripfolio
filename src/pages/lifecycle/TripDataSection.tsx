import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Dialog, useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { useT } from '../../lib/i18n.ts'
import { lifecycleApi } from '../../lib/lifecycle/api.ts'
import { saveBlob } from '../../lib/lifecycle/files.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { SectionTitle, Stack } from '../parts.tsx'
import { CalendarSection } from './CalendarSection.tsx'
import { CloneSheet } from './CloneSheet.tsx'
import { Actions, Block, BlockTitle, CheckOption, Muted, Options, PrivacyLink } from './parts.tsx'

// Settings → 旅程檔案 (e8-t03, e1-t07, e8-t05): export the trip file (editor; archived trips too),
// copy it as a template (editor), download the calendar (any member), delete the trip (owner; a
// soft delete restorable for 30 days from the trip list). The Worker decides; these only hide what
// a role could not do.

export function TripDataSection() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const showError = useApiErrorToast()
  const { trip, me } = useTripContext()
  const can = useCan()
  const canEdit = me.role !== 'viewer'
  const isOwner = can('delete')
  const [expenses, setExpenses] = useState(false)
  const [photos, setPhotos] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function exportFile() {
    setExporting(true)
    try {
      const file = await lifecycleApi.exportTrip(trip.id, { expenses, photos })
      saveBlob(file.blob, file.fileName)
      toast.show(t('lifecycle.export.done', { file: file.fileName }), { tone: 'success' })
    } catch (error) {
      showError(error)
    } finally {
      setExporting(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await lifecycleApi.deleteTrip(trip.id)
      toast.show(t('lifecycle.delete.done'), { tone: 'success' })
      setConfirming(false)
      navigate('/')
    } catch (error) {
      showError(error)
      setDeleting(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="settings-lifecycle">
      <Stack $gap="lg">
        <Stack $gap="sm">
          <SectionTitle id="settings-lifecycle">{t('lifecycle.data.title')}</SectionTitle>
          <Muted>{t('lifecycle.data.body')}</Muted>
          {!canEdit && <Muted>{t('lifecycle.viewerOnly')}</Muted>}
        </Stack>

        {canEdit && (
          <Block>
            <BlockTitle>{t('lifecycle.export.title')}</BlockTitle>
            <Muted>{t('lifecycle.export.body')}</Muted>
            <Options>
              <CheckOption
                label={t('lifecycle.export.expenses')}
                hint={t('lifecycle.export.expensesHint')}
                checked={expenses}
                onChange={setExpenses}
              />
              <CheckOption
                label={t('lifecycle.export.photos')}
                hint={t('lifecycle.export.photosHint')}
                checked={photos}
                onChange={setPhotos}
              />
            </Options>
            <Actions>
              <Button size="sm" onClick={exportFile} disabled={exporting}>
                {exporting ? t('lifecycle.export.working') : t('lifecycle.export.action')}
              </Button>
            </Actions>
          </Block>
        )}

        {canEdit && (
          <Block>
            <BlockTitle>{t('lifecycle.clone.title')}</BlockTitle>
            <Muted>{t('lifecycle.clone.body')}</Muted>
            <Actions>
              <Button size="sm" onClick={() => setCloning(true)}>
                {t('lifecycle.clone.action')}
              </Button>
            </Actions>
          </Block>
        )}

        <CalendarSection tripId={trip.id} />

        <Block>
          <BlockTitle>{t('lifecycle.delete.title')}</BlockTitle>
          <Muted>{t('lifecycle.delete.body')}</Muted>
          {isOwner ? (
            <Actions>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('lifecycle.delete.action')}
              </Button>
            </Actions>
          ) : (
            <Muted>{t('lifecycle.delete.ownerOnly')}</Muted>
          )}
        </Block>

        <div>
          <PrivacyLink>{t('lifecycle.privacyLink')}</PrivacyLink>
        </div>
      </Stack>

      {cloning && <CloneSheet trip={trip} onClose={() => setCloning(false)} />}

      {isOwner && (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={t('lifecycle.delete.confirmTitle', { name: trip.name })}
          actions={
            <>
              <Button onClick={() => setConfirming(false)} disabled={deleting}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={remove} disabled={deleting}>
                {deleting ? t('lifecycle.delete.working') : t('lifecycle.delete.confirm')}
              </Button>
            </>
          }
        >
          <Muted>{t('lifecycle.delete.body')}</Muted>
        </Dialog>
      )}
    </Card>
  )
}
