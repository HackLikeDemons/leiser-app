import { useEffect, useRef, useState } from 'react'
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
  const { hasVisualViewport } = useVisualViewport()
  const headerRef = useRef<HTMLElement | null>(null)
  const footerRef = useRef<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)

  useEffect(() => {
    const updateHeights = () => {
      setHeaderHeight(Math.round(headerRef.current?.offsetHeight ?? 0))
      setFooterHeight(Math.round(footerRef.current?.offsetHeight ?? 0))
    }

    updateHeights()
    window.addEventListener('resize', updateHeights)

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeights) : null
    if (headerRef.current && observer) {
      observer.observe(headerRef.current)
    }
    if (footerRef.current && observer) {
      observer.observe(footerRef.current)
    }

    return () => {
      window.removeEventListener('resize', updateHeights)
      observer?.disconnect()
    }
  }, [footer])

  const shellStyle = {
    '--keyboard-inset': hasVisualViewport ? '0px' : '0px',
    '--header-height': `${headerHeight}px`,
    '--footer-height': `${footerHeight}px`,
  } as CSSProperties

  return (
    <div className="app-shell" style={shellStyle}>
      <header ref={headerRef} className="app-header">{header}</header>
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
      {footer ? <div ref={footerRef} className="app-footer">{footer}</div> : null}
    </div>
  )
}
