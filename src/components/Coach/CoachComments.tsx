import { useState, useEffect } from 'react'
import { useUserStore } from '@/store/useUserStore'
import { Button } from '@/components/ui/button'
import { MessageSquare, Loader2, Pencil, Trash2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Comment {
  id: string
  coachName: string
  content: string
  created_at: string
  isOwn: boolean
}

interface CoachCommentsProps {
  targetType: 'session' | 'game' | 'review'
  targetId: string
  studentSupabaseId?: string
  readonly?: boolean
}

export function CoachComments({ targetType, targetId, studentSupabaseId, readonly }: CoachCommentsProps) {
  const user = useUserStore((s) => s.user)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const isCoach = user?.role === 'coach' || user?.role === 'both'
  const hasSupabase = !!user?.supabaseUid

  const load = async () => {
    if (!hasSupabase) return
    setLoading(true)
    try {
      const data = await window.api.getCoachComments(targetType, targetId)
      setComments(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const handleSubmit = async () => {
    if (!draft.trim() || !studentSupabaseId) return
    setSubmitting(true)
    try {
      await window.api.addCoachComment({
        studentSupabaseId,
        targetType,
        targetId,
        content: draft.trim(),
      })
      setDraft('')
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async (id: string) => {
    if (!editDraft.trim()) return
    await window.api.updateCoachComment(id, editDraft.trim())
    setEditingId(null)
    setEditDraft('')
    await load()
  }

  const handleDelete = async (id: string) => {
    await window.api.deleteCoachComment(id)
    await load()
  }

  if (!hasSupabase) return null

  return (
    <div className="mt-4 border-t border-hextech-border-dim pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-hextech-text hover:text-hextech-gold-bright transition-colors"
      >
        <MessageSquare className="h-4 w-4" />
        Coach Notes
        {comments.length > 0 && (
          <span className="ml-1 rounded-full bg-hextech-gold/20 px-1.5 py-0.5 text-[10px] text-hextech-gold">
            {comments.length}
          </span>
        )}
        <span className="text-hextech-text-dim">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-hextech-text-dim">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">No coach notes yet.</p>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm',
                    c.isOwn
                      ? 'border-hextech-gold/30 bg-hextech-gold/5'
                      : 'border-hextech-border-dim bg-hextech-elevated',
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-hextech-gold uppercase tracking-wide">
                      {c.coachName}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-hextech-text-dim">
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                      {c.isOwn && !readonly && (
                        <>
                          <button
                            onClick={() => { setEditingId(c.id); setEditDraft(c.content) }}
                            className="p-1 rounded text-hextech-text-dim hover:text-hextech-gold transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="p-1 rounded text-hextech-text-dim hover:text-[#FF4655] transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingId === c.id ? (
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEdit(c.id)}
                        className="flex-1 rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-sm text-hextech-text focus:outline-none focus:border-hextech-gold"
                        autoFocus
                      />
                      <button onClick={() => handleEdit(c.id)} className="text-hextech-green hover:opacity-80">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-hextech-text-dim hover:opacity-80">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-hextech-text">{c.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {isCoach && !readonly && studentSupabaseId && (
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Add a coaching note…"
                className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
              />
              <Button size="sm" onClick={handleSubmit} disabled={submitting || !draft.trim()}>
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Send'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
