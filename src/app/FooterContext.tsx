import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type FooterContextValue = {
  footer: ReactNode | null
  setFooter: (node: ReactNode | null) => void
}

const FooterContext = createContext<FooterContextValue>({
  footer: null,
  setFooter: () => {},
})

export function FooterProvider({ children }: { children: ReactNode }) {
  const [footer, setFooter] = useState<ReactNode | null>(null)

  const value = useMemo(
    () => ({
      footer,
      setFooter,
    }),
    [footer],
  )

  return <FooterContext.Provider value={value}>{children}</FooterContext.Provider>
}

export function useFooter() {
  return useContext(FooterContext)
}
