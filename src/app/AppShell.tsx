import type { ReactNode, Ref } from 'react'
import { useFooter } from './FooterContext'

type AppShellProps = {
  header: ReactNode
  children: ReactNode
  mainRef?: Ref<HTMLElement>
  onMainScroll?: () => void
}

export function AppShell({ header, children, mainRef, onMainScroll }: AppShellProps) {
  const { footer } = useFooter()

  return (
    <div className="app-shell">
      <header className="app-header">{header}</header>
      <main
        className={footer ? 'app-main app-main--with-footer' : 'app-main'}
        ref={mainRef}
        onScroll={onMainScroll}
      >
        {children}
      </main>
      {footer ? <div className="app-footer">{footer}</div> : null}
    </div>
  )
}
