import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCoach, type StudentEntry } from '@/context/CoachContext'
import { useUserStore } from '@/store/useUserStore'
import {
  Users,
  ChevronRight,
  ArrowLeft,
  Loader2,
  BookOpen,
  BarChart3,
  History,
  ClipboardCheck,
} from 'lucide-react'

export function StudentsPage() {
  const user = useUserStore((s) => s.user)
  const { viewingStudent, setViewingStudent } = useCoach()
  const navigate = useNavigate()

  const [students, setStudents] = useState<StudentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState<StudentEntry | null>(null)
  const [studentSessions, setStudentSessions] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)

  const isCoach = user?.role === 'coach' || user?.role === 'both'

  useEffect(() => {
    if (!isCoach) return
    window.api.listStudents()
      .then(setStudents)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isCoach])

  const handleSelectStudent = async (student: StudentEntry) => {
    setSelectedStudent(student)
    setViewingStudent(student)
    setLoadingData(true)
    try {
      const sessions = await window.api.getStudentSessions(student.supabaseId)
      setStudentSessions(sessions)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoadingData(false)
    }
  }

  const handleBack = () => {
    setSelectedStudent(null)
    setViewingStudent(null)
    setStudentSessions([])
  }

  if (!isCoach) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">Students</h1>
        <Card>
          <CardContent className="py-8 text-center text-hextech-text-dim">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>You need the <strong>Coach</strong> role to access this page.</p>
            <p className="text-sm mt-1">Change your role in Settings.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!user?.supabaseUid) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">Students</h1>
        <Card>
          <CardContent className="py-8 text-center text-hextech-text-dim">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>You need to sign in to your NexusMind account in Settings to access students.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (selectedStudent) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to students
          </Button>
          <div className="h-4 w-px bg-hextech-border-dim" />
          <div>
            <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">
              {selectedStudent.displayName}
            </h1>
            <p className="text-xs text-hextech-text-dim">Coach view — read only</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Sessions', icon: BookOpen, action: () => navigate('/students/sessions') },
            { label: 'Analytics', icon: BarChart3, action: () => navigate('/students/analytics') },
            { label: 'History', icon: History, action: () => navigate('/students/history') },
            { label: 'Assessment', icon: ClipboardCheck, action: () => navigate('/students/assessment') },
          ].map(({ label, icon: Icon, action }) => (
            <Card
              key={label}
              className="cursor-pointer hover:border-hextech-gold/40 transition-colors"
              onClick={action}
            >
              <CardContent className="flex items-center gap-3 py-4">
                <Icon className="h-5 w-5 text-hextech-gold" />
                <span className="font-medium text-hextech-text-bright">{label}</span>
                <ChevronRight className="h-4 w-4 text-hextech-text-dim ml-auto" />
              </CardContent>
            </Card>
          ))}
        </div>

        {loadingData ? (
          <div className="flex items-center gap-2 text-hextech-text-dim">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading student data…
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="font-semibold text-hextech-text-bright">Recent Sessions</h2>
            {studentSessions.length === 0 ? (
              <p className="text-sm text-hextech-text-dim">No sessions synced yet.</p>
            ) : (
              studentSessions.slice(0, 10).map((session: any) => (
                <StudentSessionCard key={session.id} session={session} studentSupabaseId={selectedStudent.supabaseId} />
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">Students</h1>
        <p className="text-sm text-hextech-text mt-1">Select a student to view their progress.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-hextech-text-dim">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading students…
        </div>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-hextech-text-dim">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No students connected yet.</p>
            <p className="text-sm mt-1">
              Ask your student to generate an invite link in their Settings → Coach &amp; Student.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {students.map((student) => (
            <Card
              key={student.relationId}
              className="cursor-pointer hover:border-hextech-gold/40 transition-colors"
              onClick={() => handleSelectStudent(student)}
            >
              <CardContent className="flex items-center gap-3 py-4">
                <div className="h-9 w-9 rounded-full bg-hextech-gold/10 border border-hextech-gold/20 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-hextech-gold">
                    {student.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-hextech-text-bright">{student.displayName}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-hextech-text-dim shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentSessionCard({ session, studentSupabaseId }: { session: any; studentSupabaseId: string }) {
  const [comments, setComments] = useState<any[]>([])
  const [comment, setComment] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadComments = async () => {
    const data = await window.api.getCoachComments('session', session.id)
    setComments(data)
  }

  const handleToggle = async () => {
    if (!showComments) await loadComments()
    setShowComments((v) => !v)
  }

  const handleSubmit = async () => {
    if (!comment.trim()) return
    setSubmitting(true)
    try {
      await window.api.addCoachComment({
        studentSupabaseId,
        targetType: 'session',
        targetId: session.id,
        content: comment.trim(),
      })
      setComment('')
      await loadComments()
    } finally {
      setSubmitting(false)
    }
  }

  const gameCount = session.synced_games?.length ?? 0
  const reviewCount = session.synced_games?.filter((g: any) => g.synced_reviews?.length > 0).length ?? 0
  const date = new Date(session.date).toLocaleDateString()

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-hextech-text-bright">
            {session.objective_id} — {date}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{gameCount} games</Badge>
            <Badge variant="outline" className="text-xs">{reviewCount} reviewed</Badge>
            <Button variant="ghost" size="sm" onClick={handleToggle} className="text-xs h-7 px-2">
              Coach Notes {showComments ? '▲' : '▼'}
            </Button>
          </div>
        </div>
      </CardHeader>
      {showComments && (
        <CardContent className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm">
              <span className="font-semibold text-hextech-gold text-xs">{c.coachName}</span>
              <p className="text-hextech-text mt-0.5">{c.content}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Add a coaching note…"
              className="flex-1 rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-1.5 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
            />
            <Button size="sm" onClick={handleSubmit} disabled={submitting || !comment.trim()}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Send'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
