import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export function createSupabaseClient(syncToken?: string) {
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

