import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AISuggestionPanelProps {
  scores: Record<string, number>
  onAcceptSuggestion?: (fundamentalId: string) => void
}

export function AISuggestionPanel({ scores, onAcceptSuggestion }: AISuggestionPanelProps) {
  const { t } = useTranslation()
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getSuggestion = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getObjectiveSuggestion(scores)
      setSuggestion(result)
    } catch (err: any) {
      setError(err.message || t('ai.suggestion.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-hextech-teal/30 bg-hextech-blue/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-hextech-cyan" />
          {t('ai.suggestion.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!suggestion && !loading && (
          <div className="text-center py-4">
            <p className="text-sm text-hextech-text mb-3">{t('ai.suggestion.hint')}</p>
            <Button onClick={getSuggestion} variant="secondary" size="sm">
              <Sparkles className="h-4 w-4 mr-1" />
              {t('ai.suggestion.button')}
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-hextech-cyan" />
            <span className="ml-2 text-sm text-hextech-text">{t('ai.suggestion.loading')}</span>
          </div>
        )}

        {error && (
          <div className="py-3">
            <p className="text-sm text-hextech-red">{error}</p>
            <Button onClick={getSuggestion} variant="ghost" size="sm" className="mt-2">{t('ai.suggestion.tryAgain')}</Button>
          </div>
        )}

        {suggestion && (
          <div className="space-y-3">
            <div className="prose prose-sm prose-invert max-w-none">
              <p className="text-sm text-hextech-text-bright whitespace-pre-wrap">{suggestion}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={getSuggestion} variant="ghost" size="sm">{t('ai.suggestion.getAnother')}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
