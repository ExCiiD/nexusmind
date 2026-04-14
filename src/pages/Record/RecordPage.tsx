import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { cn, formatGameTime } from '@/lib/utils'
import {
  Video, Youtube, RefreshCw, Loader2, ClipboardCheck,
  Swords, Clock, Film, Scissors, Filter, Trash2,
  FolderPlus, ChevronDown, ChevronUp, Check, FolderOpen,
  Pencil, X, ChevronLeft, ChevronRight, Play,
} from 'lucide-react'
import { AccountBadge } from '@/components/ui/AccountBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecordEntry {
  recordingId: string
  gameId: string | null
  filePath: string | null
  youtubeUrl: string | null
  source: string
  thumbnailPath: string | null
  clipCount: number
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
  queueType: string
  isSessionEligible: boolean
  accountName?: string
  isOrphaned?: boolean
}

interface Folder {
  id: string
  name: string
  recordingIds: string[]
}

interface ClipEntry {
  clipId: string
  recordingId: string
  filePath: string | null
  thumbnailPath: string | null
  title: string | null
  startMs: number
  endMs: number
  createdAt: string
  fileSize: number
  champion: string | null
  opponentChampion: string | null
  win: boolean
  duration: number
}

type ContentFilter = 'all' | 'records' | 'clips'
type ModeFilter = 'all' | 'soloq' | 'flex' | 'aram' | 'arena' | 'custom' | 'normal'
type ReviewFilter = 'all' | 'reviewed' | 'unreviewed'
type SourceFilter = 'all' | 'capture' | 'obs' | 'outplayed' | 'insightcapture' | 'youtube' | 'manual'

interface Filters {
  content: ContentFilter
  mode: ModeFilter
  review: ReviewFilter
  source: SourceFilter
}

// ── Storage ───────────────────────────────────────────────────────────────────

const FILTER_KEY = 'nexusmind:record-filters'
const FOLDER_KEY = 'nexusmind:record-folders-v2'

function loadFilters(): Filters {
  try { const r = localStorage.getItem(FILTER_KEY); if (r) return JSON.parse(r) } catch {}
  return { content: 'all', mode: 'all', review: 'all', source: 'all' }
}
function saveFilters(f: Filters) { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch {} }
function loadFolders(): Folder[] {
  try { const r = localStorage.getItem(FOLDER_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveFolders(f: Folder[]) { localStorage.setItem(FOLDER_KEY, JSON.stringify(f)) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function nxmUrl(p: string) { const n = p.replace(/\\/g, '/'); return n.startsWith('/') ? `nxm://${n}` : `nxm:///${n}` }
function queueLabel(q: string) { return ({ soloq: 'SoloQ', flex: 'Flex', aram: 'ARAM', arena: 'Arena', custom: 'Custom', normal: 'Normal' } as Record<string, string>)[q] ?? 'Unknown' }
function queueBadgeColor(q: string) { return ({ soloq: 'text-hextech-gold border-hextech-gold/30', flex: 'text-blue-400 border-blue-400/30', aram: 'text-purple-400 border-purple-400/30', arena: 'text-orange-400 border-orange-400/30' } as Record<string, string>)[q] ?? 'text-hextech-text-dim border-hextech-border-dim' }

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10) // YYYY-MM-DD
}
function formatDateLabel(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ── Pagination helper ─────────────────────────────────────────────────────────

/** Returns an array of page numbers and '…' ellipsis markers */
function buildPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '…'> = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

// ── Main page ─────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 20

export function RecordPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [records, setRecords] = useState<RecordEntry[]>([])
  const [allClips, setAllClips] = useState<ClipEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [showFilters, setShowFilters] = useState(false)

  const [folders, setFolders] = useState<Folder[]>(loadFolders)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editFolderName, setEditFolderName] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** Date sections: when key is in set, group is collapsed (default empty = all dates expanded). */
  const [collapsedDateKeys, setCollapsedDateKeys] = useState<Set<string>>(() => new Set())
  /** User folder sections: when id is in set, folder is expanded (default empty = all folders collapsed). */
  const [expandedUserFolderIds, setExpandedUserFolderIds] = useState<Set<string>>(() => new Set())
  const [showMoveDropdown, setShowMoveDropdown] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const moveDropdownRef = useRef<HTMLDivElement>(null)

  /** Close the "Move to folder" dropdown when clicking outside of it */
  useEffect(() => {
    if (!showMoveDropdown) return
    const handler = (e: MouseEvent) => {
      if (moveDropdownRef.current && !moveDropdownRef.current.contains(e.target as Node)) {
        setShowMoveDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoveDropdown])

  // ── Data loading ────────────────────────────────────────────────────────

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try { setRecords((await window.api.listGamesWithRecordings()) as RecordEntry[]) }
    catch (err) { console.error('[RecordPage] load failed:', err) }
    finally { setLoading(false) }
    // Clips load is non-blocking — never prevents recordings from showing
    try { setAllClips((await window.api.listAllClips()) as ClipEntry[]) }
    catch { /* clip listing not critical */ }
  }, [])

  useEffect(() => { loadRecords() }, [loadRecords])

  const handleScan = async () => {
    setScanning(true)
    try {
      await window.api.scanRecordings()
      await loadRecords()
    } catch {}
    finally { setScanning(false) }
  }

  // ── Filter ───────────────────────────────────────────────────────────────

  const updateFilter = useCallback(<K extends keyof Filters>(key: K, val: Filters[K]) => {
    setFilters((prev) => { const next = { ...prev, [key]: val }; saveFilters(next); return next })
    setCurrentPage(1)
  }, [])

  const filtered = useMemo(() => records.filter((r) => {
    if (filters.content === 'clips' && r.clipCount === 0) return false
    if (filters.content === 'records' && !r.filePath) return false
    if (filters.mode !== 'all' && r.queueType !== filters.mode) return false
    if (filters.review === 'reviewed' && !r.hasReview) return false
    if (filters.review === 'unreviewed' && r.hasReview) return false
    if (filters.source !== 'all' && r.source !== filters.source) return false
    return true
  }), [records, filters])

  // ── Grouping + Pagination ────────────────────────────────────────────────

  const folderAssignedIds = useMemo(() => new Set(folders.flatMap(f => f.recordingIds)), [folders])

  /** All unfoldered records sorted newest-first */
  const unfolderedSorted = useMemo(() =>
    filtered
      .filter(r => !folderAssignedIds.has(r.recordingId))
      .sort((a, b) => new Date(b.gameEndAt).getTime() - new Date(a.gameEndAt).getTime()),
    [filtered, folderAssignedIds])

  const totalPages = Math.max(1, Math.ceil(unfolderedSorted.length / ITEMS_PER_PAGE))

  // Reset to page 1 when filters or data change
  const safeCurrentPage = Math.min(currentPage, totalPages)

  const pageRecords = useMemo(() => {
    const start = (safeCurrentPage - 1) * ITEMS_PER_PAGE
    return unfolderedSorted.slice(start, start + ITEMS_PER_PAGE)
  }, [unfolderedSorted, safeCurrentPage])

  const dateGroups = useMemo(() => {
    const map = new Map<string, RecordEntry[]>()
    for (const r of pageRecords) {
      const key = getDateKey(r.gameEndAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [pageRecords])

  const folderGroups = useMemo(() =>
    folders.map(f => ({ folder: f, records: filtered.filter(r => f.recordingIds.includes(r.recordingId)) })),
    [folders, filtered])

  // ── Navigation ───────────────────────────────────────────────────────────

  const handleOpen = (r: RecordEntry) => {
    if (!r.isOrphaned && r.hasReview && r.gameId) navigate(`/review?gameId=${r.gameId}`)
    else navigate(`/record/${r.recordingId}`)
  }

  // ── Deletion ─────────────────────────────────────────────────────────────

  const removeSingleRecord = useCallback((id: string) => {
    setRecords(p => p.filter(r => r.recordingId !== id))
    setFolders(p => { const n = p.map(f => ({ ...f, recordingIds: f.recordingIds.filter(rid => rid !== id) })); saveFolders(n); return n })
    setSelectedIds(p => { const n = new Set(p); n.delete(id); return n })
  }, [])

  const handleDelete = useCallback(async (r: RecordEntry) => {
    try {
      if (typeof window.api.deleteRecordingById !== 'function') throw new Error('API not ready — please restart the app.')
      await window.api.deleteRecordingById(r.recordingId)
      removeSingleRecord(r.recordingId)
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err?.message ?? String(err), variant: 'destructive' })
    }
  }, [removeSingleRecord, toast])

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    let failed = 0
    for (const id of ids) {
      try { await window.api.deleteRecordingById(id) } catch { failed++ }
    }
    setRecords(p => p.filter(r => !selectedIds.has(r.recordingId)))
    setFolders(p => { const n = p.map(f => ({ ...f, recordingIds: f.recordingIds.filter(id => !selectedIds.has(id)) })); saveFolders(n); return n })
    setSelectedIds(new Set())
    if (failed > 0) toast({ title: `${failed} deletion(s) failed`, variant: 'destructive' })
  }, [selectedIds, toast])

  // ── Selection ───────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const toggleSelectGroup = useCallback((ids: string[]) => {
    setSelectedIds(p => {
      const allSel = ids.every(id => p.has(id))
      const n = new Set(p)
      ids.forEach(id => allSel ? n.delete(id) : n.add(id))
      return n
    })
  }, [])

  const toggleDateGroup = useCallback((dateKey: string) => {
    setCollapsedDateKeys((p) => {
      const n = new Set(p)
      if (n.has(dateKey)) n.delete(dateKey)
      else n.add(dateKey)
      return n
    })
  }, [])

  const toggleUserFolder = useCallback((folderId: string) => {
    setExpandedUserFolderIds((p) => {
      const n = new Set(p)
      if (n.has(folderId)) n.delete(folderId)
      else n.add(folderId)
      return n
    })
  }, [])

  // ── Folders ──────────────────────────────────────────────────────────────

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return
    const folder: Folder = { id: `f-${Date.now()}`, name: newFolderName.trim(), recordingIds: [] }
    const next = [...folders, folder]; setFolders(next); saveFolders(next)
    setNewFolderName(''); setCreatingFolder(false)
  }

  const handleDeleteFolder = (id: string) => {
    const next = folders.filter(f => f.id !== id); setFolders(next); saveFolders(next)
  }

  const handleMoveToFolder = useCallback((folderId: string) => {
    const ids = Array.from(selectedIds)
    setFolders(p => {
      const n = p.map(f => f.id === folderId
        ? { ...f, recordingIds: [...new Set([...f.recordingIds, ...ids])] }
        : { ...f, recordingIds: f.recordingIds.filter(id => !ids.includes(id)) })
      saveFolders(n); return n
    })
    setSelectedIds(new Set()); setShowMoveDropdown(false)
  }, [selectedIds])

  const handleRemoveFromFolder = (folderId: string, recordingId: string) => {
    setFolders(p => { const n = p.map(f => f.id === folderId ? { ...f, recordingIds: f.recordingIds.filter(id => id !== recordingId) } : f); saveFolders(n); return n })
  }

  const handleSaveRename = (id: string) => {
    if (!editFolderName.trim()) { setEditingFolderId(null); return }
    setFolders(p => { const n = p.map(f => f.id === id ? { ...f, name: editFolderName.trim() } : f); saveFolders(n); return n })
    setEditingFolderId(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isEmpty = !loading && records.length === 0 && filters.content !== 'clips'
  const noMatch = !loading && records.length > 0 && filtered.length === 0 && filters.content !== 'clips'

  return (
    <div className="animate-fade-in pb-20" style={{ minHeight: 'calc(100vh - 3.25rem)' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 pb-4">
        <h1 className="font-display text-xl font-bold text-hextech-gold-bright shrink-0">Record Hub</h1>
        <span className="text-xs text-hextech-text-dim bg-hextech-elevated border border-hextech-border-dim rounded px-2 py-0.5 shrink-0">
          {filters.content === 'clips'
            ? `${allClips.length} clip${allClips.length !== 1 ? 's' : ''}`
            : `${filtered.length}${filtered.length !== records.length ? ` / ${records.length}` : ''} recording${records.length !== 1 ? 's' : ''}`}
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}
          className={`gap-1.5 h-7 text-xs ${showFilters ? 'border-hextech-gold/60 text-hextech-gold' : ''}`}>
          <Filter className="h-3 w-3" />Filters
        </Button>
        <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5 h-7 text-xs">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Scan
        </Button>
      </div>

      {/* ── Filters panel ── */}
      {showFilters && (
        <Card className="mb-4">
          <CardContent className="pt-3 pb-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <FilterRow label="Content" value={filters.content} onChange={v => updateFilter('content', v as ContentFilter)}
                options={[{ value: 'all', label: 'All' }, { value: 'records', label: 'Full records' }, { value: 'clips', label: 'Clips' }]} />
              <FilterRow label="Mode" value={filters.mode} onChange={v => updateFilter('mode', v as ModeFilter)}
                options={[{ value: 'all', label: 'All' }, { value: 'soloq', label: 'SoloQ' }, { value: 'flex', label: 'Flex' }, { value: 'aram', label: 'ARAM' }, { value: 'arena', label: 'Arena' }, { value: 'custom', label: 'Custom' }]} />
              <FilterRow label="Review" value={filters.review} onChange={v => updateFilter('review', v as ReviewFilter)}
                options={[{ value: 'all', label: 'All' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'unreviewed', label: 'Unreviewed' }]} />
              <FilterRow label="Source" value={filters.source} onChange={v => updateFilter('source', v as SourceFilter)}
                options={[{ value: 'all', label: 'All' }, { value: 'capture', label: 'NexusMind' }, { value: 'obs', label: 'OBS' }, { value: 'outplayed', label: 'Outplayed' }, { value: 'insightcapture', label: 'Insight' }, { value: 'youtube', label: 'YouTube' }, { value: 'manual', label: 'Manual' }]} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Create folder button ── */}
        <div className="mb-4">
        {creatingFolder ? (
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-hextech-gold shrink-0" />
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') } }}
              placeholder="Folder name…"
              className="flex-1 max-w-xs rounded border border-hextech-gold/40 bg-hextech-elevated px-2 py-1 text-sm text-hextech-text focus:outline-none focus:border-hextech-gold"
            />
            <Button size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim()} className="h-7 text-xs">Create</Button>
            <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }} className="text-hextech-text-dim hover:text-hextech-text">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingFolder(true)}
            className="flex items-center gap-1.5 text-sm text-hextech-text-dim hover:text-hextech-gold transition-colors"
          >
            <FolderPlus className="h-4 w-4" />
            Create a folder
          </button>
        )}
      </div>

      {/* ── States ── */}
      {loading && (
        <div className="flex items-center gap-3 py-12 justify-center text-hextech-text-dim">
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      )}
      {isEmpty && (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Film className="h-10 w-10 opacity-30 text-hextech-text-dim" />
          <p className="text-sm font-medium text-hextech-text-bright">No recordings found</p>
          <p className="text-xs text-hextech-text-dim max-w-xs">Enable auto-record in Settings, or click Scan to detect recordings.</p>
          <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-2 mt-2">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Scan
          </Button>
        </CardContent></Card>
      )}
      {noMatch && (
        <Card><CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <Filter className="h-8 w-8 opacity-30 text-hextech-text-dim" />
          <p className="text-sm font-medium text-hextech-text-bright">No recordings match these filters</p>
          <Button variant="ghost" size="sm" onClick={() => { const r: Filters = { content: 'all', mode: 'all', review: 'all', source: 'all' }; setFilters(r); saveFilters(r) }}>Reset filters</Button>
        </CardContent></Card>
      )}

      {/* ── Clips grid (when Clips filter is active) ── */}
      {!loading && filters.content === 'clips' && (
        allClips.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Scissors className="h-8 w-8 opacity-30 text-hextech-text-dim" />
            <p className="text-sm font-medium text-hextech-text-bright">No clips found</p>
            <p className="text-xs text-hextech-text-dim max-w-xs">Create clips from any recording by opening it and selecting a time range.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {allClips.map((clip) => (
              <ClipCard key={clip.clipId} clip={clip} onOpen={() => navigate(`/record/${clip.recordingId}`)} onDelete={async () => {
                try {
                  await window.api.deleteClip(clip.clipId)
                  setAllClips((prev) => prev.filter((c) => c.clipId !== clip.clipId))
                } catch (err: any) {
                  toast({ title: 'Delete failed', description: err?.message ?? String(err), variant: 'destructive' })
                }
              }} />
            ))}
          </div>
        )
      )}

      {/* ── Folder groups ── */}
      {!loading && filters.content !== 'clips' && folderGroups.map(({ folder, records: recs }) => (
        <RecordGroupSection
          key={folder.id}
          groupKey={folder.id}
          label={
            editingFolderId === folder.id ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus type="text" value={editFolderName} onChange={e => setEditFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(folder.id); if (e.key === 'Escape') setEditingFolderId(null) }}
                  onClick={e => e.stopPropagation()}
                  className="rounded border border-hextech-gold/40 bg-hextech-elevated px-2 py-0.5 text-sm text-hextech-text focus:outline-none"
                />
                <button onClick={e => { e.stopPropagation(); handleSaveRename(folder.id) }} className="text-hextech-gold hover:opacity-80"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); setEditingFolderId(null) }} className="text-hextech-text-dim hover:text-hextech-text"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-hextech-gold" />
                {folder.name}
                <button onClick={e => { e.stopPropagation(); setEditingFolderId(folder.id); setEditFolderName(folder.name) }} className="text-hextech-text-dim/40 hover:text-hextech-text-dim ml-1">
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id) }} className="text-hextech-text-dim/40 hover:text-[#FF4655]">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )
          }
          records={recs}
          selectedIds={selectedIds}
          collapsed={!expandedUserFolderIds.has(folder.id)}
          onToggleCollapse={() => toggleUserFolder(folder.id)}
          onToggleGroupSelect={() => toggleSelectGroup(recs.map(r => r.recordingId))}
          onToggleCard={toggleSelect}
          onOpen={handleOpen}
          onDelete={handleDelete}
          onRemoveFromFolder={(recordingId) => handleRemoveFromFolder(folder.id, recordingId)}
        />
      ))}

      {/* ── Date groups ── */}
      {!loading && filters.content !== 'clips' && dateGroups.map(([dateKey, recs]) => (
        <RecordGroupSection
          key={dateKey}
          groupKey={dateKey}
          label={<span className="capitalize">{formatDateLabel(dateKey)}</span>}
          records={recs}
          selectedIds={selectedIds}
          collapsed={collapsedDateKeys.has(dateKey)}
          onToggleCollapse={() => toggleDateGroup(dateKey)}
          onToggleGroupSelect={() => toggleSelectGroup(recs.map(r => r.recordingId))}
          onToggleCard={toggleSelect}
          onOpen={handleOpen}
          onDelete={handleDelete}
        />
      ))}

      {/* ── Pagination ── */}
      {!loading && filters.content !== 'clips' && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4 pb-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safeCurrentPage === 1
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-border-dim text-hextech-text-dim bg-hextech-elevated hover:border-hextech-gold/50 hover:text-hextech-text',
            )}
          >
            <ChevronLeft className="h-4 w-4" />Prev
          </button>

          <div className="flex items-center gap-1">
            {buildPageNumbers(safeCurrentPage, totalPages).map((entry, i) =>
              entry === '…' ? (
                <span key={`ellipsis-${i}`} className="w-8 text-center text-hextech-text-dim/40 text-sm select-none">…</span>
              ) : (
                <button
                  key={entry}
                  onClick={() => setCurrentPage(entry as number)}
                  className={cn(
                    'w-8 h-8 rounded-lg border text-sm font-medium transition-colors',
                    entry === safeCurrentPage
                      ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                      : 'border-hextech-border-dim/60 text-hextech-text-dim bg-hextech-dark/60 hover:border-hextech-gold/40 hover:text-hextech-text',
                  )}
                >
                  {entry}
                </button>
              )
            )}
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              safeCurrentPage === totalPages
                ? 'border-hextech-border-dim/40 text-hextech-text-dim/30 bg-hextech-dark/40 cursor-not-allowed'
                : 'border-hextech-gold/60 text-hextech-gold bg-hextech-gold/10 hover:bg-hextech-gold/20',
            )}
          >
            Next<ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-hextech-dark/95 backdrop-blur border border-hextech-border-dim shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium text-hextech-text-bright">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-hextech-border-dim" />

          {/* Move to folder */}
          {folders.length > 0 && (
            <div className="relative" ref={moveDropdownRef}>
              <button
                onClick={() => setShowMoveDropdown(v => !v)}
                className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs border border-hextech-border-dim text-hextech-text-dim hover:text-hextech-text hover:border-hextech-gold/40 transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Move to folder
                <ChevronDown className="h-3 w-3" />
              </button>
              {showMoveDropdown && (
                <div className="absolute bottom-full mb-1 left-0 min-w-[140px] rounded-lg border border-hextech-border-dim bg-hextech-dark shadow-lg py-1 z-50">
                  {folders.map(f => (
                    <button key={f.id} onClick={() => handleMoveToFolder(f.id)}
                      className="w-full text-left px-3 py-1.5 text-xs text-hextech-text-dim hover:text-hextech-text hover:bg-white/5 transition-colors flex items-center gap-2">
                      <FolderOpen className="h-3 w-3 text-hextech-gold shrink-0" />{f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bulk delete */}
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs bg-[#FF4655]/10 border border-[#FF4655]/40 text-[#FF4655] hover:bg-[#FF4655]/20 transition-colors font-medium"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>

          <button onClick={() => setSelectedIds(new Set())} className="text-hextech-text-dim/60 hover:text-hextech-text-dim transition-colors ml-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

interface RecordGroupSectionProps {
  groupKey: string
  label: React.ReactNode
  records: RecordEntry[]
  selectedIds: Set<string>
  collapsed: boolean
  onToggleCollapse: () => void
  onToggleGroupSelect: () => void
  onToggleCard: (id: string) => void
  onOpen: (r: RecordEntry) => void
  onDelete: (r: RecordEntry) => void
  onRemoveFromFolder?: (recordingId: string) => void
}

function RecordGroupSection({ groupKey, label, records, selectedIds, collapsed, onToggleCollapse, onToggleGroupSelect, onToggleCard, onOpen, onDelete, onRemoveFromFolder }: RecordGroupSectionProps) {
  const ids = records.map(r => r.recordingId)
  const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id))
  const someSelected = ids.some(id => selectedIds.has(id))

  return (
    <div className="mb-6">
      {/* Group header */}
      <div className="flex items-center gap-3 mb-3">
        <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onChange={onToggleGroupSelect} />
        <button onClick={onToggleCollapse} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-sm font-semibold text-hextech-text-bright">{label}</span>
          <span className="text-xs text-hextech-text-dim/60 shrink-0">{records.length}</span>
          {collapsed
            ? <ChevronDown className="h-4 w-4 text-hextech-text-dim/60 shrink-0" />
            : <ChevronUp className="h-4 w-4 text-hextech-text-dim/60 shrink-0" />}
        </button>
      </div>

      {/* Cards grid */}
      {!collapsed && (
        records.length === 0 ? (
          <p className="text-xs text-hextech-text-dim/50 pl-7 py-2">Empty folder</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {records.map(r => (
              <RecordCard
                key={r.recordingId}
                record={r}
                isSelected={selectedIds.has(r.recordingId)}
                onToggleSelect={() => onToggleCard(r.recordingId)}
                onOpen={onOpen}
                onDelete={onDelete}
                onRemoveFromFolder={onRemoveFromFolder}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ── Record card ───────────────────────────────────────────────────────────────

interface RecordCardProps {
  record: RecordEntry
  isSelected: boolean
  onToggleSelect: () => void
  onOpen: (r: RecordEntry) => void
  onDelete: (r: RecordEntry) => void
  onRemoveFromFolder?: (recordingId: string) => void
}

function RecordCard({ record: r, isSelected, onToggleSelect, onOpen, onDelete, onRemoveFromFolder }: RecordCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const date = new Date(r.gameEndAt)
  const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-hextech-elevated transition-colors overflow-hidden',
        isSelected ? 'border-hextech-gold/60 ring-1 ring-hextech-gold/30' : 'border-hextech-border-dim hover:border-hextech-gold/40',
      )}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      {/* Checkbox — always visible */}
      <button
        onClick={onToggleSelect}
        className="absolute top-1.5 left-1.5 z-20"
      >
        <Checkbox checked={isSelected} onChange={onToggleSelect} className="shadow-md" />
      </button>

      {/* Delete button — on hover */}
      <button
        onClick={() => confirmDelete ? onDelete(r) : setConfirmDelete(true)}
        title={confirmDelete ? 'Click again to confirm' : 'Delete recording'}
        className={cn(
          'absolute top-1.5 right-1.5 z-20 transition-all flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm',
          confirmDelete
            ? 'opacity-100 bg-red-600/90 text-white border border-red-500'
            : 'opacity-0 group-hover:opacity-100 bg-black/60 text-white/70 border border-white/20 hover:bg-red-600/80 hover:text-white hover:border-red-500',
        )}
      >
        <Trash2 className="h-2.5 w-2.5" />
        {confirmDelete ? 'Confirm?' : 'Delete'}
      </button>

      {/* Thumbnail */}
      <div className="relative w-full cursor-pointer" style={{ paddingTop: '56.25%' }} onClick={() => onOpen(r)}>
        <div className="absolute inset-0 bg-hextech-background/80">
          {r.thumbnailPath
            ? <img src={nxmUrl(r.thumbnailPath)} alt={r.champion} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            : <div className="w-full h-full flex items-center justify-center"><Film className="h-8 w-8 text-hextech-text-dim/20" /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        </div>
        {!r.isOrphaned && <div className={`absolute inset-y-0 left-0 w-1 ${r.win ? 'bg-hextech-teal' : 'bg-[#FF4655]'}`} />}

        {/* Badges top-right of thumbnail */}
        <div className="absolute top-1.5 right-8 flex items-center gap-1">
          {r.youtubeUrl && <span className="rounded bg-red-600/80 px-1 py-0.5 text-[9px] font-bold text-white flex items-center gap-0.5"><Youtube className="h-2.5 w-2.5" /> YT</span>}
          {r.clipCount > 0 && <span className="rounded bg-hextech-gold/80 px-1 py-0.5 text-[9px] font-bold text-hextech-dark flex items-center gap-0.5"><Scissors className="h-2 w-2" /> {r.clipCount}</span>}
        </div>

        {/* Bottom overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-2 pb-1.5">
          <div className="flex items-end justify-between gap-1">
            <div className="min-w-0">
              <p className="text-xs font-bold text-white leading-tight truncate">{r.champion}</p>
              {!r.isOrphaned && r.opponentChampion && (
                <p className="text-[10px] text-white/60 leading-tight truncate flex items-center gap-0.5">
                  <Swords className="h-2 w-2 shrink-0" />{r.opponentChampion}
                </p>
              )}
            </div>
            {!r.isOrphaned && (
              <span className={`text-[10px] font-bold leading-none px-1.5 py-0.5 rounded shrink-0 ${r.win ? 'bg-hextech-teal/90 text-white' : 'bg-[#FF4655]/90 text-white'}`}>
                {r.win ? 'W' : 'L'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-2 py-1.5 h-[3.25rem] flex flex-col justify-between overflow-hidden">
        {!r.isOrphaned ? (
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-hextech-text-bright">{r.kills}/{r.deaths}/{r.assists}</span>
            <span className="flex items-center gap-1 text-hextech-text-dim"><Clock className="h-2.5 w-2.5" />{formatGameTime(r.duration)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[10px] text-hextech-text-dim"><Video className="h-2.5 w-2.5" /><span>Not linked to a game</span></div>
        )}
        <div className="flex items-center gap-1 min-w-0">
          {!r.isOrphaned && r.accountName && <AccountBadge name={r.accountName} />}
          <span className="text-[10px] text-hextech-text-dim truncate">{dateStr}</span>
          {r.hasReview && <span className="text-[9px] text-hextech-cyan flex items-center gap-0.5 shrink-0"><ClipboardCheck className="h-2.5 w-2.5" /> Rev</span>}
          {!r.isOrphaned && r.queueType && r.queueType !== 'unknown' && (
            <span className={`text-[9px] px-1 rounded border shrink-0 ${queueBadgeColor(r.queueType)}`}>{queueLabel(r.queueType)}</span>
          )}
          {onRemoveFromFolder && (
            <button onClick={e => { e.stopPropagation(); onRemoveFromFolder(r.recordingId) }} title="Remove from folder"
              className="ml-auto text-hextech-text-dim/30 hover:text-hextech-text-dim transition-colors shrink-0">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate, onChange, className }: { checked: boolean; indeterminate?: boolean; onChange: () => void; className?: string }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange() }}
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer shrink-0',
        checked || indeterminate
          ? 'bg-hextech-gold border-hextech-gold'
          : 'bg-black/40 border-white/30 hover:border-hextech-gold/60',
        className,
      )}
    >
      {indeterminate && !checked && <div className="w-2 h-0.5 bg-black rounded" />}
      {checked && <Check className="h-2.5 w-2.5 text-black" />}
    </div>
  )
}

// ── Filter row ────────────────────────────────────────────────────────────────

function FilterRow({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-hextech-text-dim w-14 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map(opt => (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            className={cn('rounded px-2 py-0.5 text-[11px] font-medium border transition-colors',
              value === opt.value ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-gold/40 hover:text-hextech-text')}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Clip card ─────────────────────────────────────────────────────────────────

function ClipCard({ clip, onOpen, onDelete }: { clip: ClipEntry; onOpen: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const durationSecs = (clip.endMs - clip.startMs) / 1000
  const fileSizeMB = clip.fileSize > 0 ? `${(clip.fileSize / (1024 * 1024)).toFixed(1)} MB` : ''

  return (
    <div className="group relative rounded-lg border border-hextech-border-dim bg-hextech-dark overflow-hidden transition-all hover:border-hextech-gold/40 hover:shadow-lg hover:shadow-hextech-gold/5">
      {/* Thumbnail */}
      <div className="relative w-full cursor-pointer" style={{ paddingTop: '56.25%' }} onClick={onOpen}>
        <div className="absolute inset-0 bg-hextech-background/80">
          {clip.thumbnailPath
            ? <img src={nxmUrl(clip.thumbnailPath)} alt={clip.title ?? 'Clip'} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            : <div className="w-full h-full flex items-center justify-center"><Scissors className="h-8 w-8 text-hextech-text-dim/20" /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        </div>

        {/* Duration badge */}
        {durationSecs > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {durationSecs >= 60 ? `${Math.floor(durationSecs / 60)}:${String(Math.floor(durationSecs % 60)).padStart(2, '0')}` : `${Math.floor(durationSecs)}s`}
          </span>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="rounded-full bg-hextech-gold/90 p-2"><Play className="h-4 w-4 text-black" /></div>
        </div>
      </div>

      {/* Info */}
      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <Scissors className="h-3 w-3 text-hextech-gold shrink-0" />
          <span className="text-xs font-medium text-hextech-text-bright truncate">
            {clip.title || clip.champion || 'Clip'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-hextech-text-dim">
          {clip.champion && <span>{clip.champion}</span>}
          {fileSizeMB && <span>{fileSizeMB}</span>}
          <span>{new Date(clip.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Delete */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {confirmDelete ? (
          <div className="flex gap-1">
            <button onClick={onDelete} className="rounded bg-[#FF4655]/90 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-[#FF4655]">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="rounded bg-black/50 p-1 text-hextech-text-dim hover:text-[#FF4655] hover:bg-black/70 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
