import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, EmptyState } from '../components/index.ts'
import { useT } from '../lib/i18n.ts'

function Fallback({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <EmptyState
      title={t('error.title')}
      body={t('error.body')}
      illustration="pin"
      action={
        <Button variant="primary" onClick={onRetry}>
          {t('error.reload')}
        </Button>
      }
    />
  )
}

interface Props {
  children: ReactNode
  /** Changing it clears a caught error (the route path: moving on leaves a broken page behind) */
  resetKey?: string
}

interface State {
  error: unknown
  resetKey?: string
}

/** Catches render errors (and failed lazy page chunks) so one broken page does not blank the app */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) return <Fallback onRetry={() => window.location.reload()} />
    return this.props.children
  }
}
