const ADJECTIVES = [
  'Klar',
  'Leise',
  'Sicher',
  'Heller',
  'Sanfter',
  'Ruhiger',
  'Starker',
  'Freier',
  'Wacher',
  'Treuer',
]

const NOUNS = [
  'Falke',
  'Anker',
  'Kompass',
  'Hafen',
  'Pfad',
  'Orbit',
  'Signal',
  'Nordstern',
  'Atlas',
  'Leuchtturm',
]

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function getSyncRoomAlias(roomId: string): string {
  const value = roomId.trim()
  if (!value) {
    return 'Unbekannter Raum'
  }
  if (value === 'default') {
    return 'Standardraum'
  }

  const hash = fnv1a32(value)
  const adjective = ADJECTIVES[hash % ADJECTIVES.length]
  const noun = NOUNS[Math.floor(hash / ADJECTIVES.length) % NOUNS.length]
  const suffix = String((Math.floor(hash / (ADJECTIVES.length * NOUNS.length)) % 90) + 10)
  return `${adjective} ${noun} ${suffix}`
}
