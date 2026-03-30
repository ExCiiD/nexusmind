import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { getSupabase } from '../supabaseClient'
import { randomBytes } from 'crypto'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function registerCoachHandlers() {
  ipcMain.handle('coach:supabase-signin', async (_event, email: string, password: string) => {
    const supa = getSupabase()
    const { data, error } = await supa.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No local user found')

    // Upsert profile
    await supa.from('profiles').upsert({
      id: data.user.id,
      local_puuid: user.puuid,
      display_name: user.displayName || user.summonerName,
      role: user.role,
    })

    // Persist supabase uid + email in local DB
    await prisma.user.update({
      where: { id: user.id },
      data: { supabaseUid: data.user.id, supabaseEmail: email },
    })

    return { uid: data.user.id, email: data.user.email }
  })

  ipcMain.handle('coach:supabase-signup', async (_event, email: string, password: string) => {
    const supa = getSupabase()
    const { data, error } = await supa.auth.signUp({ email, password })
    if (error) throw new Error(error.message)
    if (!data.user) throw new Error('Signup succeeded but no user returned — check your email to confirm.')

    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No local user found')

    await supa.from('profiles').upsert({
      id: data.user.id,
      local_puuid: user.puuid,
      display_name: user.displayName || user.summonerName,
      role: user.role,
    })

    await prisma.user.update({
      where: { id: user.id },
      data: { supabaseUid: data.user.id, supabaseEmail: email },
    })

    return { uid: data.user.id, email: data.user.email, needsConfirmation: !data.session }
  })

  ipcMain.handle('coach:supabase-signout', async () => {
    const supa = getSupabase()
    await supa.auth.signOut()
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { supabaseUid: null, supabaseEmail: null },
      })
    }
    return { success: true }
  })

  ipcMain.handle('coach:get-session', async () => {
    const supa = getSupabase()
    const { data } = await supa.auth.getSession()
    return data.session ? { uid: data.session.user.id, email: data.session.user.email } : null
  })

  // ---------------------------------------------------------------------------
  // Role
  // ---------------------------------------------------------------------------

  ipcMain.handle('coach:set-role', async (_event, role: string) => {
    if (!['student', 'coach', 'both'].includes(role)) throw new Error('Invalid role')
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user')
    const updated = await prisma.user.update({ where: { id: user.id }, data: { role } })

    // Sync role to Supabase if logged in
    if (user.supabaseUid) {
      const supa = getSupabase()
      await supa.from('profiles').update({ role }).eq('id', user.supabaseUid).catch(() => {})
    }

    return updated
  })

  // ---------------------------------------------------------------------------
  // Invite system (student generates, coach redeems)
  // ---------------------------------------------------------------------------

  ipcMain.handle('coach:generate-invite', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) throw new Error('Must be signed in to Supabase to generate an invite')

    const supa = getSupabase()
    const code = randomBytes(8).toString('hex')

    // student_id = this user (the student generating the invite)
    // coach_id = same placeholder (student's own uid) — will be replaced by the coach on redemption
    const { error } = await supa.from('coach_students').insert({
      student_id: user.supabaseUid,
      coach_id: user.supabaseUid,
      invite_code: code,
      status: 'pending',
    })
    if (error) throw new Error(error.message)

    return { code, link: `nexusmind://coach-invite/${code}` }
  })

  ipcMain.handle('coach:redeem-invite', async (_event, code: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) throw new Error('Must be signed in to Supabase to redeem an invite')

    const supa = getSupabase()

    // Read the pending invite (student_id = the student who generated it)
    const { data: invite, error: fetchErr } = await supa
      .from('coach_students')
      .select('*')
      .eq('invite_code', code)
      .eq('status', 'pending')
      .single()

    if (fetchErr || !invite) throw new Error('Invite code not found or already used')
    if (invite.student_id === user.supabaseUid) throw new Error('You cannot redeem your own invite link')

    // Set coach_id = this user (the coach redeeming), status = active
    const { error: updateErr } = await supa
      .from('coach_students')
      .update({ coach_id: user.supabaseUid, status: 'active' })
      .eq('invite_code', code)
      .eq('status', 'pending')

    if (updateErr) throw new Error(updateErr.message)

    // Return the student's display name so the coach knows who they connected with
    const { data: studentProfile } = await supa
      .from('profiles')
      .select('display_name, local_puuid')
      .eq('id', invite.student_id)
      .single()

    return { studentName: studentProfile?.display_name ?? 'Unknown Student' }
  })

  ipcMain.handle('coach:list-coaches', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) return []

    const supa = getSupabase()
    const { data } = await supa
      .from('coach_students')
      .select('id, status, profiles!coach_id(display_name, local_puuid)')
      .eq('student_id', user.supabaseUid)
      .eq('status', 'active')

    return (data ?? []).map((row: any) => ({
      relationId: row.id,
      displayName: row.profiles?.display_name ?? 'Unknown',
      puuid: row.profiles?.local_puuid,
    }))
  })

  ipcMain.handle('coach:list-students', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) return []

    const supa = getSupabase()
    const { data } = await supa
      .from('coach_students')
      .select('id, status, profiles!student_id(id, display_name, local_puuid)')
      .eq('coach_id', user.supabaseUid)
      .eq('status', 'active')

    return (data ?? []).map((row: any) => ({
      relationId: row.id,
      supabaseId: row.profiles?.id,
      displayName: row.profiles?.display_name ?? 'Unknown',
      puuid: row.profiles?.local_puuid,
    }))
  })

  // ---------------------------------------------------------------------------
  // Coach views student data
  // ---------------------------------------------------------------------------

  ipcMain.handle('coach:get-student-sessions', async (_event, studentSupabaseId: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) throw new Error('Not signed in')

    const supa = getSupabase()
    const { data, error } = await supa
      .from('synced_sessions')
      .select('*, synced_games(*, synced_reviews(*))')
      .eq('student_id', studentSupabaseId)
      .order('date', { ascending: false })

    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle('coach:get-student-assessments', async (_event, studentSupabaseId: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) throw new Error('Not signed in')

    const supa = getSupabase()
    const { data, error } = await supa
      .from('synced_assessments')
      .select('*, synced_assessment_scores(*)')
      .eq('student_id', studentSupabaseId)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return data ?? []
  })

  // ---------------------------------------------------------------------------
  // Coach comments
  // ---------------------------------------------------------------------------

  ipcMain.handle('coach:add-comment', async (_event, data: {
    studentSupabaseId: string
    targetType: 'session' | 'game' | 'review'
    targetId: string
    content: string
  }) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) throw new Error('Not signed in')

    const supa = getSupabase()
    const { data: comment, error } = await supa
      .from('coach_comments')
      .insert({
        coach_id: user.supabaseUid,
        student_id: data.studentSupabaseId,
        target_type: data.targetType,
        target_id: data.targetId,
        content: data.content,
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return comment
  })

  ipcMain.handle('coach:update-comment', async (_event, commentId: string, content: string) => {
    const supa = getSupabase()
    const { data, error } = await supa
      .from('coach_comments')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  })

  ipcMain.handle('coach:delete-comment', async (_event, commentId: string) => {
    const supa = getSupabase()
    const { error } = await supa.from('coach_comments').delete().eq('id', commentId)
    if (error) throw new Error(error.message)
    return { success: true }
  })

  ipcMain.handle('coach:get-comments', async (_event, targetType: string, targetId: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user?.supabaseUid) return []

    const supa = getSupabase()
    const { data } = await supa
      .from('coach_comments')
      .select('*, profiles!coach_id(display_name)')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('created_at', { ascending: true })

    return (data ?? []).map((c: any) => ({
      ...c,
      coachName: c.profiles?.display_name ?? 'Coach',
      isOwn: c.coach_id === user.supabaseUid,
    }))
  })
}
