import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { Trash2, AlertCircle, Wand2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseMultiGgUrl, type ParsedPlayer } from '@/lib/multiGgParser'

const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const
type Role = (typeof ROLES)[number]

interface DraftPlayer extends ParsedPlayer {
  role: Role
}

interface BulkImportModalProps {
  open: boolean
  onClose: () => void
  /**
   * Called once per imported player. The implementation decides whether to
   * call `team:add-member` (Roster) or do something custom (e.g. auto-scout).
   * Should throw on per-player failure; the modal catches and reports.
   */
  onImport: (player: DraftPlayer) => Promise<void>
  /** Default region pre-selected (e.g. the active user's region). */
  defaultRegion?: string
  /** Title shown in the modal header (e.g. "Import roster" vs "Import opponents"). */
  title?: string
  /** Description below the title. */
  description?: string
}

const REGIONS = ['EUW1', 'EUN1', 'NA1', 'KR', 'BR1', 'LA1', 'LA2', 'OC1', 'TR1', 'RU', 'JP1', 'PH2', 'SG2', 'TW2', 'TH2', 'VN2', 'ME1']

export function BulkImportModal({
  open, onClose, onImport, defaultRegion = 'EUW1', title, description,
}: BulkImportModalProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [input, setInput] = useState('')
  const [players, setPlayers] = useState<DraftPlayer[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [fallbackRegion, setFallbackRegion] = useState(defaultRegion)
  const [importing, setImporting] = useState(false)

  // Reset state whenever the modal is closed
  useEffect(() => {
    if (!open) {
      setInput('')
      setPlayers([])
      setWarnings([])
      setImporting(false)
    }
  }, [open])

  // Re-parse on every input change. Cheap (~ms), keeps preview live.
  useEffect(() => {
    if (!input.trim()) {
      setPlayers([])
      setWarnings([])
      return
    }
    const result = parseMultiGgUrl(input)
    if (result.inferredRegion) setFallbackRegion(result.inferredRegion)
    // Auto-assign roles in order TOP→JG→MID→ADC→SUP, looping if more than 5.
    setPlayers(result.players.map((p, i) => ({
      ...p,
      region: p.region || result.inferredRegion || fallbackRegion,
      role: ROLES[i % ROLES.length],
    })))
    setWarnings(result.warnings)
  // fallbackRegion intentionally omitted — we only re-derive from parse
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  const updatePlayer = (idx: number, patch: Partial<DraftPlayer>) => {
    setPlayers((prev) => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }

  const removePlayer = (idx: number) => {
    setPlayers((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleImport = async () => {
    if (players.length === 0) return
    setImporting(true)
    let added = 0
    const failures: string[] = []
    for (const p of players) {
      if (!p.gameName.trim()) {
        failures.push(`(no name)`)
        continue
      }
      try {
        await onImport({
          ...p,
          gameName: p.gameName.trim(),
          tagLine: p.tagLine.trim(),
          region: (p.region || fallbackRegion).trim(),
        })
        added++
      } catch (err) {
        failures.push(`${p.gameName}: ${(err as Error).message}`)
      }
    }
    setImporting(false)
    if (added > 0) {
      toast({
        title: t('team.import.success', { defaultValue: '{{count}} players imported', count: added }),
        description: failures.length > 0 ? `${failures.length} failed.` : undefined,
      })
    }
    if (failures.length > 0) {
      toast({
        title: t('team.import.partialFailure', { defaultValue: 'Some imports failed' }),
        description: failures.slice(0, 3).join('\n') + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : ''),
        variant: 'destructive',
      })
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-hextech-gold" />
            {title ?? t('team.import.title', { defaultValue: 'Import players from multi-search link' })}
          </DialogTitle>
          <DialogDescription>
            {description ?? t('team.import.desc', {
              defaultValue: 'Paste an op.gg / blitz.gg multisearch URL, or a plain list of Riot IDs (one per line, format "Name#TAG").',
            })}
          </DialogDescription>
        </DialogHeader>

        <textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'https://www.op.gg/multisearch/euw?summoners=PlayerA-EUW,PlayerB-EUW\n— or —\nPlayerA#EUW\nPlayerB#EUW\nPlayerC#EUW'}
          rows={4}
          className="w-full bg-hextech-elevated border border-hextech-border rounded px-3 py-2 text-sm font-mono text-hextech-text-bright focus:outline-none focus:border-hextech-gold resize-none"
        />

        <div className="flex items-center gap-2 text-xs">
          <span className="text-hextech-text-dim uppercase tracking-wider font-semibold">Fallback region:</span>
          <select
            value={fallbackRegion}
            onChange={(e) => setFallbackRegion(e.target.value)}
            className="bg-hextech-dark border border-hextech-border rounded px-2 py-0.5 text-xs"
          >
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="text-hextech-text-dim italic">
            ({t('team.import.regionHint', { defaultValue: 'used when a player has no region in their tag' })})
          </span>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2 text-xs space-y-0.5">
            <div className="flex items-center gap-1.5 text-yellow-300 font-semibold">
              <AlertCircle className="h-3 w-3" />
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </div>
            {warnings.slice(0, 4).map((w, i) => (
              <p key={i} className="text-yellow-200/80 pl-4">• {w}</p>
            ))}
            {warnings.length > 4 && (
              <p className="text-yellow-200/60 pl-4 italic">…and {warnings.length - 4} more</p>
            )}
          </div>
        )}

        {/* Preview */}
        {players.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-hextech-text-dim font-semibold">
              {t('team.import.preview', { defaultValue: 'Preview ({{count}} players)', count: players.length })}
            </p>
            <div className="rounded border border-hextech-border-dim overflow-hidden">
              <div className="grid grid-cols-[1fr_70px_70px_100px_30px] gap-1 px-2 py-1 bg-hextech-elevated text-[10px] uppercase tracking-wider text-hextech-text-dim font-semibold">
                <span>Name</span>
                <span>Tag</span>
                <span>Region</span>
                <span>Role</span>
                <span></span>
              </div>
              {players.map((p, i) => (
                <div key={i} className={cn(
                  'grid grid-cols-[1fr_70px_70px_100px_30px] gap-1 px-2 py-1 text-xs border-t border-hextech-border-dim/50 items-center',
                  !p.gameName.trim() && 'bg-red-500/10',
                )}>
                  <input
                    value={p.gameName}
                    onChange={(e) => updatePlayer(i, { gameName: e.target.value })}
                    className="bg-transparent border-0 focus:outline-none focus:bg-hextech-dark focus:border-b focus:border-hextech-gold px-1 truncate"
                  />
                  <input
                    value={p.tagLine}
                    onChange={(e) => updatePlayer(i, { tagLine: e.target.value })}
                    placeholder="—"
                    className="bg-transparent border-0 focus:outline-none focus:bg-hextech-dark focus:border-b focus:border-hextech-gold px-1 font-mono uppercase"
                  />
                  <select
                    value={p.region || fallbackRegion}
                    onChange={(e) => updatePlayer(i, { region: e.target.value })}
                    className="bg-hextech-dark border border-hextech-border rounded px-1 text-[10px]"
                  >
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select
                    value={p.role}
                    onChange={(e) => updatePlayer(i, { role: e.target.value as Role })}
                    className="bg-hextech-dark border border-hextech-border rounded px-1 text-[10px]"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    onClick={() => removePlayer(i)}
                    title="Remove"
                    className="text-hextech-text-dim hover:text-red-400 justify-self-center"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={handleImport} disabled={players.length === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t('team.import.confirm', { defaultValue: 'Import {{count}} players', count: players.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
