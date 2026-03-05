import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadRuntimeConfig } from './lib/runtimeConfig'
import './styles/global.css'

async function bootstrap() {
  await loadRuntimeConfig()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
