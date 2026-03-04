import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type SyncRow = {
  seq?: number
  room_id: string
  note_id: string
  change_id: string
  device_id: string
  ts: number
  kind: string
  payload: string[]
  token_hash: string
  signer_device_id: string | null
  signer_public_key: string | null
  signature: string | null
}

const URL_KEY = 'leiser:supabaseUrl'
const ANON_KEY = 'leiser:supabaseAnonKey'
const TABLE = 'sync_changes'

function readConfig() {
  const url = localStorage.getItem(URL_KEY)?.trim() || import.meta.env.VITE_SUPABASE_URL || ''
  const anonKey = localStorage.getItem(ANON_KEY)?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !anonKey) {
    return null
  }
  return { url, anonKey }
}

export function makeSupabaseClient(syncToken: string): SupabaseClient | null {
  const cfg = readConfig()
  if (!cfg) {
    return null
  }
  return createClient(cfg.url, cfg.anonKey, {
    global: {
      headers: {
        'x-leiser-token': syncToken,
      },
    },
  })
}

export async function pushRemoteRows(client: SupabaseClient, rows: SyncRow[]) {
  if (rows.length === 0) {
    return
  }
  const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'change_id' })
  if (error) {
    throw new Error(error.message)
  }
}

export async function pullRemoteRows(client: SupabaseClient, roomId: string, sinceSeq: number, limit = 200) {
  const { data, error } = await client
    .from(TABLE)
    .select(
      'seq, room_id, note_id, change_id, device_id, ts, kind, payload, token_hash, signer_device_id, signer_public_key, signature',
    )
    .eq('room_id', roomId)
    .gt('seq', sinceSeq)
    .order('seq', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as SyncRow[]
}

export type { SyncRow }
