import { createClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from '../runtimeConfig'

export function createSupabaseClient(syncToken?: string) {
  const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = getSupabaseRuntimeConfig()
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null
  }

  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: {
      headers: syncToken
        ? {
            'x-leiser-token': syncToken,
          }
        : {},
    },
  })
}
