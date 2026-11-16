import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square, Loader2, Youtube, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey } from '@/lib/collab'
import type { ReviewStatus, TeamSessionReview, TeamSessionReviewPatch } from '@/lib/teamSessionReviews'

interface Props {
  title: string
  review: TeamSessionReview | null
  /** Creates the row the first time recording starts (status 'recording'),
   *  returning it so the component can keep patching the same id. */
  onCreate: (status: ReviewStatus) => Promise<TeamSessionReview>
  onUpdate: (id: string, patch: TeamSessionReviewPatch) => Promise<void>
  /** Only shown for a per-game review — session/meeting reviews aren't
   *  skippable, since there's no "next one" to fall back on. */
  onSkip?: () => Promise<void>
}

/** Shared record → transcribe → optionally upload to YouTube flow (Phase
 *  5, Planning rework). Desktop-only: reuses the existing manual capture
 *  (window.api.startCapture/stopCapture, same path as the solo session's
 *  "record a clip" flow) and the local Whisper transcription IPC added in
 *  this phase. On the web build these calls simply don't exist, so the
 *  record button is replaced with a note instead of risking a runtime
 *  "not a function" — recording a live screen+mic capture only makes
 *  sense from the desktop app anyway. */
export function ReviewRecorder({ title, review, onCreate, onUpdate, onSkip }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcriptDraft, setTranscriptDraft] = useState(review?.transcript ?? '')
  const [summaryDraft, setSummaryDraft] = useState(review?.summary ?? '')
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null)

  const canRecord = typeof window.api.startCapture === 'function'

  useEffect(() => {
    if (canRecord) checkYoutube()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- check once on mount, re-checked again right before a new recording starts
  }, [])

  const checkYoutube = async () => {
    try {
      const status = await window.api.youtubeGetStatus()
      setYoutubeConnected(status.connected)
    } catch {
      setYoutubeConnected(false)
    }
  }

  const start = async () => {
    setBusy(true)
    try {
      const res = await window.api.startCapture()
      if (!res.started) throw new Error('CAPTURE_START_FAILED')
      if (!review) await onCreate('recording')
      else await onUpdate(review.id, { status: 'recording' })
      setRecording(true)
      checkYoutube()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      const res = await window.api.stopCapture()
      if (!res.stopped || !res.filePath) throw new Error('CAPTURE_STOP_FAILED')
      const current = review ?? await onCreate('recording')
      await onUpdate(current.id, { recordingLocalPath: res.filePath, status: 'processing' })
      setRecording(false)

      const { text } = await window.api.transcriptionRun(res.filePath, i18n.language.slice(0, 2))
      setTranscriptDraft(text)
      await onUpdate(current.id, { transcript: text, status: 'done' })
      toast({ title: t('teamSession.review.transcribed', { defaultValue: 'Transcribed' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const saveSummary = async () => {
    if (!review) return
    setBusy(true)
    try {
      await onUpdate(review.id, { transcript: transcriptDraft, summary: summaryDraft })
      toast({ title: t('teamSession.review.saved', { defaultValue: 'Saved' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const uploadToYoutube = async () => {
    if (!review?.recordingLocalPath) return
    setBusy(true)
    try {
      const { url } = await window.api.youtubeUpload({
        filePath: review.recordingLocalPath,
        title: title.slice(0, 100),
        visibility: 'unlisted',
      }) as unknown as { url: string }
      await onUpdate(review.id, { youtubeUrl: url, youtubeVisibility: 'unlisted' })
      toast({ title: t('teamSession.review.uploaded', { defaultValue: 'Uploaded to YouTube' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!canRecord) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-hextech-text-dim">
          {t('teamSession.review.desktopOnly', { defaultValue: 'Recording a review is only available in the desktop app.' })}
        </CardContent>
      </Card>
    )
  }

  const isDone = review?.status === 'done'
  const isDeferred = review?.status === 'deferred'

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-hextech-text-bright">{title}</h3>
          {review && (
            <Badge variant={isDone ? 'success' : isDeferred ? 'outline' : 'gold'}>
              {t(`teamSession.review.status.${review.status}`)}
            </Badge>
          )}
        </div>

        {!recording && !isDone && (
          <div className="flex items-center gap-2">
            <Button onClick={start} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
              {t('teamSession.review.record', { defaultValue: 'Record' })}
            </Button>
            {onSkip && !isDeferred && (
              <Button variant="ghost" onClick={onSkip} disabled={busy} className="text-hextech-text-dim">
                {t('teamSession.review.skip', { defaultValue: 'Skip' })}
              </Button>
            )}
          </div>
        )}

        {recording && (
          <Button variant="destructive" onClick={stop} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
            {t('teamSession.review.stop', { defaultValue: 'Stop & transcribe' })}
          </Button>
        )}

        {(isDone || transcriptDraft) && !recording && (
          <div className="space-y-2">
            <Textarea
              value={transcriptDraft}
              onChange={(e) => setTranscriptDraft(e.target.value)}
              rows={4}
              placeholder={t('teamSession.review.transcriptPlaceholder', { defaultValue: 'Transcript (editable)…' })}
            />
            <Textarea
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              rows={2}
              placeholder={t('teamSession.review.summaryPlaceholder', { defaultValue: 'Summary / key takeaways (optional, manual)…' })}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={saveSummary} disabled={busy}>
                {t('teamSession.review.save', { defaultValue: 'Save' })}
              </Button>
              {review?.youtubeUrl ? (
                <a href={review.youtubeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-hextech-cyan hover:underline">
                  <Check className="h-3.5 w-3.5" />{t('teamSession.review.viewOnYoutube', { defaultValue: 'View on YouTube' })}
                </a>
              ) : youtubeConnected === false ? (
                <span className="text-xs text-hextech-text-dim">{t('teamSession.review.youtubeNotConnected', { defaultValue: 'Connect a YouTube channel in Settings to publish.' })}</span>
              ) : (
                <Button size="sm" variant="outline" onClick={uploadToYoutube} disabled={busy || youtubeConnected !== true}>
                  {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Youtube className="mr-2 h-3.5 w-3.5" />}
                  {t('teamSession.review.uploadToYoutube', { defaultValue: 'Upload to YouTube' })}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
