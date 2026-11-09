import { lazy, Suspense } from 'react'
import type { Trip } from '../../../shared/api/types.ts'
import { Dialog, Skeleton } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'

// The trip form in a Dialog (tablet and desktop); the form and zod load only when it first opens

const TripForm = lazy(() => import('./TripForm.tsx'))

export function TripFormDialog({
  open,
  trip,
  onClose,
  onDone,
}: {
  open: boolean
  trip?: Trip
  onClose: () => void
  onDone: (trip: Trip) => void
}) {
  const t = useT()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={trip ? t('tripForm.editTitle') : t('tripForm.createTitle')}
    >
      {open && (
        <Suspense fallback={<Skeleton $height={240} />}>
          <TripForm trip={trip} onDone={onDone} onCancel={onClose} />
        </Suspense>
      )}
    </Dialog>
  )
}
