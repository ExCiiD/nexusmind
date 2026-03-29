import OpenAI from 'openai'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (client) return client
  const apiKey = (import.meta.env.MAIN_VITE_OPENAI_API_KEY as string | undefined)?.trim()
  if (!apiKey || apiKey === 'sk-...') throw new Error('OpenAI API key not configured — set MAIN_VITE_OPENAI_API_KEY in .env')
  client = new OpenAI({ apiKey })
  return client
}

async function chat(systemPrompt: string, userMessage: string): Promise<string> {
  const ai = getClient()
  const response = await ai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 1024,
  })
  return response.choices[0]?.message?.content ?? ''
}

export async function suggestObjective(scores: Record<string, number>): Promise<string> {
  const systemPrompt = `You are a League of Legends coaching assistant. Based on the player's self-assessment scores (1-5 scale), suggest the most impactful area to focus on for improvement. Be specific, actionable, and encouraging. Respond in the same language the player uses. Format your response as:
1. The recommended focus area
2. Why this area will have the most impact
3. One concrete drill or mindset for the next session`

  const scoreList = Object.entries(scores)
    .map(([id, score]) => `${id}: ${score}/5`)
    .join('\n')

  return chat(systemPrompt, `Here are my current self-assessment scores:\n${scoreList}`)
}

export async function synthesizeReview(data: {
  timelineNotes: Array<{ time: string; note: string }>
  kpiScores: Record<string, number>
  objective: string
}): Promise<string> {
  const systemPrompt = `You are a League of Legends coaching assistant reviewing a player's post-game notes. Provide a concise 2-3 sentence coaching summary based on their timeline notes and KPI scores. Identify what went well and what to improve. Be supportive but honest. Respond in the same language as the player's notes.`

  const notes = data.timelineNotes.map((n) => `${n.time} - ${n.note}`).join('\n')
  const kpis = Object.entries(data.kpiScores)
    .map(([k, v]) => `${k}: ${v}/5`)
    .join('\n')

  return chat(
    systemPrompt,
    `Objective: ${data.objective}\n\nTimeline Notes:\n${notes}\n\nKPI Scores:\n${kpis}`,
  )
}

export async function analyzePatterns(
  reviews: Array<{
    timelineNotes: string
    kpiScores: string
    objectiveRespected: boolean
    freeText: string | null
    aiSummary: string | null
  }>,
): Promise<string> {
  const systemPrompt = `You are a League of Legends coaching assistant performing pattern analysis across multiple game reviews from a single session. Identify:
1. Recurring mistakes or themes (max 3)
2. Consistent strengths shown
3. Whether the player should keep the same objective or move on
Be specific — reference timestamps and notes when possible. Respond in the same language as the notes.`

  const reviewTexts = reviews
    .map((r, i) => {
      const notes = JSON.parse(r.timelineNotes)
        .map((n: any) => `  ${n.time}: ${n.note}`)
        .join('\n')
      return `Game ${i + 1} (Objective respected: ${r.objectiveRespected ? 'Yes' : 'No'}):\n${notes}\n${r.freeText ? `Player note: ${r.freeText}` : ''}`
    })
    .join('\n\n')

  return chat(systemPrompt, reviewTexts)
}

export async function generateSessionSummary(
  reviews: Array<{
    timelineNotes: string
    kpiScores: string
    objectiveRespected: boolean
    freeText: string | null
  }>,
  objective: string,
): Promise<string> {
  const systemPrompt = `You are a League of Legends coaching assistant writing a session summary. The player completed multiple games with a specific objective. Summarize:
1. Overall performance on the objective
2. Key patterns observed across games
3. Recommendation for next session (same objective or move on)
Keep it motivating and under 200 words. Respond in the same language as the notes.`

  const reviewTexts = reviews
    .map((r, i) => {
      const notes = JSON.parse(r.timelineNotes)
        .map((n: any) => `  ${n.time}: ${n.note}`)
        .join('\n')
      const kpis = Object.entries(JSON.parse(r.kpiScores))
        .map(([k, v]) => `  ${k}: ${v}/5`)
        .join('\n')
      return `Game ${i + 1}:\nNotes:\n${notes}\nKPIs:\n${kpis}\nObjective respected: ${r.objectiveRespected ? 'Yes' : 'No'}`
    })
    .join('\n\n')

  return chat(systemPrompt, `Session objective: ${objective}\n\n${reviewTexts}`)
}

export async function generateRankMilestoneMessage(
  oldRank: string,
  newRank: string,
  scoreDeltas: Record<string, number>,
): Promise<string> {
  const systemPrompt = `You are an enthusiastic League of Legends coaching assistant. The player just changed rank. Write a brief, exciting congratulation (or encouragement if they went down) that connects their rank change to their skill improvements. Max 3 sentences. Respond in the same language context.`

  const deltas = Object.entries(scoreDeltas)
    .filter(([, d]) => Math.abs(d) > 0)
    .map(([k, d]) => `${k}: ${d > 0 ? '+' : ''}${d.toFixed(1)}`)
    .join(', ')

  return chat(
    systemPrompt,
    `Previous rank: ${oldRank}\nNew rank: ${newRank}\nRecent score changes: ${deltas || 'No significant changes'}`,
  )
}
