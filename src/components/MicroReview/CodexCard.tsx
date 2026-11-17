import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarPlus, ExternalLink, PlayCircle, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isOfficialVideo, localize, officialThumbnail, segmentEmbedUrl, type CodexEntry, type VideoExample } from '@/lib/microReview/codex'

/** One AscendCodex prescription: headline, tactical rule, measurable drill, optional 1-click action. */
export function CodexCard({ entry, onPrepare, compact, className }: {
  entry: CodexEntry
  onPrepare?: () => void
  compact?: boolean
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <div className={cn('rounded-xl border border-hextech-cyan/30 bg-gradient-to-br from-hextech-cyan/10 to-transparent p-3.5', className)} data-testid="codex-card">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-hextech-cyan">
        {entry.source === 'team' ? <Users className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
        {entry.source === 'team' ? t('codex.team') : t('codex.title')}
      </div>
      <p className="mt-1 text-sm font-bold text-hextech-text-bright">{localize(entry.headline, lang)}</p>
      <p className={cn('mt-1.5 text-xs leading-relaxed text-hextech-text', compact && 'line-clamp-3')}>{localize(entry.tacticalRule, lang)}</p>
      <div className="mt-2.5 rounded-lg border border-hextech-border-dim bg-hextech-black/30 px-2.5 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('codex.drill')}</div>
        <p className="mt-0.5 text-xs text-hextech-text-bright">{localize(entry.drillObjective, lang)}</p>
      </div>
      {!!entry.videoExamples?.length && (
        <div className={cn('mt-2.5 grid gap-2', entry.videoExamples.length > 1 && !compact && 'sm:grid-cols-2')}>
          {entry.videoExamples.map((v) => <VideoExampleLink key={v.url} video={v} compact={compact} />)}
        </div>
      )}
      {onPrepare && (
        <Button size="sm" variant="outline" className="mt-2.5 w-full gap-1.5 border-hextech-cyan/40 text-hextech-cyan hover:bg-hextech-cyan/10" onClick={onPrepare}>
          <CalendarPlus className="h-3.5 w-3.5" />{t('codex.prepare')}
        </Button>
      )}
    </div>
  )
}

/**
 * Reference segment of an official LoL Esports broadcast: official thumbnail,
 * then an embedded player that plays only [startSeconds, endSeconds].
 * Anything that is not an allow-listed official video renders nothing
 * (codex.ts isOfficialVideo — video rights rule).
 */
export function VideoExampleLink({ video, compact }: { video: VideoExample; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [playing, setPlaying] = useState(false)
  if (!isOfficialVideo(video)) return null
  const embed = segmentEmbedUrl(video)
  const thumb = officialThumbnail(video)
  const span = `${fmt(video.startSeconds)} → ${fmt(video.endSeconds)}`
  return (
    <div className="overflow-hidden rounded-lg border border-hextech-border-dim bg-hextech-black/40" data-testid="codex-video">
      {playing && embed ? (
        <div className="relative aspect-video w-full bg-black">
          <iframe title={localize(video.title, i18n.language)} src={embed} className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />
          <button onClick={() => setPlaying(false)} aria-label={t('codex.closeVideo')}
            className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white hover:bg-black">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={() => setPlaying(true)} className="group flex w-full items-start gap-2.5 p-2 text-left transition-colors hover:bg-hextech-elevated/50">
          <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-hextech-elevated">
            {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/30">
              <PlayCircle className="h-6 w-6 text-white transition-transform group-hover:scale-110" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-hextech-cyan">{t('codex.videoCta')} · {span}</span>
            <span className="block text-xs font-semibold text-hextech-text-bright">{localize(video.title, i18n.language)}</span>
            {!compact && <span className="mt-0.5 block text-[11px] leading-snug text-hextech-text">{localize(video.coachNote, i18n.language)}</span>}
          </span>
        </button>
      )}
      {playing && (
        <div className="flex items-start justify-between gap-2 px-2.5 py-2">
          <p className="text-[11px] leading-snug text-hextech-text">{localize(video.coachNote, i18n.language)}</p>
          <a href={video.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[10px] text-hextech-text-dim hover:text-hextech-text">
            <ExternalLink className="h-3 w-3" />{t('codex.openYoutube')}
          </a>
        </div>
      )}
    </div>
  )
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
