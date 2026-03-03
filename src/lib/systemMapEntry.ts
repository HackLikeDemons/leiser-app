export type Domain = 'HEALTH' | 'WORK' | 'LOVE' | 'PLAY'

export type SystemMapLink = {
  from: Domain
  to: Domain
  note?: string
}

export type DomainNotes = {
  bullets: string[]
}

export type SystemMapDomains = Record<Domain, DomainNotes>

export type SystemMapEntry = {
  id: string
  createdAt: string
  updatedAt: string
  periodISO: string
  domains: SystemMapDomains
  links: SystemMapLink[]
  leverage?: string
}

export type SystemMapDraft = {
  domains: SystemMapDomains
  links: SystemMapLink[]
  leverage: string
}

export const DOMAINS: Domain[] = ['HEALTH', 'WORK', 'LOVE', 'PLAY']

export const DEFAULT_SYSTEM_MAP_DRAFT: SystemMapDraft = {
  domains: {
    HEALTH: { bullets: [] },
    WORK: { bullets: [] },
    LOVE: { bullets: [] },
    PLAY: { bullets: [] },
  },
  links: [],
  leverage: '',
}
