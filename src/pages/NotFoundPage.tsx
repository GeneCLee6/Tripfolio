import { ButtonLink } from '../components/ButtonLink.tsx'
import { EmptyState } from '../components/index.ts'
import { useT } from '../lib/i18n.ts'
import { Page } from '../app/TopBar.tsx'

/** Any address the router does not know */
export default function NotFoundPage() {
  const t = useT()
  return (
    <Page $width={720}>
      <EmptyState
        illustration="pin"
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <ButtonLink to="/" variant="primary">
            {t('shell.home')}
          </ButtonLink>
        }
      />
    </Page>
  )
}
