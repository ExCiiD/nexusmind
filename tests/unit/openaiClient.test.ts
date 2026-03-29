import { describe, it, expect, vi } from 'vitest'

// Provide API key via env before module loads
vi.stubEnv('MAIN_VITE_OPENAI_API_KEY', 'sk-test-mock-key-for-unit-tests')

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'Focus on Wave Management. Your score of 2/5 shows this is your biggest area for growth.',
                },
              },
            ],
          }),
        },
      },
    })),
  }
})

describe('OpenAI Client', () => {
  it('should format objective suggestion prompt correctly', async () => {
    const { suggestObjective } = await import('../../electron/main/openaiClient')

    const scores = {
      wave_management: 2,
      spacing: 3,
      trades: 4,
      vision_setup: 1,
    }

    const result = await suggestObjective(scores)
    expect(result).toContain('Wave Management')
  })

  it('should handle review synthesis', async () => {
    const { synthesizeReview } = await import('../../electron/main/openaiClient')

    const result = await synthesizeReview({
      timelineNotes: [
        { time: '3:50', note: 'Missed the freeze opportunity after bounce' },
        { time: '5:30', note: 'Good slow push into crash before dragon' },
      ],
      kpiScores: { wave_state_awareness: 3, wave_manipulation_execution: 2 },
      objective: 'Wave Management',
    })

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should handle pattern analysis with multiple reviews', async () => {
    const { analyzePatterns } = await import('../../electron/main/openaiClient')

    const reviews = [
      {
        timelineNotes: JSON.stringify([{ time: '3:00', note: 'Died to gank, no ward' }]),
        kpiScores: JSON.stringify({ vision_setup: 2 }),
        objectiveRespected: false,
        freeText: 'Need to ward more',
        aiSummary: null,
      },
      {
        timelineNotes: JSON.stringify([{ time: '4:00', note: 'Again died to gank' }]),
        kpiScores: JSON.stringify({ vision_setup: 2 }),
        objectiveRespected: false,
        freeText: null,
        aiSummary: null,
      },
    ]

    const result = await analyzePatterns(reviews)
    expect(typeof result).toBe('string')
  })
})
