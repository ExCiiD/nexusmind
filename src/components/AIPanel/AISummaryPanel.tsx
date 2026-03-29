import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AISummaryPanelProps {
  type: 'review' | 'session'
  data: any
  onSummaryGenerated?: (summary: string) => void
}

export function AISummaryPanel({ type, data, onSummaryGenerated }: AISummaryPanelProps) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      let result: string
      if (type === 'review') {
        result = await window.api.synthesizeReview(data)
      } else {
        result = await window.api.generateSessionSummary(data.sessionId)
      }
      setSummary(result)
      onSummaryGenerated?.(result)
    } catch (err: any) {
      setError(err.message || t('ai.summaryError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-hextech-cyan/20 bg-hextech-blue/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-hextech-cyan" />
          {type === 'review' ? t('ai.reviewSummary') : t('ai.sessionAnalysis')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!summary && !loading && (
          <Button onClick={generate} variant="secondary" size="sm">
            <Sparkles className="h-4 w-4 mr-1" />
            {type === 'review' ? t('ai.generateSummary') : t('ai.generateAnalysis')}
          </Button>
        )}

        {loading && (
          <div className="flex items-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-hextech-cyan" />
            <span className="ml-2 text-sm text-hextech-text">
              {type === 'review' ? t('ai.summarizing') : t('ai.analyzing')}
            </span>
          </div>
        )}

        {error && (
          <div className="py-2">
            <p className="text-sm text-hextech-red">{error}</p>
            <Button onClick={generate} variant="ghost" size="sm" className="mt-2">{t('ai.retry')}</Button>
          </div>
        )}

        {summary && (
          <div className="space-y-3">
            <p className="text-sm text-hextech-text-bright whitespace-pre-wrap leading-relaxed">{summary}</p>
            <Button onClick={generate} variant="ghost" size="sm">{t('ai.regenerate')}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
