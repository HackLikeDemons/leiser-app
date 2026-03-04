import type { ReactNode } from 'react'
import { useFooter } from './FooterContext'

type AppShellProps = {
  header: ReactNode
  children: ReactNode
}

export function AppShell({ header, children }: AppShellProps) {
  const { footer } = useFooter()

  return (
    <div className="app-shell">
      <header className="app-header">{header}</header>
      <main className={footer ? 'app-main app-main--with-footer' : 'app-main'}>{children}</main>
      {footer ? <div className="app-footer">{footer}</div> : null}
    </div>
  )
}
