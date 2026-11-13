import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, HeartPulse, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { computeEnergyWinrateCorrelation, computeMoodDeclineAlert } from '@/lib/wellbeingCore'
import type { WellbeingCheckin } from '@/lib/wellbeing'

const SCALE = [1, 2, 3, 4, 5]

interface Props { groups: Group[]; myUserId: string; nameOf: (userId: string) => string }

/** E6 (docs/PLAN_GESTION_EQUIPE.md): optional energy/mood/sleep check-in, private unless the player opts in per group. */
export function WellbeingSection({ groups, myUserId, nameOf }: Props) {
  const { t } = useTranslation()
  const staffGroups = groups.filter((g) => g.myRole !== 'player')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-5 w-5 text-hextech-gold" />{t('wellbeing.title', { defaultValue: 'Wellbeing' })}
        </CardTitle>
        <CardDescription>{t('wellbeing.desc', { defaultValue: 'A quick, optional check-in before a session — private unless you opt in to share it with a group\'s staff.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MyCheckin myUserId={myUserId} />
        {staffGroups.length > 0 && <TeamWellbeing staffGroups={staffGroups} nameOf={nameOf} />}
      </CardContent>
    </Card>
  )
}

function MyCheckin({ myUserId }: { myUserId: string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [energy, setEnergy] = useState('3')
  const [mood, setMood] = useState('3')
  const [sleep, setSleep] = useState('3')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [checkins, setCheckins] = useState<WellbeingCheckin[] | null>(null)
  const [games, setGames] = useState<Array<{ win: boolean; gameEndAt: number | string | null }>>([])

  const load = useCallback(async () => {
    try {
      const [mine, sessions] = await Promise.all([
        window.api.wellbeingListMine(60),
        window.api.collabPlayerSessions(myUserId).catch(() => []),
      ])
      setCheckins(mine)
      setGames(sessions.flatMap((s) => s.games.map((g) => ({ win: g.win, gameEndAt: g.gameEndAt }))))
    } catch (err) {
      setCheckins([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [myUserId, t, toast])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await window.api.wellbeingAddCheckin({ energy: Number(energy), mood: Number(mood), sleep: Number(sleep), note: note.trim() || null })
      setNote('')
      await load()
      toast({ title: t('wellbeing.saved', { defaultValue: 'Check-in saved' }), variant: 'gold' })
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const correlation = useMemo(() => (checkins ? computeEnergyWinrateCorrelation(checkins, games) : null), [checkins, games])

  return (
    <div className="space-y-3 rounded-lg border border-hextech-border-dim p-3">
      <h4 className="text-sm font-medium text-hextech-text-bright">{t('wellbeing.myCheckin', { defaultValue: 'Quick check-in' })}</h4>
      <div className="flex flex-wrap gap-3">
        {([
          ['energy', energy, setEnergy, 'wellbeing.energy'],
          ['mood', mood, setMood, 'wellbeing.mood'],
          ['sleep', sleep, setSleep, 'wellbeing.sleep'],
        ] as const).map(([key, value, setter, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-hextech-text">
            {t(label, { defaultValue: key })}
            <Select value={value} onValueChange={setter}>
              <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCALE.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        ))}
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} maxLength={500} placeholder={t('wellbeing.notePlaceholder', { defaultValue: 'Anything to add? (optional)' })} />
      <Button size="sm" onClick={save} disabled={saving}>
        {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('wellbeing.save', { defaultValue: 'Log check-in' })}
      </Button>

      {correlation && (correlation.lowEnergyGames > 0 || correlation.otherGames > 0) && (
        <p className="text-xs text-hextech-text-dim">
          {correlation.lowEnergyGames > 0 && correlation.lowEnergyWinrate != null &&
            t('wellbeing.correlationLow', { defaultValue: 'Games on a low-energy day (≤2): {{rate}}% winrate ({{count}} games)', rate: correlation.lowEnergyWinrate, count: correlation.lowEnergyGames })}
          {correlation.lowEnergyGames > 0 && correlation.otherGames > 0 && ' · '}
          {correlation.otherGames > 0 && correlation.otherWinrate != null &&
            t('wellbeing.correlationOther', { defaultValue: 'Other days: {{rate}}% winrate ({{count}} games)', rate: correlation.otherWinrate, count: correlation.otherGames })}
        </p>
      )}

      {checkins === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : checkins.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-[11px] text-hextech-text-dim">
          {checkins.slice(0, 10).map((c) => (
            <li key={c.id} className="rounded bg-hextech-elevated/40 px-1.5 py-0.5">
              {new Date(c.createdAt).toLocaleDateString(i18n.language)} — {t('wellbeing.energyShort', { defaultValue: 'E' })}{c.energy} {t('wellbeing.moodShort', { defaultValue: 'M' })}{c.mood} {t('wellbeing.sleepShort', { defaultValue: 'S' })}{c.sleep}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TeamWellbeing({ staffGroups, nameOf }: { staffGroups: Group[]; nameOf: (id: string) => string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? null)
  const group = staffGroups.find((g) => g.id === groupId)
  const [byPlayer, setByPlayer] = useState<Map<string, WellbeingCheckin[]> | null>(null)

  useEffect(() => {
    if (!group) return
    setByPlayer(null)
    const playerIds = group.members.filter((m) => m.role === 'player').map((m) => m.userId)
    window.api.wellbeingListForGroup(playerIds)
      .then((rows) => {
        const map = new Map<string, WellbeingCheckin[]>()
        for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r])
        setByPlayer(map)
      })
      .catch((err) => { setByPlayer(new Map()); toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) })
  }, [group, t, toast])

  if (!group) return null

  return (
    <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-hextech-text-bright">{t('wellbeing.team', { defaultValue: 'Team wellbeing' })}</h4>
        {staffGroups.length > 1 && (
          <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
            className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
            {staffGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
      {byPlayer === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" />
      ) : byPlayer.size === 0 ? (
        <p className="text-xs text-hextech-text-dim">{t('wellbeing.noShared', { defaultValue: 'No player has shared their wellbeing check-ins in this group yet.' })}</p>
      ) : (
        <ul className="space-y-1">
          {[...byPlayer.entries()].map(([userId, checkins]) => {
            const alert = computeMoodDeclineAlert(checkins)
            const latest = checkins[0]
            return (
              <li key={userId} className="flex items-center justify-between text-sm text-hextech-text">
                <span>{nameOf(userId)} — {t('wellbeing.energyShort', { defaultValue: 'E' })}{latest.energy} {t('wellbeing.moodShort', { defaultValue: 'M' })}{latest.mood} {t('wellbeing.sleepShort', { defaultValue: 'S' })}{latest.sleep}</span>
                {alert && (
                  <span className="flex items-center gap-1 rounded bg-[#E24C3A]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#E24C3A]">
                    <AlertTriangle className="h-3 w-3" />{t('wellbeing.moodDeclining', { defaultValue: 'Mood declining' })}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
