import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Trash2, Clock, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export interface TimelineNote {
  time: string
  note: string
}

interface TimelineNoteInputProps {
  notes: TimelineNote[]
  onChange: (notes: TimelineNote[]) => void
  objectiveLabel: string
}

const EXAMPLES: Record<string, string[]> = {
  wave_management: [
    '3:50 : I didn\'t fast push the wave before roaming, got ganked while slow pushing',
    '5:30 : Good freeze setup after the bounce, denied 12 CS from enemy',
    '8:20 : Crashed the slow push perfectly before Drake timer',
  ],
  trades: [
    '2:30 : Traded when enemy had minion advantage, lost the trade hard',
    '4:15 : Good short trade — used ability CD window when enemy E was down',
    '7:00 : All-in at level 6 was well timed, got the kill',
  ],
  default: [
    '3:00 : Missed an opportunity to punish enemy overextension',
    '5:45 : Good decision to play safe when jungler was top side',
    '10:20 : Should have recalled here instead of staying — died for it',
  ],
}

export function TimelineNoteInput({ notes, onChange, objectiveLabel }: TimelineNoteInputProps) {
  const { t } = useTranslation()
  const [showGuide, setShowGuide] = useState(notes.length === 0)

  const examples = EXAMPLES[objectiveLabel] || EXAMPLES.default

  const addNote = () => {
    onChange([...notes, { time: '', note: '' }])
  }

  const removeNote = (idx: number) => {
    onChange(notes.filter((_, i) => i !== idx))
  }

  const updateNote = (idx: number, field: keyof TimelineNote, value: string) => {
    const updated = [...notes]
    updated[idx] = { ...updated[idx], [field]: value }
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-hextech-text-bright">{t('reviewForm.timeline.title')}</h3>
          <p className="text-xs text-hextech-text mt-0.5">{t('reviewForm.timeline.subtitle')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowGuide(!showGuide)}>
          <HelpCircle className="h-4 w-4 mr-1" />
          {showGuide ? t('reviewForm.timeline.hideGuide') : t('reviewForm.timeline.showGuide')}
        </Button>
      </div>

      {showGuide && (
        <Card className="border-hextech-teal/30 bg-hextech-blue/30">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-hextech-cyan mb-2">
              {t('reviewForm.timeline.guideTitle')}
            </p>
            <ul className="space-y-1.5">
              {examples.map((ex, i) => (
                <li key={i} className="text-xs text-hextech-text flex gap-2">
                  <Clock className="h-3 w-3 mt-0.5 shrink-0 text-hextech-teal" />
                  <span className="italic">{ex}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-hextech-text-dim mt-3">
              {t('reviewForm.timeline.guideText')}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {notes.map((note, idx) => (
          <div key={idx} className="flex gap-2 items-start animate-fade-in">
            <div className="flex items-center gap-1 mt-1.5">
              <Clock className="h-3.5 w-3.5 text-hextech-text-dim" />
            </div>
            <Input
              placeholder={t('reviewForm.timeline.timePlaceholder')}
              value={note.time}
              onChange={(e) => updateNote(idx, 'time', e.target.value)}
              className="w-20 font-mono text-xs"
            />
            <Textarea
              placeholder={t('reviewForm.timeline.notePlaceholder')}
              value={note.note}
              onChange={(e) => updateNote(idx, 'note', e.target.value)}
              className="flex-1 min-h-[36px] text-sm"
              rows={1}
            />
            <Button variant="ghost" size="icon" onClick={() => removeNote(idx)} className="shrink-0 mt-0.5">
              <Trash2 className="h-4 w-4 text-hextech-red/70" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addNote} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> {t('reviewForm.timeline.addButton')}
      </Button>
    </div>
  )
}
