/**
 * Times of the Planning's availability (rules and exceptions). 21/11/2026 bug: dragging the strip down to the bottom of
 * the grid sends "24:00", which the old check refused ("Something went wrong"). "24:00" is the end of the day: valid as
 * an END time only (Postgres `time` stores it as 24:00:00, after 23:59, so `end_time > start_time` still holds); a
 * start stays between 00:00 and 23:59.
 */
import { z } from 'zod'

export const startTimeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const endTimeOnly = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/)

/** "HH:MM" strings of the same form compare in time order. */
const endsAfterStart = (v: { startTime?: string | null; endTime?: string | null }) =>
  !v.startTime || !v.endTime || v.endTime > v.startTime

export const availabilityRuleInput = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: startTimeOnly,
  endTime: endTimeOnly,
}).refine(endsAfterStart, 'endTime must be after startTime')

export const availabilityExceptionInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  available: z.boolean(),
  startTime: startTimeOnly.nullable().optional(),
  endTime: endTimeOnly.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
}).refine(endsAfterStart, 'endTime must be after startTime')
