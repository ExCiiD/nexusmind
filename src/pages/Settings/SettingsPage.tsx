import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CloudAccountCard } from '@/components/Cloud/CloudAccountCard'
import { AccessInvitesCard } from '@/components/Cloud/AccessInvitesCard'
import { DEFAULT_WEB_URL } from '@/lib/accessCore'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { Trans, useTranslation } from 'react-i18next'
import { useDiscordWebhooks, type DiscordWebhook } from '@/hooks/useDiscordWebhooks'
import { UserCircle2, Plus, Trash2, Loader2, ShieldCheck, Target, Video, Circle, FolderOpen, X, Pencil, Check, FlaskConical, Youtube, Volume2, Mic, AlertTriangle, ExternalLink } from 'lucide-react'
import { AppearanceCard } from './AppearanceCard'
import { StartupCard } from './StartupCard'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { AudioDevicesSummary } from '@/lib/ipc'
import { PLATFORM_REGIONS } from '@/lib/regions'
import { useYoutubeUploadAvailable } from '@/hooks/useYoutubeUploadAvailable'
import { WellbeingPrivacyCard } from '@/components/Wellbeing/WellbeingPrivacyCard'

interface AccountEntry {
  id: string
  gameName: string
  tagLine: string
  region: string
  createdAt: string
}

export function SettingsPage() {
  const youtubeUpload = useYoutubeUploadAvailable()
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
  const [audioDevices, setAudioDevices] = useState<AudioDevicesSummary | null>(null)
  const [loadingAudioDevices, setLoadingAudioDevices] = useState(false)
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

  /**
   * Fetches the current audio device list from the main process (native-audio-node).
   * Uses OS-level device ids — survives Windows default-device changes without
   * losing the user's selection (unlike Chromium's ephemeral "Default - " labels).
   */
  const refreshAudioDevices = async () => {
    setLoadingAudioDevices(true)
    try {
      const summary = await window.api.listAudioDevices()
      setAudioDevices(summary)
    } catch (err) {
      console.warn('[settings] Failed to list audio devices:', err)
    } finally {
      setLoadingAudioDevices(false)
    }
  }

  useEffect(() => {
    loadAccounts()
    window.api.getCaptureStatus().then((s) => {
      setFfmpegAvailable(s.ffmpegAvailable)
      setIsRecording(s.isRecording)
    }).catch(() => {})
    window.api.getRecordingsDir().then(setRecordingsDir).catch(() => {})
    refreshAudioDevices()
    const offStarted = window.api.onRecordingStarted(() => setIsRecording(true))
    const offStopped = window.api.onRecordingStopped(() => setIsRecording(false))

    // Live-refresh when Windows audio topology changes (device plugged/unplugged
    // OR the user switches the default output/input in Windows settings).
    // Debounced because Windows fires multiple events for a single change.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const onDeviceChange = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { refreshAudioDevices() }, 250)
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)

    return () => {
      offStarted()
      offStopped()
      if (refreshTimer) clearTimeout(refreshTimer)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
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

  // Minimizing during the recording is the main process's job (Settings →
  // "arrière-plan pendant l'enregistrement", electron/main/windowFocus.ts).
  const handleManualRecord = async () => {
    if (isRecording) {
      await window.api.stopCapture()
    } else {
      await window.api.startCapture()
    }
  }

  const saveWindowSetting = async (patch: { recordInBackground?: boolean; reviewPopup?: boolean }) => {
    try {
      await window.api.updateUser(patch)
      await loadUser()
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
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

      {/* Appearance */}
      <AppearanceCard />

      {/* Launch with Windows */}
      <StartupCard />

      {/* Privacy: wellbeing consent (policy v0.3 § 3 bis) */}
      <WellbeingPrivacyCard />

      {/* Main role for stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-hextech-cyan" aria-hidden />
            {t('settings.rec.mainRole')}
          </CardTitle>
          <CardDescription>{t('settings.rec.mainRoleDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {GAME_ROLES.map((r) => (
              <button
                type="button"
                key={r.value}
                aria-pressed={user?.mainRole === r.value}
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
            <Video className="h-5 w-5 text-hextech-teal" aria-hidden />
            {t('settings.rec.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.rec.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ffmpegAvailable === false && (
            <div role="alert" className="rounded-md border border-orange-500/40 bg-orange-500/5 px-4 py-3 text-sm text-orange-300">
              {t('settings.rec.noFfmpeg')}
            </div>
          )}

          {/* Auto-record toggle */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="auto-record" className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.autoRecord')}</label>
              <p id="auto-record-desc" className="text-xs text-hextech-text-dim mt-0.5">
                <Trans
                  i18nKey="settings.rec.autoRecordDesc"
                  components={{ em: <span className="text-hextech-text/90" /> }}
                />
              </p>
            </div>
            <Switch
              id="auto-record"
              checked={!!user?.autoRecord}
              disabled={togglingAutoRecord || ffmpegAvailable === false}
              onCheckedChange={() => handleToggleAutoRecord()}
              aria-describedby="auto-record-desc"
              className="mt-0.5"
            />
          </div>

          {/* What Ascend's own window does around a recorded game (both auto and manual). */}
          <div className="space-y-3 border-t border-hextech-border-dim/40 pt-3">
            <WindowSettingRow
              id="record-in-background"
              title={t('settings.recordWindow.background.title')}
              desc={t('settings.recordWindow.background.desc')}
              checked={user?.recordInBackground ?? true}
              disabled={!user}
              onChange={(v) => saveWindowSetting({ recordInBackground: v })}
            />
            <WindowSettingRow
              id="review-popup"
              title={t('settings.recordWindow.reviewPopup.title')}
              desc={t('settings.recordWindow.reviewPopup.desc')}
              checked={user?.reviewPopup ?? true}
              disabled={!user}
              onChange={(v) => saveWindowSetting({ reviewPopup: v })}
            />
          </div>

          {/* Live recording indicator */}
          {isRecording && (
            <div className="flex items-center gap-2 text-sm text-[#E24C3A]">
              <Circle className="h-2.5 w-2.5 fill-current animate-pulse" aria-hidden />
              <span className="font-medium">{t('settings.rec.inProgress')}</span>
              <Button variant="outline" size="sm" onClick={handleManualRecord} className="ml-auto text-xs border-[#E24C3A]/40 text-[#E24C3A] hover:bg-[#E24C3A]/10">
                {t('settings.rec.stopNow')}
              </Button>
            </div>
          )}

          {/* Manual record button (when auto-record is off) */}
          {!user?.autoRecord && !isRecording && ffmpegAvailable && (
            <Button variant="outline" size="sm" onClick={handleManualRecord} className="gap-2">
              <Circle className="h-3 w-3 fill-[#E24C3A] text-[#E24C3A]" aria-hidden />
              {t('settings.rec.startManual')}
            </Button>
          )}

          {/* ── Recording options (only when auto-record is on) ───────── */}
          {user?.autoRecord && <div className="space-y-4">

          {/* ── Quality ──────────────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p id="rec-quality" className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.quality')}</p>
            <div role="group" aria-labelledby="rec-quality" className="grid grid-cols-4 gap-1.5">
              {(['720p', '1080p', '1440p', 'source'] as const).map((q) => (
                <button
                  type="button"
                  key={q}
                  aria-pressed={user?.recordQuality === q}
                  disabled={!ffmpegAvailable}
                  onClick={async () => { await window.api.updateUser({ recordQuality: q }); await loadUser() }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
                    user?.recordQuality === q
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/40',
                  )}
                >
                  {q === 'source' ? t('settings.rec.source') : q}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-hextech-text-dim">
              {t('settings.rec.qualityHint')}
            </p>
          </div>

          {/* ── FPS ──────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p id="rec-fps" className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.fps')}</p>
            <div role="group" aria-labelledby="rec-fps" className="flex gap-2">
              {([30, 60] as const).map((fps) => (
                <button
                  type="button"
                  key={fps}
                  aria-pressed={user?.recordFps === fps}
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
            <p id="rec-encoder" className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.encoder')}</p>
            <div role="group" aria-labelledby="rec-encoder" className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'nvenc', label: 'NVIDIA GPU', sub: 'NVENC',  desc: 'GTX 950+', recommended: true },
                { value: 'amf',   label: 'AMD GPU',    sub: 'AMF',    desc: 'RX 400+',  recommended: true },
                { value: 'qsv',   label: 'Intel GPU',  sub: 'QSV',    desc: 'HD 4000+', recommended: true },
                { value: 'cpu',   label: 'CPU',         sub: 'x264',   desc: t('settings.rec.cpuFallback'), recommended: false },
              ]).map(({ value, label, sub, desc, recommended }) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={user?.recordEncoder === value}
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
              <p className="font-medium text-hextech-teal text-xs">{t('settings.rec.gpuTitle')}</p>
              <p>{t('settings.rec.gpuDesc')}</p>
            </div>
          </div>

          {/* ── Record scope ─────────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p id="rec-scope" className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.scope')}</p>
            <div role="radiogroup" aria-labelledby="rec-scope" className="space-y-1.5">
              {([
                { value: 'ranked_only', label: t('settings.rec.scopeRanked'), desc: t('settings.rec.scopeRankedDesc') },
                { value: 'all', label: t('settings.rec.scopeAll'), desc: t('settings.rec.scopeAllDesc') },
                { value: 'custom', label: t('settings.rec.scopeCustom'), desc: t('settings.rec.scopeCustomDesc') },
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
                  { key: 'recordModeNormal', label: t('settings.rec.modeNormal') },
                  { key: 'recordAllowCustom', label: t('settings.rec.modeCustom') },
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
            <div className="pt-1">
              <WindowSettingRow
                id="desktop-fallback"
                title={t('settings.rec.desktopFallback')}
                desc={t('settings.rec.desktopFallbackDesc')}
                checked={user?.allowDesktopFallback ?? true}
                onChange={async (v) => {
                  await window.api.updateUser({ allowDesktopFallback: v })
                  await loadUser()
                }}
              />
            </div>
          </div>

          {/* ── Recordings folder ─────────────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-hextech-border-dim/40">
            <p className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.folder')}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-xs text-hextech-text truncate min-w-0">
                {user?.recordingPath || recordingsDir || t('settings.rec.folderDefault')}
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
                    window.api.getRecordingsDir().then(setRecordingsDir).catch(() => {})
                  }
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                {t('settings.rec.browse')}
              </Button>
              {user?.recordingPath && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-hextech-text-dim hover:text-[#E24C3A]"
                  title={t('settings.rec.resetFolder')}
                  aria-label={t('settings.rec.resetFolder')}
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

          {/* ── Audio ─────────────────────────────────────────────────── */}
          {(() => {
            // Audio section — resolves selection/warnings from the IPC-backed
            // AudioDevicesSummary (stable OS-level ids).
            //
            // Desktop audio caveat: native-audio-node's SystemAudioRecorder
            // captures WASAPI loopback on the *current Windows default output*
            // and does not accept a device id. We still surface a dropdown so
            // the user can declare a *target* output, but if that target is
            // not the current Windows default we show a clear warning + a
            // shortcut to the native Windows sound panel where they can
            // actually change the default.
            const micInputs = audioDevices?.inputs ?? []
            const outputs = audioDevices?.outputs ?? []
            const defaultInputName = audioDevices?.defaultInputName ?? null
            const defaultOutputName = audioDevices?.defaultOutputName ?? null
            const defaultOutputId = audioDevices?.defaultOutputId ?? null

            const storedMicValue = user?.recordAudioMicDevice ?? null
            const selectedMicDevice = storedMicValue
              ? micInputs.find(d => d.id === storedMicValue || d.name === storedMicValue) ?? null
              : null
            const micSelectionMissing = !!storedMicValue && !selectedMicDevice && micInputs.length > 0
            // Show the stored raw value as a fallback option so Radix Select
            // has a matching SelectItem and never renders empty.
            const micSelectValue = storedMicValue ?? '__default__'

            const storedDesktopValue = user?.recordAudioDesktopDevice ?? null
            const selectedDesktopDevice = storedDesktopValue
              ? outputs.find(d => d.id === storedDesktopValue || d.name === storedDesktopValue) ?? null
              : null
            const desktopSelectionMissing = !!storedDesktopValue && !selectedDesktopDevice && outputs.length > 0
            const desktopSelectValue = storedDesktopValue ?? '__default__'
            // True when user targets a specific output that is *not* the
            // current Windows default — capture will NOT follow the selection.
            const desktopTargetMismatch =
              !!selectedDesktopDevice &&
              !!defaultOutputId &&
              selectedDesktopDevice.id !== defaultOutputId
            // What will *actually* be captured right now (always follows the
            // Windows default, regardless of the user's stored target).
            const actualCapturedName = defaultOutputName ?? t('settings.rec.noDefaultOutput')

            return (
              <div className="space-y-3 pt-2 border-t border-hextech-border-dim/40">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-hextech-text-bright">{t('settings.rec.audio')}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loadingAudioDevices}
                    onClick={refreshAudioDevices}
                    className="text-xs text-hextech-text-dim hover:text-hextech-text"
                  >
                    {loadingAudioDevices ? <Loader2 className="h-3 w-3 animate-spin" aria-label={t('common.loading')} /> : t('settings.rec.refreshDevices')}
                  </Button>
                </div>

                {/* Desktop audio — follows Windows default output (WASAPI loopback) */}
                <div className="space-y-2">
                  <WindowSettingRow
                    id="record-desktop-audio"
                    title={t('settings.rec.desktopAudio')}
                    desc={t('settings.rec.desktopAudioDesc')}
                    checked={user?.recordAudioDesktop ?? true}
                    onChange={async (v) => {
                      await window.api.updateUser({ recordAudioDesktop: v })
                      await loadUser()
                    }}
                  />

                  {(user?.recordAudioDesktop ?? true) && (
                    <div className="ml-1 space-y-1.5">
                      {outputs.length > 0 ? (
                        <Select
                          value={desktopSelectValue}
                          onValueChange={async (val) => {
                            await window.api.updateUser({
                              recordAudioDesktopDevice: val === '__default__' ? null : val,
                            })
                            await loadUser()
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label={t('settings.rec.outputDevice')}>
                            <SelectValue placeholder={t('settings.rec.followWindowsOutput')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__" className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <Volume2 className="h-3 w-3 text-hextech-teal" aria-hidden />
                                {defaultOutputName ? t('settings.rec.followWindowsNamed', { name: defaultOutputName }) : t('settings.rec.followWindows')}
                              </span>
                            </SelectItem>
                            {outputs.map((d) => (
                              <SelectItem key={d.id} value={d.id} className="text-xs">
                                {d.isDefault ? t('settings.rec.currentDefault', { name: d.name }) : d.name}
                              </SelectItem>
                            ))}
                            {desktopSelectionMissing && (
                              // Stale stored value — keep it visible so the
                              // user understands what they had picked before.
                              <SelectItem value={storedDesktopValue!} className="text-xs text-hextech-text-dim italic">
                                {t('settings.rec.unavailableDevice', { name: storedDesktopValue })}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-hextech-text-dim italic">
                          {t('settings.rec.noOutput')}
                        </p>
                      )}

                      {/* Always visible: what's actually going to be captured
                          right now. This is the source of truth — the Windows
                          default — since the native lib only does loopback on
                          the default endpoint. */}
                      <div className="flex items-start gap-1.5 text-[11px] text-hextech-text-dim leading-snug">
                        <Volume2 className="h-3 w-3 mt-0.5 shrink-0 text-hextech-teal/80" aria-hidden />
                        <span>
                          <Trans
                            i18nKey="settings.rec.currentlyCapturing"
                            values={{ name: actualCapturedName }}
                            components={{ b: <span className="text-hextech-text-bright" />, dim: <span className="text-hextech-text-dim/70" /> }}
                          />
                        </span>
                      </div>

                      {/* Mismatch warning — target ≠ current default. */}
                      {desktopTargetMismatch && (
                        <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 space-y-1.5">
                          <div className="flex items-start gap-1.5 text-[11px] text-amber-300 leading-snug">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                            <span>
                              <Trans
                                i18nKey="settings.rec.mismatch"
                                values={{ picked: selectedDesktopDevice!.name, current: defaultOutputName ?? t('settings.rec.unknown') }}
                                components={{ b: <span className="font-medium" />, hl: <span className="text-amber-200" /> }}
                              />
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1.5 text-[11px] px-2 border-amber-400/50 text-amber-200 hover:bg-amber-400/15 hover:text-amber-100"
                            onClick={async () => {
                              const res = await window.api.openSoundSettings()
                              if (!res.opened) {
                                toast({
                                  variant: 'destructive',
                                  title: t('settings.rec.soundSettingsFailed'),
                                  description: res.reason === 'unsupported-platform'
                                    ? t('settings.rec.windowsOnly')
                                    : (res.error ?? t('settings.rec.unknownError')),
                                })
                              }
                            }}
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            {t('settings.rec.openSoundSettings')}
                          </Button>
                        </div>
                      )}

                      {desktopSelectionMissing && (
                        <div className="flex items-start gap-1.5 text-[11px] text-amber-400/90">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                          <span>
                            {t('settings.rec.outputMissing')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Microphone */}
                <div className="space-y-2">
                  <WindowSettingRow
                    id="record-mic"
                    title={t('settings.rec.mic')}
                    desc={t('settings.rec.micDesc')}
                    checked={user?.recordAudioMic ?? true}
                    onChange={async (v) => {
                      await window.api.updateUser({ recordAudioMic: v })
                      await loadUser()
                    }}
                  />

                  {(user?.recordAudioMic ?? true) && (
                    <div className="ml-1 space-y-1.5">
                      {micInputs.length > 0 ? (
                        <Select
                          value={micSelectValue}
                          onValueChange={async (val) => {
                            await window.api.updateUser({ recordAudioMicDevice: val === '__default__' ? null : val })
                            await loadUser()
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label={t('settings.rec.micDevice')}>
                            <SelectValue placeholder={t('settings.rec.systemDefaultFollows')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__" className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <Mic className="h-3 w-3 text-hextech-teal" aria-hidden />
                                {defaultInputName ? t('settings.rec.systemDefaultNamed', { name: defaultInputName }) : t('settings.rec.systemDefault')}
                              </span>
                            </SelectItem>
                            {micInputs.map((d) => (
                              <SelectItem key={d.id} value={d.id} className="text-xs">
                                {d.isDefault ? t('settings.rec.defaultDevice', { name: d.name }) : d.name}
                              </SelectItem>
                            ))}
                            {micSelectionMissing && (
                              // Render the stale stored value so Radix keeps the
                              // selection visible until user picks a new device.
                              <SelectItem value={storedMicValue!} className="text-xs text-hextech-text-dim italic">
                                {t('settings.rec.unavailableDevice', { name: storedMicValue })}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-hextech-text-dim italic">
                          {t('settings.rec.noMic')}
                        </p>
                      )}

                      {micSelectionMissing && (
                        <div className="flex items-start gap-1.5 text-[11px] text-amber-400/90">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                          <span>
                            {t('settings.rec.micMissing')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          </div>}
        </CardContent>
      </Card>

      {/* ── External recordings folder ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-hextech-gold" aria-hidden />
            {t('settings.rec.externalFolder')}
          </CardTitle>
          <CardDescription>
            {t('settings.rec.externalFolderDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-xs text-hextech-text truncate min-w-0">
              {user?.externalRecordingPath || <span className="text-hextech-text-dim/60">{t('settings.rec.externalNotSet')}</span>}
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
                  window.api.scanRecordings().catch(() => {})
                  toast({ title: t('recording.folderChanged') })
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              {t('settings.rec.browse')}
            </Button>
            {user?.externalRecordingPath && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-hextech-text-dim hover:text-[#E24C3A]"
                title={t('settings.rec.clearFolder')}
                aria-label={t('settings.rec.clearFolder')}
                onClick={async () => {
                  await window.api.updateUser({ externalRecordingPath: null })
                  await loadUser()
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Button
            variant="link"
            size="sm"
            className="mt-2 h-auto p-0 text-xs text-hextech-text-dim hover:text-hextech-gold"
            onClick={async () => {
              await window.api.resetDismissedRecordings()
              toast({ title: t('recording.resetDismissedDone') })
            }}
          >
            {t('recording.resetDismissed')}
          </Button>
        </CardContent>
      </Card>

      {/* ── YouTube upload ──────────────────────────────────────────────────── */}
      {youtubeUpload && <YouTubeCard />}

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
                        className="rounded p-1.5 text-hextech-text-dim hover:text-[#E24C3A] hover:bg-[#E24C3A]/10 transition-colors"
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
                      {PLATFORM_REGIONS.map((r) => (
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

      {/* ── Ascend account: cloud backups, sign-out, account deletion ──────── */}
      <CloudAccountCard />
      <AccessInvitesCard webUrl={DEFAULT_WEB_URL} />

      {/* ── Backup & Sync (manual multi-PC) ──────────────────────────────────── */}
      <BackupCard />

      {/* ── Danger Zone — destructive bulk cleanups ──────────────────────────── */}
      <DangerZoneCard />
    </div>
  )
}

/** One on/off setting of the recording card: title, explanation, switch. */
function WindowSettingRow({ id, title, desc, checked, disabled, onChange }: {
  id: string
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-hextech-text-bright">{title}</label>
        <p id={`${id}-desc`} className="mt-0.5 text-xs text-hextech-text-dim">{desc}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-describedby={`${id}-desc`} className="mt-0.5" />
    </div>
  )
}

// ── Danger Zone sub-component ────────────────────────────────────────────────

function DangerZoneCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [resetting, setResetting] = useState(false)
  // Recent-window cleanup: which day-range is pending confirmation (null = idle).
  const [pendingDays, setPendingDays] = useState<number | null>(null)
  const [clearingRecent, setClearingRecent] = useState(false)
  // Sync-leak cleanup (beta.104): null = not checked yet.
  const [foreignAudit, setForeignAudit] = useState<Record<string, number> | null>(null)
  const [auditingForeign, setAuditingForeign] = useState(false)
  const [confirmRemoveForeign, setConfirmRemoveForeign] = useState(false)
  const [removingForeign, setRemovingForeign] = useState(false)

  const RECENT_OPTIONS = [
    { days: 1, label: t('settings.danger.range24h') },
    { days: 3, label: t('settings.danger.range3d') },
    { days: 7, label: t('settings.danger.rangeWeek') },
  ]
  const rangeLabel = (days: number) => (days === 1 ? t('settings.danger.range24h') : t('settings.danger.rangeDays', { count: days }))
  const unknown = t('settings.rec.unknownError')

  const handleClearRecent = async (days: number) => {
    setClearingRecent(true)
    try {
      const r = await window.api.clearRecentData(days)
      toast({
        title: t('settings.danger.recentCleared'),
        description: t('settings.danger.recentClearedDesc', { games: r.games, recordings: r.recordings, files: r.files, mistakes: r.mistakes, range: rangeLabel(days) }),
        variant: 'success',
      })
      setPendingDays(null)
      setTimeout(() => window.location.reload(), 800)
    } catch (err: any) {
      toast({ title: t('settings.danger.clearFailed'), description: err?.message ?? unknown, variant: 'destructive' })
    } finally {
      setClearingRecent(false)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    try {
      const r = await window.api.clearStatsMistakes()
      toast({
        title: t('settings.danger.statsCleared'),
        description: t('settings.danger.statsClearedDesc', { mistakes: r.mistakes, detailedStats: r.detailedStats, snapshots: r.snapshots, lanePhase: r.lanePhase }),
        variant: 'success',
      })
      setConfirmClear(false)
      // Reload so every cached stats/mistakes view reflects the wipe.
      setTimeout(() => window.location.reload(), 700)
    } catch (err: any) {
      toast({ title: t('settings.danger.clearFailed'), description: err?.message ?? unknown, variant: 'destructive' })
    } finally {
      setClearing(false)
    }
  }

  const handleAuditForeign = async () => {
    setAuditingForeign(true)
    setConfirmRemoveForeign(false)
    try {
      setForeignAudit(await window.api.syncAuditForeignRows())
    } catch (err: any) {
      toast({ title: t('settings.danger.checkFailed'), description: err?.message ?? unknown, variant: 'destructive' })
    } finally {
      setAuditingForeign(false)
    }
  }

  const handleRemoveForeign = async () => {
    setRemovingForeign(true)
    try {
      const deleted = await window.api.syncDeleteForeignRows()
      const total = Object.values(deleted).reduce((a, b) => a + b, 0)
      toast({
        title: t('settings.danger.cleaned'),
        description: total > 0
          ? t('settings.danger.cleanedDesc', { count: total, detail: Object.entries(deleted).map(([table, n]) => `${n} ${table}`).join(', ') })
          : t('settings.danger.nothingLeft'),
        variant: 'success',
      })
      setForeignAudit(null)
      setConfirmRemoveForeign(false)
    } catch (err: any) {
      toast({ title: t('settings.danger.cleanupFailed'), description: err?.message ?? unknown, variant: 'destructive' })
    } finally {
      setRemovingForeign(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const r = await window.api.resetAllData()
      toast({
        title: t('settings.danger.resetDone'),
        description: t('settings.danger.resetDoneDesc', { games: r.games, recordings: r.recordings, files: r.files }),
        variant: 'success',
      })
      setConfirmReset(false)
      setTimeout(() => window.location.reload(), 900)
    } catch (err: any) {
      toast({ title: t('settings.danger.resetFailed'), description: err?.message ?? unknown, variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }

  return (
    <Card className="border-[#E24C3A]/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#E24C3A]">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          {t('settings.danger.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.danger.desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Clear stats & mistakes */}
        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-hextech-text-bright">{t('settings.danger.clearStats')}</p>
            <p className="text-xs text-hextech-text-dim mt-0.5">
              {t('settings.danger.clearStatsDesc')}
            </p>
          </div>
          {confirmClear ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="destructive" size="sm" disabled={clearing} onClick={handleClear} className="gap-1.5">
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                {t('settings.danger.confirmClear')}
              </Button>
              <Button variant="ghost" size="sm" disabled={clearing} onClick={() => setConfirmClear(false)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <Button
              variant="outline" size="sm"
              onClick={() => setConfirmClear(true)}
              className="shrink-0 gap-1.5 border-[#E24C3A]/40 text-[#E24C3A] hover:bg-[#E24C3A]/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('settings.danger.clearStats')}
            </Button>
          )}
        </div>

        {/* Clear recent data (time-scoped) */}
        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p id="danger-recent" className="text-sm font-medium text-hextech-text-bright">{t('settings.danger.clearRecent')}</p>
            <p className="text-xs text-hextech-text-dim mt-0.5">
              {t('settings.danger.clearRecentDesc')}
            </p>
          </div>
          {pendingDays !== null ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="destructive" size="sm" disabled={clearingRecent} onClick={() => handleClearRecent(pendingDays)} className="gap-1.5">
                {clearingRecent ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                {t('settings.danger.deleteLast', { range: rangeLabel(pendingDays) })}
              </Button>
              <Button variant="ghost" size="sm" disabled={clearingRecent} onClick={() => setPendingDays(null)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <div role="group" aria-labelledby="danger-recent" className="flex items-center gap-1.5 shrink-0">
              {RECENT_OPTIONS.map((o) => (
                <Button
                  key={o.days}
                  variant="outline" size="sm"
                  onClick={() => setPendingDays(o.days)}
                  className="gap-1.5 border-[#E24C3A]/40 text-[#E24C3A] hover:bg-[#E24C3A]/10"
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Sync-leak cleanup (beta.104) */}
        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-hextech-text-bright">{t('settings.danger.foreignTitle')}</p>
            <p className="text-xs text-hextech-text-dim mt-0.5">
              {t('settings.danger.foreignDesc')}
            </p>
            {foreignAudit && (
              Object.keys(foreignAudit).length === 0 ? (
                <p role="status" className="text-xs text-hextech-green mt-1.5">{t('settings.danger.foreignNone')}</p>
              ) : (
                <p role="status" className="text-xs text-orange-300 mt-1.5">
                  {t('settings.danger.foreignFound', {
                    count: Object.values(foreignAudit).reduce((a, b) => a + b, 0),
                    tables: Object.entries(foreignAudit).map(([table, n]) => `${table} (${n})`).join(', '),
                  })}
                </p>
              )
            )}
          </div>
          {confirmRemoveForeign ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="destructive" size="sm" disabled={removingForeign} onClick={handleRemoveForeign} className="gap-1.5">
                {removingForeign ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                {t('settings.danger.confirmRemoval')}
              </Button>
              <Button variant="ghost" size="sm" disabled={removingForeign} onClick={() => setConfirmRemoveForeign(false)}>{t('common.cancel')}</Button>
            </div>
          ) : foreignAudit && Object.keys(foreignAudit).length > 0 ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmRemoveForeign(true)} className="shrink-0 gap-1.5">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('settings.danger.removeIt')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={auditingForeign} onClick={handleAuditForeign} className="shrink-0 gap-1.5">
              {auditingForeign ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {t('settings.danger.check')}
            </Button>
          )}
        </div>

        {/* Full reset */}
        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-[#E24C3A]/30 bg-[#E24C3A]/5 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-hextech-text-bright">{t('settings.danger.resetAll')}</p>
            <p className="text-xs text-hextech-text-dim mt-0.5">
              <Trans i18nKey="settings.danger.resetAllDesc" components={{ all: <span className="text-[#FF8694] font-medium" /> }} />
            </p>
          </div>
          {confirmReset ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="destructive" size="sm" disabled={resetting} onClick={handleReset} className="gap-1.5">
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
                {t('settings.danger.confirmReset')}
              </Button>
              <Button variant="ghost" size="sm" disabled={resetting} onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset(true)} className="shrink-0 gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {t('settings.danger.resetAll')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Backup & Sync sub-component ──────────────────────────────────────────────

function BackupCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmImport, setConfirmImport] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const result = await window.api.exportBackup()
      if (result.canceled) return
      const c = result.counts
      toast({
        title: t('settings.backup.exportDone'),
        description: t('settings.backup.exportSummary', {
          path: result.filePath,
          sessions: c.sessions,
          games: c.games,
          reviews: c.reviews,
        }),
        variant: 'success',
      })
    } catch (err: any) {
      toast({
        title: t('settings.backup.exportFailed'),
        description: err?.message ?? String(err),
        variant: 'destructive',
      })
    } finally { setExporting(false) }
  }

  const handleImport = async () => {
    setConfirmImport(false)
    setImporting(true)
    try {
      const result = await window.api.importBackup()
      if (result.canceled) return
      const s = result.summary
      toast({
        title: t('settings.backup.importDone'),
        description: t('settings.backup.importSummary', {
          sessions: s.sessionsAdded,
          games: s.gamesAdded,
          reviews: s.reviewsAdded,
          recordings: s.recordingsAdded,
          conflicts: s.conflicts,
        }),
        variant: 'success',
      })
    } catch (err: any) {
      toast({
        title: t('settings.backup.importFailed'),
        description: err?.message ?? String(err),
        variant: 'destructive',
      })
    } finally { setImporting(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-hextech-gold" />
          {t('settings.backup.title')}
        </CardTitle>
        <CardDescription>{t('settings.backup.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-hextech-border-dim bg-hextech-elevated/40 p-3 text-xs text-hextech-text-dim">
          {t('settings.backup.note')}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            {exporting
              ? <><Loader2 className="h-4 w-4 animate-spin" />{t('settings.backup.exporting')}</>
              : t('settings.backup.exportButton')}
          </Button>

          {confirmImport ? (
            <div className="flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-1.5">
              <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
              <span className="text-xs text-orange-200">{t('settings.backup.importConfirm')}</span>
              <Button size="sm" variant="default" onClick={handleImport} disabled={importing} className="h-7 text-xs gap-1.5">
                {importing
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('settings.backup.importing')}</>
                  : t('settings.backup.confirmImportButton')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmImport(false)} className="h-7 text-xs">
                {t('settings.backup.cancelButton')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirmImport(true)} disabled={importing} className="gap-2">
              {importing
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t('settings.backup.importing')}</>
                : t('settings.backup.importButton')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Discord webhook sub-component ────────────────────────────────────────────

function DiscordWebhookCard() {
  const { t } = useTranslation()
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
      toast({ title: t('settings.discord.added'), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('settings.discord.addFailed'), description: err?.message, variant: 'destructive' })
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
      toast({ title: t('settings.discord.renameFailed'), description: err?.message, variant: 'destructive' })
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
      toast({ title: t('settings.discord.removed'), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('settings.discord.removeFailed'), description: err?.message, variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (wh: DiscordWebhook) => {
    setTestingId(wh.id)
    try {
      await window.api.sendToDiscord([{
        title: t('settings.discord.testEmbedTitle'),
        description: t('settings.discord.testEmbedDesc', { name: wh.name }),
        color: 0xc89b3c,
        footer: { text: 'Ascend' },
        timestamp: new Date().toISOString(),
      }], wh.url)
      toast({ title: t('settings.discord.testSent', { name: wh.name }), variant: 'gold' })
    } catch (err: any) {
      toast({ title: t('settings.discord.testFailed'), description: err.message, variant: 'destructive' })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-[#5865F2] text-lg font-bold leading-none" aria-hidden>ᴅ</span>
          {t('settings.discord.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.discord.desc')}
          {' '}<a href="https://support.discord.com/hc/en-us/articles/228383668" target="_blank" rel="noreferrer" className="underline hover:text-hextech-text transition-colors">{t('settings.discord.howTo')}</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Webhook list */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-hextech-text-dim py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('common.loading')}
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-xs text-hextech-text-dim/70 py-1">
            {t('settings.discord.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="flex items-center gap-2 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2.5"
              >
                <span className="text-[#5865F2] text-sm font-bold leading-none shrink-0" aria-hidden>ᴅ</span>

                <div className="flex-1 min-w-0">
                  {renamingId === wh.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        aria-label={t('settings.discord.nameLabel')}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSave(wh.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 min-w-0 rounded border border-[#5865F2]/60 bg-hextech-dark px-2 py-0.5 text-xs text-hextech-text focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRenameSave(wh.id)}
                        disabled={renamingSaving}
                        aria-label={t('settings.discord.saveName')}
                        className="text-hextech-teal hover:text-hextech-teal/80 disabled:opacity-50"
                      >
                        {renamingSaving
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          : <Check className="h-3.5 w-3.5" aria-hidden />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        aria-label={t('common.cancel')}
                        className="text-hextech-text-dim hover:text-hextech-text"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
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
                      type="button"
                      onClick={() => handleTest(wh)}
                      disabled={testingId === wh.id}
                      title={t('settings.discord.test')}
                      aria-label={t('settings.discord.testAria', { name: wh.name })}
                      className="rounded p-1.5 text-hextech-text-dim hover:text-hextech-gold hover:bg-hextech-gold/10 transition-colors disabled:opacity-50"
                    >
                      {testingId === wh.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        : <FlaskConical className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                    {/* Rename */}
                    <button
                      type="button"
                      onClick={() => handleRenameStart(wh)}
                      title={t('settings.discord.rename')}
                      aria-label={t('settings.discord.renameAria', { name: wh.name })}
                      className="rounded p-1.5 text-hextech-text-dim hover:text-hextech-text hover:bg-white/5 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    {/* Delete */}
                    {confirmDeleteId === wh.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-hextech-text-dim">{t('settings.discord.removeQ')}</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(wh.id)}
                          disabled={deletingId === wh.id}
                          className="rounded px-2 py-0.5 text-[10px] font-medium text-white bg-[#E24C3A] hover:bg-[#E24C3A]/80 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === wh.id ? <Loader2 className="h-3 w-3 animate-spin" aria-label={t('common.loading')} /> : t('settings.discord.yes')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-hextech-text-dim hover:text-hextech-text text-[10px]"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(wh.id)}
                        title={t('settings.discord.remove')}
                        aria-label={t('settings.discord.removeAria', { name: wh.name })}
                        className="rounded p-1.5 text-hextech-text-dim hover:text-[#E24C3A] hover:bg-[#E24C3A]/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
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
                <label htmlFor="webhook-name" className="text-[10px] font-medium text-hextech-text-dim uppercase tracking-wide">{t('settings.discord.nameLabel')}</label>
                <input
                  id="webhook-name"
                  autoFocus
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={t('settings.discord.namePlaceholder')}
                  className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2.5 py-1.5 text-xs text-hextech-text placeholder:text-hextech-text-dim/40 focus:outline-none focus:border-[#5865F2]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="webhook-url" className="text-[10px] font-medium text-hextech-text-dim uppercase tracking-wide">{t('settings.discord.urlLabel')}</label>
                <input
                  id="webhook-url"
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
                {adding ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
                {t('settings.discord.add')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => { setShowAddForm(false); setAddName(''); setAddUrl('') }}
              >
                {t('common.cancel')}
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
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('settings.discord.add')}
          </Button>
        )}

        <p className="text-[11px] text-hextech-text-dim">
          {t('settings.discord.localOnly')}
        </p>
      </CardContent>
    </Card>
  )
}

// ── YouTube Card ─────────────────────────────────────────────────────────────

function YouTubeCard() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<{ connected: boolean; channelName: string | null }>({
    connected: false,
    channelName: null,
  })
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.youtubeGetStatus().then(setStatus).catch(() => {})
  }, [])

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const result = await window.api.youtubeAuthStart()
      setStatus({ connected: result.connected, channelName: result.channelName })
    } catch (err: any) {
      setError(err?.message ?? t('settings.youtube.connectFailed'))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await window.api.youtubeDisconnect()
    setStatus({ connected: false, channelName: null })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-500" aria-hidden />
          {t('settings.youtube.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.youtube.desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-400" />
              <div>
                <p className="text-sm font-medium text-hextech-text-bright">{t('settings.youtube.connected')}</p>
                {status.channelName && (
                  <p className="text-xs text-hextech-text-dim">{status.channelName}</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-[#E24C3A] border-[#E24C3A]/30 hover:bg-[#E24C3A]/10 text-xs"
              onClick={handleDisconnect}
            >
              {t('settings.youtube.disconnect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-400">
              <p className="font-medium mb-1">{t('settings.youtube.setupTitle')}</p>
              <p><Trans i18nKey="settings.youtube.setupDesc" components={{ code: <code className="font-mono bg-white/5 px-1 rounded" /> }} /></p>
            </div>
            {error && (
              <p className="text-xs text-[#E24C3A] bg-[#E24C3A]/10 border border-[#E24C3A]/30 rounded px-3 py-2">
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
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Youtube className="h-4 w-4" aria-hidden />}
              {connecting ? t('settings.youtube.connecting') : t('settings.youtube.connect')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
