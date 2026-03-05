import type { CSSProperties, ReactNode, Ref } from 'react'
import { useFooter } from './FooterContext'
import { useVisualViewport } from '../hooks/useVisualViewport'

type AppShellProps = {
  header: ReactNode
  children: ReactNode
  updateNotice?: ReactNode
  mainRef?: Ref<HTMLElement>
  onMainScroll?: () => void
}

export function AppShell({ header, children, updateNotice, mainRef, onMainScroll }: AppShellProps) {
  const { footer } = useFooter()
  const { viewportHeight, keyboardInset, hasVisualViewport } = useVisualViewport()
  const shellStyle = {
    '--keyboard-inset': hasVisualViewport ? '0px' : `${keyboardInset}px`,
    ...(hasVisualViewport && viewportHeight ? { '--vvh': `${viewportHeight}px` } : {}),
  } as CSSProperties

  return (
    <div className="app-shell" style={shellStyle}>
      <header className="app-header">{header}</header>
      <main
        className={footer ? 'app-main app-main--with-footer' : 'app-main'}
        ref={mainRef}
        onScroll={onMainScroll}
      >
        {children}
      </main>
      {updateNotice ? (
        <div className={footer ? 'app-update-bar app-update-bar--with-footer' : 'app-update-bar'}>
          {updateNotice}
        </div>
      ) : null}
      {footer ? <div className="app-footer">{footer}</div> : null}
    </div>
  )
}
