import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadRuntimeConfig } from './lib/runtimeConfig'
import './styles/global.css'

const THEME_KEY = 'leiser:theme'

function resolveInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') {
    return stored
  }
  return 'dark'
}

document.documentElement.dataset.theme = resolveInitialTheme()

async function bootstrap() {
  await loadRuntimeConfig()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
