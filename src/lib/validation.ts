import { z } from 'zod'

export const riotConnectSchema = z.object({
  gameName: z.string().min(3).max(16),
  tagLine: z.string().min(2).max(5),
  region: z.enum(['BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'NA1', 'OC1', 'PH2', 'RU', 'SG2', 'TH2', 'TR1', 'TW2', 'VN2']),
})

export const regionDisplayNames: Record<string, string> = {
  BR1: 'Brazil',
  EUN1: 'EU Nordic & East',
  EUW1: 'EU West',
  JP1: 'Japan',
  KR: 'Korea',
  LA1: 'Latin America North',
  LA2: 'Latin America South',
  NA1: 'North America',
  OC1: 'Oceania',
  PH2: 'Philippines',
  RU: 'Russia',
  SG2: 'Singapore',
  TH2: 'Thailand',
  TR1: 'Turkey',
  TW2: 'Taiwan',
  VN2: 'Vietnam',
}

export const regionToRoutingValue: Record<string, string> = {
  BR1: 'americas',
  LA1: 'americas',
  LA2: 'americas',
  NA1: 'americas',
  OC1: 'sea',
  PH2: 'sea',
  SG2: 'sea',
  TH2: 'sea',
  TW2: 'sea',
  VN2: 'sea',
  JP1: 'asia',
  KR: 'asia',
  EUN1: 'europe',
  EUW1: 'europe',
  RU: 'europe',
  TR1: 'europe',
}

export const apiKeySchema = z.object({
  service: z.enum(['riot', 'openai']),
  key: z.string().min(10),
})

export const sessionCreateSchema = z.object({
  objectiveId: z.string().min(1),
  subObjective: z.string().optional(),
  customNote: z.string().max(500).optional(),
})

export const timelineNoteSchema = z.object({
  time: z.string().regex(/^\d{1,3}:\d{2}$/, 'Format: M:SS or MM:SS'),
  note: z.string().min(1).max(500),
})

export const reviewSchema = z.object({
  gameId: z.string().min(1),
  timelineNotes: z.array(timelineNoteSchema),
  kpiScores: z.record(z.string(), z.number().min(1).max(5)),
  freeText: z.string().max(2000).optional(),
  objectiveRespected: z.boolean(),
})

export const assessmentScoreSchema = z.object({
  fundamentalId: z.string().min(1),
  subcategoryId: z.string().optional(),
  score: z.number().int().min(1).max(5),
})

export const assessmentSchema = z.array(assessmentScoreSchema).min(1)
