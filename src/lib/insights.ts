import type { WeekEntry } from './weekEntry'

const STOPWORDS_DE = new Set([
  'und',
  'oder',
  'aber',
  'weil',
  'dass',
  'auch',
  'noch',
  'sehr',
  'mehr',
  'wird',
  'wurde',
  'sind',
  'sein',
  'eine',
  'einen',
  'einem',
  'einer',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'mit',
  'für',
  'auf',
  'im',
  'in',
  'am',
  'an',
  'zu',
  'von',
  'bei',
  'als',
  'ist',
  'war',
  'haben',
  'hatte',
  'nicht',
  'kein',
  'keine',
])

export type TokenCount = {
  token: string
  count: number
}

export function tokenizeForInsights(text: string | null | undefined): string[] {
  if (!text) {
    return []
  }

  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()

  if (!normalized) {
    return []
  }

  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS_DE.has(token))
}

function collectTopTokens(texts: Array<string | null | undefined>, limit = 5): TokenCount[] {
  const counts = new Map<string, number>()

  for (const text of texts) {
    const tokens = tokenizeForInsights(text)
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }
      return a.token.localeCompare(b.token, 'de')
    })
    .slice(0, limit)
}

export function getTopBottleneckTokens(entries: WeekEntry[], limit = 5): TokenCount[] {
  return collectTopTokens(
    entries.map((entry) => entry.bottleneck),
    limit,
  )
}

export function getTopIntentionallyNotDoingTokens(entries: WeekEntry[], limit = 5): TokenCount[] {
  return collectTopTokens(
    entries.map((entry) => entry.intentionallyNotDoing),
    limit,
  )
}

export function formatTopTokens(tokens: TokenCount[]): string {
  if (tokens.length === 0) {
    return ''
  }
  return tokens.map((item) => `${item.token} (${item.count})`).join(' · ')
}

export function runInsightsSelfCheck(): boolean {
  const sample = [
    'Schlaf, Schlaf und Termine!',
    'Krankheitswoche, Termine im Büro.',
    'Nicht alles perfekt machen.',
  ]

  const top = collectTopTokens(sample, 3)
  return top.length > 0 && top[0].token === 'schlaf' && top[0].count === 2
}
