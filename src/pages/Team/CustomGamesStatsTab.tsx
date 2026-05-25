/**
 * CustomGamesStatsTab — generic tab for user-imported scrim or tournament
 * data. Renders:
 *   - CSV import controls with filename-based type detection + warning if
 *     the filename doesn't contain the expected keyword (scrim/tournoi).
 *   - List of imported games (with delete).
 *   - Synergy-style stats aggregated from those games, reusing
 *     `SynergyPlayerCard` for visual consistency with the flex stats tab.
 *
 * Instantiated twice by TeamPage (one for `gameType="scrim"`, one for
 * `gameType="tournament"`), so the same code powers both tabs.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Loader2, Upload, Trash2, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { compareByRole } from '@/lib/championRoles'
import type { Team, TeamSynergyStats, CustomGame } from '@/lib/ipc'
import { SynergyPlayerCard } from './SynergyPlayerCard'

interface Props {
  team: Team | null
  gameType: 'scrim' | 'tournament'
}

export function CustomGamesStatsTab({ team, gameType }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [games, setGames] = useState<CustomGame[]>([])
  const [stats, setStats] = useState<TeamSynergyStats | null>(null)
  const [importing, setImporting] = useState(false)
  const [computing, setComputing] = useState(false)
  // Files picked in the last batch whose filenames don't unambiguously
  // resolve to the current tab's gameType (no `scrim`/`tournoi` keyword,
  // or the opposite keyword). User reviews them and confirms the type to
  // apply to all at once.
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  // Imported games list is collapsed by default so it doesn't push the
  // stats grid (the main signal) below the fold. User can toggle by
  // clicking the section header.
  const [showImportedList, setShowImportedList] = useState(false)
  // Hidden <input type="file" multiple> — renderer-side picking lets us
  // read each file as text and ship it to the backend handler one IPC
  // round-trip per file, with batch summarization in the renderer.
  const fileInputRef = useRef<HTMLInputElement>(null)

  const labels = useMemo(() => labelsFor(gameType, t), [gameType, t])
  const sortedPlayers = useMemo(() => {
    if (!stats) return []
    return [...stats.players].sort(compareByRole)
  }, [stats])

  // Initial load + reload when team or gameType changes
  useEffect(() => {
    if (!team) {
      setGames([])
      setStats(null)
      return
    }
    void reload(team.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, gameType])

  const reload = async (teamId: string) => {
    try {
      const list = await window.api.listCustomGames(teamId, gameType)
      setGames(list)
      if (list.length > 0) {
        await recompute(teamId)
      } else {
        setStats(null)
      }
    } catch (err) {
      console.warn('[CustomGamesStatsTab] reload failed', err)
    }
  }

  const recompute = async (teamId: string) => {
    setComputing(true)
    try {
      const res = await window.api.computeCustomStats(teamId, gameType)
      setStats(res)
    } catch (err) {
      console.warn('[CustomGamesStatsTab] compute failed', err)
    } finally {
      setComputing(false)
    }
  }

  // Trigger the hidden file input. Using the renderer's file picker (rather
  // than the main-process showOpenDialog) keeps the CSV text in scope here
  // so we can pre-validate filenames and batch the IPC calls.
  const handlePickFile = () => fileInputRef.current?.click()

  /**
   * Best-effort filename → gameType detection used to decide which files
   * can be auto-imported vs. need user confirmation. Keep in sync with the
   * backend's own detection in `team:import-custom-game-csv`.
   */
  const detectTypeFromFilename = (name: string): 'scrim' | 'tournament' | null => {
    const lower = name.toLowerCase()
    if (lower.includes('scrim')) return 'scrim'
    if (lower.includes('tournoi') || lower.includes('tournament')) return 'tournament'
    return null
  }

  /**
   * Import a list of files concurrently-ish (serially to avoid hammering
   * sqlite). Returns aggregate counters for the toast summary.
   */
  const importBatch = async (
    files: File[],
    forceType?: 'scrim' | 'tournament',
  ): Promise<{ imported: number; participants: number; failed: { name: string; reason: string }[] }> => {
    if (!team || files.length === 0) return { imported: 0, participants: 0, failed: [] }
    let imported = 0
    let participants = 0
    const failed: { name: string; reason: string }[] = []
    for (const file of files) {
      try {
        const csvContent = await file.text()
        const res = await window.api.importCustomGameCsv(team.id, {
          csvContent,
          filename: file.name,
          ...(forceType ? { forceType } : {}),
        })
        if ('canceled' in res && res.canceled) continue
        // Backend "filename-missing-type" warnings shouldn't happen here
        // because we only call importBatch with files we've already
        // classified or after the user confirms a forceType. Treat as
        // failure for safety.
        if ('warning' in res) {
          failed.push({ name: file.name, reason: 'filename-missing-type' })
          continue
        }
        imported++
        if ('participants' in res) participants += res.participants
      } catch (err) {
        failed.push({ name: file.name, reason: (err as Error).message })
      }
    }
    return { imported, participants, failed }
  }

  const handleFilesChosen = async (files: File[]) => {
    if (!team || files.length === 0) return
    setImporting(true)
    setPendingFiles([])
    try {
      // Pre-classify: filenames matching the current tab's type go straight
      // through. Anything ambiguous (no keyword) or mismatched (opposite
      // keyword) is collected for user confirmation via the pending banner.
      const matched: File[] = []
      const ambiguous: File[] = []
      for (const file of files) {
        const detected = detectTypeFromFilename(file.name)
        if (detected === gameType) matched.push(file)
        else ambiguous.push(file)
      }

      const matchedResult = await importBatch(matched, gameType)

      if (matchedResult.imported > 0) {
        toast({
          title: t('team.custom.batchImported', {
            defaultValue: '{{n}} game(s) imported',
            n: matchedResult.imported,
          }),
          description: t('team.custom.batchImportedDesc', {
            defaultValue: '{{p}} total participants across {{n}} files',
            p: matchedResult.participants,
            n: matchedResult.imported,
          }),
        })
      }
      if (matchedResult.failed.length > 0) {
        toast({
          title: t('team.custom.someFailed', {
            defaultValue: '{{n}} file(s) failed to import',
            n: matchedResult.failed.length,
          }),
          description: matchedResult.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'),
          variant: 'destructive',
        })
      }
      if (ambiguous.length > 0) {
        setPendingFiles(ambiguous)
      }

      await reload(team.id)
    } finally {
      setImporting(false)
      // Reset input so picking the same file twice still triggers `change`
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleConfirmPending = async (forceType: 'scrim' | 'tournament') => {
    if (!team || pendingFiles.length === 0) return
    setImporting(true)
    try {
      const result = await importBatch(pendingFiles, forceType)
      if (result.imported > 0) {
        toast({
          title: t('team.custom.batchImported', {
            defaultValue: '{{n}} game(s) imported',
            n: result.imported,
          }),
        })
      }
      if (result.failed.length > 0) {
        toast({
          title: t('team.custom.someFailed', {
            defaultValue: '{{n}} file(s) failed to import',
            n: result.failed.length,
          }),
          description: result.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'),
          variant: 'destructive',
        })
      }
      setPendingFiles([])
      await reload(team.id)
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!team) return
    if (!confirm(t('team.custom.confirmDelete', { defaultValue: 'Delete this imported game?' }))) return
    try {
      await window.api.deleteCustomGame(id)
      await reload(team.id)
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error).message, variant: 'destructive' })
    }
  }

  if (!team) {
    return (
      <Card className="p-6 text-center text-hextech-text-dim">
        {t('team.dashboard.noTeam', { defaultValue: 'Select or create a team first.' })}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col">
            <h3 className="text-sm font-bold text-hextech-text-bright">{labels.title}</h3>
            <p className="text-xs text-hextech-text-dim">{labels.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {games.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => recompute(team.id)}
                disabled={computing}
                title={t('team.custom.recomputeHint', { defaultValue: 'Recompute averages from the imported games' })}
              >
                {computing
                  ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                {t('team.stats.refresh', { defaultValue: 'Refresh' })}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handlePickFile}
              disabled={importing}
            >
              {importing
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5 mr-1.5" />}
              {labels.importBtn}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) void handleFilesChosen(files)
              }}
            />
          </div>
        </div>
        <p className="mt-2 text-[10px] text-hextech-text-dim italic">
          {labels.filenameHint}
        </p>
      </Card>

      {pendingFiles.length > 0 && (
        <Card className="p-3 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-200 font-semibold">
                {t('team.custom.warningTitleBatch', {
                  defaultValue: '{{n}} file(s) need a type confirmation',
                  n: pendingFiles.length,
                })}
              </p>
              <p className="text-xs text-hextech-text-dim mt-0.5">
                {t('team.custom.warningDescBatch', {
                  defaultValue: 'These filenames don\'t clearly indicate "{{type}}". Confirm to import all as {{type}}, or cancel and rename them.',
                  type: gameType === 'scrim' ? t('team.tabs.statsScrim', { defaultValue: 'scrim' }) : t('team.tabs.statsTournament', { defaultValue: 'tournament' }),
                })}
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto text-[10px] text-hextech-text-dim font-mono space-y-0.5 pl-1">
                {pendingFiles.map((f, i) => (
                  <li key={i} className="truncate" title={f.name}>· {f.name}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleConfirmPending(gameType)}
                  disabled={importing}
                >
                  {importing
                    ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    : null}
                  {gameType === 'scrim'
                    ? t('team.custom.importAllAsScrim', {
                        defaultValue: 'Import all {{n}} as scrim',
                        n: pendingFiles.length,
                      })
                    : t('team.custom.importAllAsTournament', {
                        defaultValue: 'Import all {{n}} as tournament',
                        n: pendingFiles.length,
                      })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingFiles([])}
                  disabled={importing}
                >
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Imported games list — collapsed by default. Header acts as
          toggle. When expanded, the list caps at ~3 rows tall and scrolls
          beyond that so a large import doesn't blow up the page height. */}
      <Card className="p-3">
        <button
          type="button"
          onClick={() => setShowImportedList((v) => !v)}
          className="w-full flex items-center gap-1.5 text-xs uppercase tracking-wider text-hextech-text-dim font-semibold hover:text-hextech-text transition-colors"
        >
          {showImportedList
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
          <span>{t('team.custom.importedGames', { defaultValue: 'Imported games ({{n}})', n: games.length })}</span>
        </button>
        {showImportedList && (
          games.length === 0 ? (
            <p className="text-xs text-hextech-text-dim italic text-center py-3 mt-2">
              {labels.emptyList}
            </p>
          ) : (
            // ~3 rows visible (~30px each + space-y-1 4px gap → 108px).
            // Any 4th+ row is partially clipped to hint at scrollability.
            <div className="space-y-1 max-h-[7rem] overflow-y-auto mt-2 pr-1">
              {games.map((g) => (
                <div key={g.id} className="flex items-center gap-2 px-2 py-1.5 bg-hextech-dark/40 rounded text-xs">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                    g.win === true ? 'bg-emerald-500/20 text-emerald-300' :
                    g.win === false ? 'bg-red-500/20 text-red-300' :
                    'bg-zinc-500/20 text-zinc-300',
                  )}>
                    {g.win === true ? 'W' : g.win === false ? 'L' : '?'}
                  </span>
                  <span className="text-hextech-text-bright truncate flex-1">{g.sourceFile ?? g.id}</span>
                  <span className="text-hextech-text-dim shrink-0 tabular-nums">{Math.round(g.durationSec / 60)}m</span>
                  <span className="text-hextech-text-dim shrink-0">{new Date(g.importedAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="text-hextech-text-dim hover:text-red-400 transition-colors"
                    title={t('common.delete', { defaultValue: 'Delete' })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </Card>

      {/* Aggregated stats */}
      {stats && stats.matchCount > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {sortedPlayers.map((p) => (
            <SynergyPlayerCard key={p.memberId} player={p} matchCount={stats.matchCount} />
          ))}
        </div>
      ) : games.length > 0 ? (
        <Card className="p-6 text-center text-hextech-text-dim">
          {computing
            ? <Loader2 className="h-6 w-6 mx-auto animate-spin text-hextech-gold" />
            : t('team.custom.noMatchedRoster', {
                defaultValue: 'No imported games matched your roster by player name. Check that team members\' IGN matches the CSV names.',
              })}
        </Card>
      ) : null}
    </div>
  )
}

function labelsFor(gameType: 'scrim' | 'tournament', t: (k: string, opts?: any) => string) {
  if (gameType === 'scrim') {
    return {
      title: t('team.custom.scrim.title', { defaultValue: 'Scrim stats' }),
      subtitle: t('team.custom.scrim.subtitle', { defaultValue: 'Import Replaybook CSV exports of your scrim games.' }),
      importBtn: t('team.custom.scrim.import', { defaultValue: 'Import scrim CSV' }),
      filenameHint: t('team.custom.scrim.filenameHint', {
        defaultValue: 'CSV filename must contain "scrim" (case-insensitive) to be auto-detected.',
      }),
      emptyList: t('team.custom.scrim.empty', { defaultValue: 'No scrim games imported yet.' }),
    }
  }
  return {
    title: t('team.custom.tournament.title', { defaultValue: 'Tournament stats' }),
    subtitle: t('team.custom.tournament.subtitle', { defaultValue: 'Import Replaybook CSV exports of your tournament games.' }),
    importBtn: t('team.custom.tournament.import', { defaultValue: 'Import tournament CSV' }),
    filenameHint: t('team.custom.tournament.filenameHint', {
      defaultValue: 'CSV filename must contain "tournoi" or "tournament" to be auto-detected.',
    }),
    emptyList: t('team.custom.tournament.empty', { defaultValue: 'No tournament games imported yet.' }),
  }
}
