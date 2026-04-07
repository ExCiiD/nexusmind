import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatGameTime } from '@/lib/utils'
import {
  Video,
  Youtube,
  RefreshCw,
  Loader2,
  ClipboardCheck,
  Swords,
  Clock,
  Film,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccountBadge } from '@/components/ui/AccountBadge'

interface ReplayEntry {
  recordingId: string
  gameId: string
  filePath: string | null
  youtubeUrl: string | null
  source: string
  champion: string
  opponentChampion: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  duration: number
  gameEndAt: string
  hasReview: boolean
  reviewId: string | null
  sessionObjectiveId: string
  accountName?: string
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'capture': return 'NexusMind'
    case 'outplayed': return 'Outplayed'
    case 'insightcapture': return 'InsightCapture'
    case 'obs': return 'OBS'
    case 'youtube': return 'YouTube'
    default: return 'Manual'
  }
}

export function ReplaysPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [replays, setReplays] = useState<ReplayEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)

  const loadReplays = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.listGamesWithRecordings()
      setReplays(data)
    } catch (err) {
      console.error('[ReplaysPage] Failed to load replays:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReplays()
  }, [loadReplays])

  const handleScan = async () => {
    setScanning(true)
    try {
      await window.api.scanRecordings()
      await loadReplays()
    } catch (err) {
      console.error('[ReplaysPage] Scan failed:', err)
    } finally {
      setScanning(false)
    }
  }

  const handleOpen = (replay: ReplayEntry) => {
    navigate(`/review?gameId=${replay.gameId}`)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">Replays</h1>
          <p className="text-sm text-hextech-text mt-1">
            {replays.length} recording{replays.length !== 1 ? 's' : ''} available
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={scanning}
          className="gap-2"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Scan
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-12 justify-center text-hextech-text-dim">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading replays…</span>
        </div>
      ) : replays.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Film className="h-10 w-10 opacity-30 text-hextech-text-dim" />
            <p className="text-sm font-medium text-hextech-text-bright">No recordings found</p>
            <p className="text-xs text-hextech-text-dim max-w-xs">
              Enable auto-record in Settings, or click Scan to detect recordings from
              Outplayed / OBS / InsightCapture.
            </p>
            <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-2 mt-2">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Scan recording folders
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {replays.map((replay) => (
            <ReplayCard key={replay.recordingId} replay={replay} onOpen={handleOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

interface ReplayCardProps {
  replay: ReplayEntry
  onOpen: (replay: ReplayEntry) => void
}

function ReplayCard({ replay, onOpen }: ReplayCardProps) {
  const date = new Date(replay.gameEndAt)
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const hasLocalFile = !!replay.filePath
  const hasYoutube = !!replay.youtubeUrl

  return (
    <button
      onClick={() => onOpen(replay)}
      className="w-full text-left rounded-lg border border-hextech-border-dim bg-hextech-elevated hover:border-hextech-gold/40 hover:bg-hextech-elevated/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold"
    >
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Win/Loss indicator */}
        <div
          className={`w-1 self-stretch rounded-full shrink-0 ${
            replay.win ? 'bg-hextech-teal' : 'bg-[#FF4655]'
          }`}
        />

        {/* Champion info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-hextech-text-bright">{replay.champion}</span>
            {replay.opponentChampion && (
              <>
                <Swords className="h-3 w-3 text-hextech-text-dim shrink-0" />
                <span className="text-xs text-hextech-text-dim">{replay.opponentChampion}</span>
              </>
            )}
            <Badge
              variant={replay.win ? 'success' : 'destructive'}
              className="text-[10px] h-4 px-1.5"
            >
              {replay.win ? 'Victory' : 'Defeat'}
            </Badge>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-hextech-text-dim">
            {/* KDA */}
            <span className="font-mono">
              {replay.kills}/{replay.deaths}/{replay.assists}
            </span>
            {/* Duration */}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatGameTime(replay.duration)}
            </span>
            {/* Date */}
            <span>{dateStr} {timeStr}</span>
          </div>
        </div>

        {/* Right side badges */}
        <div className="flex items-center gap-2 shrink-0">
          {replay.accountName && (
            <AccountBadge name={replay.accountName} />
          )}
          {replay.hasReview && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 text-hextech-cyan border-hextech-cyan/30">
              <ClipboardCheck className="h-2.5 w-2.5" />
              Reviewed
            </Badge>
          )}
          {hasYoutube && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 text-red-400 border-red-400/30">
              <Youtube className="h-2.5 w-2.5" />
              YouTube
            </Badge>
          )}
          {hasLocalFile && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 text-hextech-teal border-hextech-teal/30">
              <Video className="h-2.5 w-2.5" />
              {sourceLabel(replay.source)}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}
