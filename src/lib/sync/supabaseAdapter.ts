import { createSupabaseClient } from './supabaseClient'
import { sha256Hex } from './tokenHash'

export type SyncBlob = {
  version: 1
  changes: unknown[]
}

export type PulledSyncState = {
  blob: SyncBlob
  version: number
}

const REMOTE_CHANGED_ERROR = 'REMOTE_CHANGED'

export async function pushSync(
  syncId: string,
  syncToken: string,
  blob: SyncBlob,
  expectedVersion: number,
) {
  const supabase = createSupabaseClient(syncToken)
  if (!supabase) {
    throw new Error('Supabase nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).')
  }

  const token_hash = await sha256Hex(syncToken)

  // optimistic update: only write when remote version is what we pulled before
  const { data: updatedRows, error: updateError } = await supabase
    .from('sync_spaces')
    .update({ blob, token_hash })
    .eq('sync_id', syncId)
    .eq('version', expectedVersion)
    .select('sync_id')

  if (updateError) {
    console.error('Supabase pushSync update error', updateError)
    throw updateError
  }

  if ((updatedRows?.length ?? 0) > 0) {
    return
  }

  // if no row matched, either row does not exist (first insert) or remote changed in between
  const { error: insertError } = await supabase.from('sync_spaces').insert({
    sync_id: syncId,
    blob,
    token_hash,
    version: 0,
  })

  if (!insertError) {
    return
  }

  // unique conflict means row already exists => remote changed concurrently
  if (insertError.code === '23505') {
    throw new Error(REMOTE_CHANGED_ERROR)
  }

  console.error('Supabase pushSync insert error', insertError)
  throw new Error(insertError.message)
}

export async function pullSync(syncId: string, syncToken: string) {
  const supabase = createSupabaseClient(syncToken)
  if (!supabase) {
    throw new Error('Supabase nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).')
  }

  const { data, error } = await supabase
    .from('sync_spaces')
    .select('blob, version')
    .eq('sync_id', syncId)
    .maybeSingle()

  if (error) {
    console.error('Supabase pullSync error', error)
    throw error
  }

  if (!data) {
    return null
  }

  return {
    blob: data.blob as SyncBlob,
    version: typeof data.version === 'number' ? data.version : 0,
  } as PulledSyncState
}

export { REMOTE_CHANGED_ERROR }
