import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import { useDiscordWebhooks, type DiscordWebhook } from '@/hooks/useDiscordWebhooks'
import { UserCircle2, Plus, Trash2, Loader2, ShieldCheck, Target, Video, Circle, FolderOpen, X, Pencil, Check, FlaskConical, Youtube } from 'lucide-react'
import { cn } from '@/lib/utils'

const REGIONS = [
  'BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'NA1',
  'OC1', 'PH2', 'RU', 'SG2', 'TH2', 'TR1', 'TW2', 'VN2',
]

interface AccountEntry {
  id: string
  gameName: string
  tagLine: string
  region: string
  createdAt: string
}

export function SettingsPage() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const loadUser = useUserStore((s) => s.loadUser)
  const { toast } = useToast()

  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null)
  const [recordingsDir, setRecordingsDir] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [togglingAutoRecord, setTogglingAutoRecord] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('')
  const [region, setRegion] = useState('EUW1')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const GAME_ROLES = [
    { value: 'TOP', label: 'Top' },
    { value: 'JUNGLE', label: 'Jungle' },
    { value: 'MIDDLE', label: 'Mid' },
    { value: 'BOTTOM', label: 'ADC' },
    { value: 'UTILITY', label: 'Support' },
  ] as const

  const handleSetMainRole = async (role: string) => {
    try {
      const newValue = user?.mainRole === role ? null : role
      await window.api.updateUser({ mainRole: newValue })
      await window.api.clearStatsSnapshots()
      await loadUser()
      toast({
        title: newValue
          ? `Main role set to ${GAME_ROLES.find(r => r.value === newValue)?.label ?? role} — stats will refresh automatically`
          : 'Main role filter cleared — stats will refresh automatically',
        variant: 'success',
      })
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    }
  }

  const loadAccounts = async () => {
    try {
      const data = await window.api.listAccounts()
      setAccounts(data)
    } catch {
      // non-critical
    } finally {
      setLoadingAccounts(false)
    }
  }

  useEffect(() => {
    loadAccounts()
    window.api.getCaptureStatus().then((s) => {
      setFfmpegAvailable(s.ffmpegAvailable)
      setIsRecording(s.isRecording)
    }).catch(() => {})
    window.api.getRecordingsDir().then(setRecordingsDir).catch(() => {})
    const offStarted = window.api.onRecordingStarted(() => setIsRecording(true))
    const offStopped = window.api.onRecordingStopped(() => setIsRecording(false))
    return () => {
      offStarted()
      offStopped()
    }
  }, [])

  const handleToggleAutoRecord = async () => {
    if (!user) return
    setTogglingAutoRecord(true)
    try {
      const newValue = !user.autoRecord
      await window.api.updateUser({ autoRecord: newValue })
      await loadUser()
      toast({
        title: newValue ? 'Auto-record enabled — games will be captured automatically' : 'Auto-record disabled',
        variant: newValue ? 'success' : 'default',
      })
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    } finally {
      setTogglingAutoRecord(false)
    }
  }

  const handleManualRecord = async () => {
    if (isRecording) {
      await window.api.stopCapture()
    } else {
      const r = await window.api.startCapture()
      if (r?.started) await window.api.minimizeWindow()
    }
  }

  const handleAdd = async () => {
    if (!gameName.trim() || !tagLine.trim()) return
    setAdding(true)
    try {
      await window.api.addAccount(gameName.trim(), tagLine.trim(), region)
      toast({ title: t('settings.accounts.addedToast'), variant: 'success' })
      setGameName('')
      setTagLine('')
      setShowAddForm(false)
      await loadAccounts()
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try {
      await window.api.removeAccount(id)
      toast({ title: t('settings.accounts.removedToast'), variant: 'success' })
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      setConfirmRemoveId(null)
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('settings.title')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* Main role for stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-hextech-cyan" />
            Main Role
          </CardTitle>
          <CardDescription>Stats averages and progression will only include games played on your main role. Click again to deselect.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {GAME_ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => handleSetMainRole(r.value)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  user?.mainRole === r.value
                    ? 'border-hextech-cyan bg-hextech-cyan/10 text-hextech-cyan'
                    : 'border-hextech-border-dim text-hextech-text hover:border-hextech-cyan/40',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Game Recording */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-hextech-teal" />
            Game Recording
          </CardTitle>
          <CardDescription>
            Automatically record your screen during every League of Legends game. Recordings are stored locally and linked to your review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ffmpegAvailable === false && (
            <div className="rounded-md border border-orange-500/40 bg-orange-500/5 px-4 py-3 text-sm text-orange-300">
              ffmpeg was not found on this system. Auto-record requires ffmpeg to be installed.
            </div>
          )}

          {/* Auto-record toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-hextech-text-bright">Auto-record games</p>
              <p className="text-xs text-hextech-text-dim mt-0.5">
                Starts recording when LoL launches, stops and saves when the game ends. For best results, use{' '}
                <span className="text-hextech-text/90">borderless</span> or <span className="text-hextech-text/90">windowed</span> mode in League — exclusive fullscreen can produce a black capture with some setups. NexusMind minimizes while recording so it does not appear on your footage.
              </p>
            </div>
            <button
              onClick={handleToggleAutoRecord}
              disabled={togglingAutoRecord || ffmpegAvailable === false}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
                user?.autoRecord ? 'bg-hextech-teal' : 'bg-hextech-elevated border border-hextech-border-dim',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  user?.autoRecord ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>

          {/* Live recording indicator */}
          {isRecording && (
            <div className="flex items-center gap-2 text-sm text-[#FF4655]">
              <Circle className="h-2.5 w-2.5 fill-current animate-pulse" />
              <span className="font-medium">Recording in progress</span>
              <Button variant="outline" size="sm" onClick={handleManualRecord} className="ml-auto text-xs border-[#FF4655]/40 text-[#FF4655] hover:bg-[#FF4655]/10">
                Stop now
              </Button>
            </div>
          )}

          {/* Manual record button (when auto-record is off) */}
          {!user?.autoRecord && !isRecording && ffmpegAvailable && (
            <Button variant="outline" size="sm" onClick={handleManualRecord} className="gap-2">
              <Circle className="h-3 w-3 fill-[#FF4655] text-[#FF4655]" />
              Start manual recording
            </Button>
          )}

          {/* ── Recording options (only when auto-record is on) ───────── */}
          {user?.autoRecord && <div className="space-y-4">

          {/* ── Quality ──────────────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p className="text-sm font-medium text-hextech-text-bright">Recording quality</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(['720p', '1080p', '1440p', 'source'] as const).map((q) => (
                <button
                  key={q}
                  disabled={!ffmpegAvailable}
                  onClick={async () => { await window.api.updateUser({ recordQuality: q }); await loadUser() }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
                    user?.recordQuality === q
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/40',
                  )}
                >
                  {q === 'source' ? 'Source' : q}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-hextech-text-dim">
              "Source" captures at your monitor's native resolution. Lower settings reduce file size and CPU load.
            </p>
          </div>

          {/* ── FPS ──────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-hextech-text-bright">Frame rate</p>
            <div className="flex gap-2">
              {([30, 60] as const).map((fps) => (
                <button
                  key={fps}
                  disabled={!ffmpegAvailable}
                  onClick={async () => { await window.api.updateUser({ recordFps: fps }); await loadUser() }}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
                    user?.recordFps === fps
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/40',
                  )}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>

          {/* ── Encoder ──────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-hextech-text-bright">Encoder</p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'nvenc', label: 'NVIDIA GPU', sub: 'NVENC',  desc: 'GTX 950+', recommended: true },
                { value: 'amf',   label: 'AMD GPU',    sub: 'AMF',    desc: 'RX 400+',  recommended: true },
                { value: 'qsv',   label: 'Intel GPU',  sub: 'QSV',    desc: 'HD 4000+', recommended: true },
                { value: 'cpu',   label: 'CPU',         sub: 'x264',   desc: 'Fallback — always works', recommended: false },
              ]).map(({ value, label, sub, desc, recommended }) => (
                <button
                  key={value}
                  disabled={!ffmpegAvailable}
                  onClick={async () => { await window.api.updateUser({ recordEncoder: value }); await loadUser() }}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-40',
                    user?.recordEncoder === value
                      ? 'border-hextech-gold bg-hextech-gold/10'
                      : 'border-hextech-border-dim hover:border-hextech-gold/40',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <p className={cn('text-xs font-medium', user?.recordEncoder === value ? 'text-hextech-gold-bright' : 'text-hextech-text')}>
                      {label}
                    </p>
                    <span className="text-[9px] font-mono text-hextech-text-dim bg-white/5 rounded px-1">{sub}</span>
                    {recommended && (
                      <span className="ml-auto text-[9px] font-semibold text-hextech-teal bg-hextech-teal/10 rounded px-1 py-0.5">⚡ GPU</span>
                    )}
                  </div>
                  <p className="text-[10px] text-hextech-text-dim mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
            <div className="rounded-md bg-hextech-teal/5 border border-hextech-teal/20 px-3 py-2 text-[11px] text-hextech-text-dim space-y-0.5">
              <p className="font-medium text-hextech-teal text-xs">⚡ GPU encoders are strongly recommended</p>
              <p>GPU encoders use dedicated hardware — recording has near-zero impact on game FPS. Pick the one matching your GPU brand. If recording fails, fall back to CPU.</p>
            </div>
          </div>

          {/* ── Record scope ─────────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p className="text-sm font-medium text-hextech-text-bright">Record queue types</p>
            <div className="space-y-1.5">
              {([
                { value: 'ranked_only', label: 'Ranked only', desc: 'SoloQ + Flex (default)' },
                { value: 'all', label: 'All game modes', desc: 'Includes ARAM, Arena, Normal…' },
                { value: 'custom', label: 'Custom selection', desc: 'Choose which modes to record' },
              ] as const).map(({ value, label, desc }) => (
                <label key={value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="recordScope"
                    value={value}
                    checked={(user?.recordScope ?? 'ranked_only') === value}
                    onChange={async () => {
                      await window.api.updateUser({ recordScope: value })
                      await loadUser()
                    }}
                    className="accent-hextech-gold"
                  />
                  <span className="text-sm text-hextech-text-bright">{label}</span>
                  <span className="text-xs text-hextech-text-dim">{desc}</span>
                </label>
              ))}
            </div>

            {/* Custom selection checkboxes */}
            {(user?.recordScope ?? 'ranked_only') === 'custom' && (
              <div className="ml-6 mt-2 grid grid-cols-2 gap-1.5">
                {([
                  { key: 'recordModeAram', label: 'ARAM' },
                  { key: 'recordModeArena', label: 'Arena' },
                  { key: 'recordModeNormal', label: 'Normal / Quickplay' },
                  { key: 'recordAllowCustom', label: 'Custom games' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={key === 'recordAllowCustom' ? (user?.recordAllowCustom ?? false) : false}
                      onChange={async (e) => {
                        if (key === 'recordAllowCustom') {
                          await window.api.updateUser({ recordAllowCustom: e.target.checked })
                          await loadUser()
                        }
                      }}
                      className="accent-hextech-gold rounded"
                    />
                    <span className="text-xs text-hextech-text">{label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Desktop fallback toggle */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-sm text-hextech-text-bright">Allow desktop fallback</p>
                <p className="text-xs text-hextech-text-dim mt-0.5">
                  Falls back to full-screen capture if the LoL window isn't detected.
                </p>
              </div>
              <button
                onClick={async () => {
                  await window.api.updateUser({ allowDesktopFallback: !(user?.allowDesktopFallback ?? true) })
                  await loadUser()
                }}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  (user?.allowDesktopFallback ?? true) ? 'bg-hextech-teal' : 'bg-hextech-elevated border border-hextech-border-dim',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    (user?.allowDesktopFallback ?? true) ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
            </div>
          </div>

          {/* ── Recordings folder ─────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p className="text-sm font-medium text-hextech-text-bright">Recordings folder</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-xs text-hextech-text truncate min-w-0">
                {user?.recordingPath || recordingsDir || 'Default (AppData)'}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={async () => {
                  const picked = await window.api.pickRecordingFolder()
                  if (picked) {
                    await window.api.updateUser({ recordingPath: picked })
                    await loadUser()
                    // Refresh the displayed dir
                    window.api.getRecordingsDir().then(setRecordingsDir).catch(() => {})
                  }
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
              {user?.recordingPath && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-hextech-text-dim hover:text-[#FF4655]"
                  title="Reset to default"
                  onClick={async () => {
                    await window.api.updateUser({ recordingPath: null })
                    await loadUser()
                    window.api.getRecordingsDir().then(setRecordingsDir).catch(() => {})
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          </div>}
        </CardContent>
      </Card>

      {/* ── External recordings folder ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-hextech-gold" />
            External recordings folder
          </CardTitle>
          <CardDescription>
            When linking a replay recorded with another app (OBS, Outplayed…), the file picker will open directly in this folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-xs text-hextech-text truncate min-w-0">
              {user?.externalRecordingPath || <span className="text-hextech-text-dim/60">Not set — file picker will start at the default location</span>}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={async () => {
                const picked = await window.api.pickRecordingFolder()
                if (picked) {
                  await window.api.updateUser({ externalRecordingPath: picked })
                  await loadUser()
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Browse
            </Button>
            {user?.externalRecordingPath && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-hextech-text-dim hover:text-[#FF4655]"
                title="Clear folder"
                onClick={async () => {
                  await window.api.updateUser({ externalRecordingPath: null })
                  await loadUser()
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── YouTube upload ──────────────────────────────────────────────────── */}
      <YouTubeCard />

      {/* ── Discord sharing ──────────────────────────────────────────────────── */}
      <DiscordWebhookCard />

      {/* Accounts management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle2 className="h-5 w-5 text-hextech-gold" />
            {t('settings.accounts.title')}
          </CardTitle>
          <CardDescription>{t('settings.accounts.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main account */}
          {user && (
            <div className="flex items-center gap-3 rounded-lg border border-hextech-gold/30 bg-hextech-gold/5 px-4 py-3">
              <ShieldCheck className="h-5 w-5 text-hextech-gold shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-hextech-text-bright">
                    {user.summonerName}#{user.tagLine}
                  </span>
                  <Badge variant="gold" className="text-[10px] h-5">{t('settings.accounts.main')}</Badge>
                </div>
                <span className="text-xs text-hextech-text-dim">{user.region}</span>
              </div>
            </div>
          )}

          {/* Secondary accounts */}
          {loadingAccounts ? (
            <div className="flex items-center gap-2 text-sm text-hextech-text-dim py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('settings.accounts.empty')}</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-4 py-3"
                >
                  <UserCircle2 className="h-5 w-5 text-hextech-text-dim shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-hextech-text-bright">
                        {acc.gameName}#{acc.tagLine}
                      </span>
                      <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">
                        {t('settings.accounts.secondary')}
                      </Badge>
                    </div>
                    <span className="text-xs text-hextech-text-dim">{acc.region}</span>
                  </div>
                  <div className="shrink-0">
                    {confirmRemoveId === acc.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-hextech-text-dim">{t('settings.accounts.removeConfirm')}</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={removingId === acc.id}
                          onClick={() => handleRemove(acc.id)}
                        >
                          {removingId === acc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('settings.accounts.remove')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          {t('settings.accounts.removeCancel')}
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(acc.id)}
                        className="rounded p-1.5 text-hextech-text-dim hover:text-[#FF4655] hover:bg-[#FF4655]/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form toggle */}
          {!showAddForm ? (
            <Button
              variant="outline"
              onClick={() => setShowAddForm(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {t('settings.accounts.add')}
            </Button>
          ) : (
            <div className={cn(
              'space-y-3 rounded-lg border border-hextech-gold/20 bg-hextech-gold/5 p-4',
            )}>
              <p className="text-xs text-hextech-text-dim">{t('settings.accounts.addDesc')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.gameName')}</Label>
                  <input
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder="PlayerName"
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.tagLine')}</Label>
                  <input
                    type="text"
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value)}
                    placeholder="EUW"
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.region')}</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={handleAdd} disabled={adding || !gameName.trim() || !tagLine.trim()} className="gap-2">
                  {adding
                    ? <><Loader2 className="h-4 w-4 animate-spin" />{t('settings.accounts.addingButton')}</>
                    : <><Plus className="h-4 w-4" />{t('settings.accounts.addButton')}</>
                  }
                </Button>
                <Button variant="ghost" onClick={() => { setShowAddForm(false); setGameName(''); setTagLine('') }}>
                  {t('settings.accounts.removeCancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Discord webhook sub-component ────────────────────────────────────────────

function DiscordWebhookCard() {
  const { toast } = useToast()
  const { webhooks, loading, reload } = useDiscordWebhooks()

  const [showAddForm, setShowAddForm] = useState(false)
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingSaving, setRenamingSaving] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!addName.trim() || !addUrl.trim()) return
    setAdding(true)
    try {
      await window.api.addWebhook(addName.trim(), addUrl.trim())
      await reload()
      setAddName('')
      setAddUrl('')
      setShowAddForm(false)
      toast({ title: 'Webhook added', variant: 'gold' })
    } catch (err: any) {
      toast({ title: err.message ?? 'Failed to add webhook', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const handleRenameStart = (wh: DiscordWebhook) => {
    setRenamingId(wh.id)
    setRenameValue(wh.name)
  }

  const handleRenameSave = async (id: string) => {
    if (!renameValue.trim()) return
    setRenamingSaving(true)
    try {
      await window.api.renameWebhook(id, renameValue.trim())
      await reload()
      setRenamingId(null)
    } catch (err: any) {
      toast({ title: err.message ?? 'Rename failed', variant: 'destructive' })
    } finally {
      setRenamingSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await window.api.deleteWebhook(id)
      await reload()
      setConfirmDeleteId(null)
      toast({ title: 'Webhook removed', variant: 'gold' })
    } catch (err: any) {
      toast({ title: err.message ?? 'Delete failed', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (wh: DiscordWebhook) => {
    setTestingId(wh.id)
    try {
      await window.api.sendToDiscord([{
        title: '✅ NexusMind webhook test',
        description: `**${wh.name}** is correctly configured. Reviews will be shared to this channel.`,
        color: 0xc89b3c,
        footer: { text: 'NexusMind' },
        timestamp: new Date().toISOString(),
      }], wh.url)
      toast({ title: `Test sent to "${wh.name}"`, variant: 'gold' })
    } catch (err: any) {
      toast({ title: 'Webhook test failed', description: err.message, variant: 'destructive' })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-[#5865F2] text-lg font-bold leading-none">ᴅ</span>
          Discord sharing
        </CardTitle>
        <CardDescription>
          Add Discord webhook URLs to share reviews as rich embeds directly to a channel.
          You can configure multiple webhooks (e.g. one per team or server) and pick the destination when sharing.
          {' '}<a href="https://support.discord.com/hc/en-us/articles/228383668" target="_blank" rel="noreferrer" className="underline hover:text-hextech-text transition-colors">How to create a webhook ↗</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Webhook list */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-hextech-text-dim py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-xs text-hextech-text-dim/70 py-1">
            No webhooks configured — reviews can still be copied as text.
          </p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="flex items-center gap-2 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5"
              >
                <span className="text-[#5865F2] text-sm font-bold leading-none shrink-0">ᴅ</span>

                <div className="flex-1 min-w-0">
                  {renamingId === wh.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSave(wh.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 min-w-0 rounded border border-[#5865F2]/60 bg-hextech-dark px-2 py-0.5 text-xs text-hextech-text focus:outline-none"
                      />
                      <button
                        onClick={() => handleRenameSave(wh.id)}
                        disabled={renamingSaving}
                        className="text-hextech-teal hover:text-hextech-teal/80 disabled:opacity-50"
                      >
                        {renamingSaving
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        className="text-hextech-text-dim hover:text-hextech-text"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-hextech-text-bright truncate">{wh.name}</p>
                      <p className="text-[10px] text-hextech-text-dim truncate font-mono">
                        {wh.url.replace(/\/[^/]+$/, '/••••••')}
                      </p>
                    </>
                  )}
                </div>

                {renamingId !== wh.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Test */}
                    <button
                      onClick={() => handleTest(wh)}
                      disabled={testingId === wh.id}
                      title="Send a test message"
                      className="rounded p-1.5 text-hextech-text-dim hover:text-hextech-gold hover:bg-hextech-gold/10 transition-colors disabled:opacity-50"
                    >
                      {testingId === wh.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <FlaskConical className="h-3.5 w-3.5" />}
                    </button>
                    {/* Rename */}
                    <button
                      onClick={() => handleRenameStart(wh)}
                      title="Rename webhook"
                      className="rounded p-1.5 text-hextech-text-dim hover:text-hextech-text hover:bg-white/5 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {/* Delete */}
                    {confirmDeleteId === wh.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-hextech-text-dim">Remove?</span>
                        <button
                          onClick={() => handleDelete(wh.id)}
                          disabled={deletingId === wh.id}
                          className="rounded px-2 py-0.5 text-[10px] font-medium text-white bg-[#FF4655] hover:bg-[#FF4655]/80 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === wh.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-hextech-text-dim hover:text-hextech-text text-[10px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(wh.id)}
                        title="Remove webhook"
                        className="rounded p-1.5 text-hextech-text-dim hover:text-[#FF4655] hover:bg-[#FF4655]/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {showAddForm ? (
          <div className="space-y-2 rounded-lg border border-[#5865F2]/20 bg-[#5865F2]/5 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-hextech-text-dim uppercase tracking-wide">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. #coaching, My Server…"
                  className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2.5 py-1.5 text-xs text-hextech-text placeholder:text-hextech-text-dim/40 focus:outline-none focus:border-[#5865F2]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-hextech-text-dim uppercase tracking-wide">Webhook URL</label>
                <input
                  type="url"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                  className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2.5 py-1.5 text-xs text-hextech-text placeholder:text-hextech-text-dim/40 focus:outline-none focus:border-[#5865F2]"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-0.5">
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={adding || !addName.trim() || !addUrl.trim()}
                className="gap-1.5 text-xs h-7"
              >
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add webhook
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => { setShowAddForm(false); setAddName(''); setAddUrl('') }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add webhook
          </Button>
        )}

        <p className="text-[11px] text-hextech-text-dim">
          Webhook URLs are stored locally and only ever sent to Discord.
        </p>
      </CardContent>
    </Card>
  )
}

// ── YouTube Card ─────────────────────────────────────────────────────────────

function YouTubeCard() {
  const [status, setStatus] = useState<{ connected: boolean; channelName: string | null }>({
    connected: false,
    channelName: null,
  })
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(window.api as any).youtubeGetStatus().then(setStatus).catch(() => {})
  }, [])

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const result = await (window.api as any).youtubeAuthStart()
      setStatus({ connected: result.connected, channelName: result.channelName })
    } catch (err: any) {
      setError(err?.message ?? 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await (window.api as any).youtubeDisconnect()
    setStatus({ connected: false, channelName: null })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-500" />
          YouTube Upload
        </CardTitle>
        <CardDescription>
          Connect your YouTube account to upload recordings and clips directly from NexusMind.
          Requires a Google Cloud project with YouTube Data API v3 enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-400" />
              <div>
                <p className="text-sm font-medium text-hextech-text-bright">Connected</p>
                {status.channelName && (
                  <p className="text-xs text-hextech-text-dim">{status.channelName}</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-[#FF4655] border-[#FF4655]/30 hover:bg-[#FF4655]/10 text-xs"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-400">
              <p className="font-medium mb-1">Setup required</p>
              <p>Add <code className="font-mono bg-white/5 px-1 rounded">MAIN_VITE_GOOGLE_CLIENT_ID</code> and <code className="font-mono bg-white/5 px-1 rounded">MAIN_VITE_GOOGLE_CLIENT_SECRET</code> to your <code className="font-mono bg-white/5 px-1 rounded">.env</code> file to enable YouTube uploads.</p>
            </div>
            {error && (
              <p className="text-xs text-[#FF4655] bg-[#FF4655]/10 border border-[#FF4655]/30 rounded px-3 py-2">
                {error}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
              {connecting ? 'Connecting…' : 'Connect YouTube'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
