import { useEffect, useState } from 'react'

type VisualViewportState = {
  viewportHeight: number | null
  keyboardInset: number
  hasVisualViewport: boolean
}

function readVisualViewportState(): VisualViewportState {
  if (typeof window === 'undefined') {
    return {
      viewportHeight: null,
      keyboardInset: 0,
      hasVisualViewport: false,
    }
  }

  const viewport = window.visualViewport
  if (!viewport) {
    return {
      viewportHeight: null,
      keyboardInset: 0,
      hasVisualViewport: false,
    }
  }

  const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
  return {
    viewportHeight: Math.round(viewport.height),
    keyboardInset: Math.round(keyboardInset),
    hasVisualViewport: true,
  }
}

export function useVisualViewport() {
  const [state, setState] = useState<VisualViewportState>(() => readVisualViewportState())

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) {
      return
    }

    const update = () => setState(readVisualViewportState())
    update()

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return state
}
