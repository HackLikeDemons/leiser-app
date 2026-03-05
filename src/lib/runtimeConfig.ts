type RuntimePublicConfig = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

type SupabaseConfigSource = 'runtime' | 'vite' | 'none'

let runtimeConfig: RuntimePublicConfig | null = null
let loadAttempted = false

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function loadRuntimeConfig() {
  if (loadAttempted || typeof window === 'undefined') {
    return
  }
  loadAttempted = true

  try {
    const response = await fetch('/config/runtime.json', { cache: 'no-store' })
    if (!response.ok) {
      return
    }
    const parsed = (await response.json()) as unknown
    if (parsed && typeof parsed === 'object') {
      runtimeConfig = parsed as RuntimePublicConfig
    }
  } catch {
    // Optional runtime config; ignore fetch/parse errors.
  }
}

export function getSupabaseRuntimeConfig() {
  const runtimeUrl = clean(runtimeConfig?.supabaseUrl) || clean(runtimeConfig?.VITE_SUPABASE_URL)
  const runtimeKey = clean(runtimeConfig?.supabasePublishableKey) || clean(runtimeConfig?.VITE_SUPABASE_PUBLISHABLE_KEY)
  const viteUrl = clean(import.meta.env.VITE_SUPABASE_URL)
  const viteKey = clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const url = runtimeUrl || viteUrl
  const publishableKey = runtimeKey || viteKey
  const configured = Boolean(url && publishableKey)
  const source: SupabaseConfigSource = runtimeUrl || runtimeKey ? 'runtime' : configured ? 'vite' : 'none'

  return { url, publishableKey, configured, source }
}
