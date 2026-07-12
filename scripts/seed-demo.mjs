#!/usr/bin/env node
/**
 * Seeds a demo organization for evaluation and the hosted demo:
 * one org, two departments, a moderator + trainees (password login),
 * past sessions with attendance evidence + feedback, upcoming sessions,
 * and an open teaching slot.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
 *
 * SAFETY: refuses to run against a database that already has organizations
 * unless --force is passed. Demo accounts (password: demo-petrios-2026):
 *   demo-moderator@example.org, demo-trainee-1..5@example.org
 */
import { createClient } from '@supabase/supabase-js'

const FORCE = process.argv.includes('--force')
const PASSWORD = 'demo-petrios-2026'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const daysFromNow = (days, hour = 13) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

async function createUser(email, fullName, grade) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const userId = data.user.id
  await db.from('profiles').upsert(
    { user_id: userId, email, full_name: fullName, grade },
    { onConflict: 'user_id' }
  )
  return userId
}

async function main() {
  const { count, error: countError } = await db
    .from('organizations')
    .select('id', { count: 'exact', head: true })
  if (countError) throw new Error(`Cannot inspect database: ${countError.message}`)
  if ((count ?? 0) > 0 && !FORCE) {
    console.error(
      `Refusing to seed: this database already has ${count} organization(s). Pass --force to seed anyway.`
    )
    process.exit(1)
  }

  console.log('Creating users…')
  const moderatorId = await createUser('demo-moderator@example.org', 'Dana Moderator', 'Consultant')
  const traineeIds = []
  for (let i = 1; i <= 5; i++) {
    traineeIds.push(
      await createUser(
        `demo-trainee-${i}@example.org`,
        `Trainee ${'ABCDE'[i - 1]}`,
        i <= 3 ? 'Level 1 Trainee' : 'Level 2 Trainee'
      )
    )
  }

  console.log('Creating organization + departments…')
  const { data: org } = await db
    .from('organizations')
    .insert({ name: 'Demo Teaching Hospital', created_by: moderatorId })
    .select()
    .single()
  await db.from('organization_members').insert([
    { org_id: org.id, user_id: moderatorId, role: 'org_admin' },
    ...traineeIds.map((id) => ({ org_id: org.id, user_id: id, role: 'trainee' })),
  ])

  const { data: departments } = await db
    .from('departments')
    .insert([
      { org_id: org.id, name: 'Paediatrics', department_code: '111111', created_by: moderatorId },
      { org_id: org.id, name: 'Emergency Medicine', department_code: '222222', created_by: moderatorId },
    ])
    .select()
  const dept = departments[0]

  await db.from('department_members').insert([
    { org_id: org.id, department_id: dept.id, user_id: moderatorId, role: 'department_admin', grade: 'Consultant' },
    ...traineeIds.map((id, i) => ({
      org_id: org.id,
      department_id: dept.id,
      user_id: id,
      role: 'trainee',
      grade: i < 3 ? 'Level 1 Trainee' : 'Level 2 Trainee',
    })),
  ])

  console.log('Creating sessions…')
  const sessionRows = [
    { title: 'Sepsis in the under 5s', offset: -14 },
    { title: 'Safe prescribing workshop', offset: -7 },
    { title: 'Breaking bad news — communication skills', offset: -2 },
    { title: 'DKA management update', offset: 5 },
    { title: 'Safeguarding level 3 refresher', offset: 12 },
  ]
  const { data: sessions } = await db
    .from('sessions')
    .insert(
      sessionRows.map((row) => ({
        org_id: org.id,
        department_id: dept.id,
        title: row.title,
        description: `Demo session: ${row.title}.`,
        date_start: daysFromNow(row.offset, 13),
        date_end: daysFromNow(row.offset, 14),
        location_type: 'IN_PERSON',
        status: 'PUBLISHED',
        created_by: moderatorId,
      }))
    )
    .select()

  console.log('Recording attendance + feedback for past sessions…')
  for (const session of sessions.filter((s) => new Date(s.date_start) < new Date())) {
    // Attendance evidence for a varying subset (leaves visible ABSENT rows
    // and equity variation across grades).
    const attendees = traineeIds.filter((_, i) => (i + sessionRows.length) % 5 !== 4 && i !== 4)
    for (const userId of attendees) {
      await db.from('attendance_evidence').insert({
        org_id: org.id,
        session_id: session.id,
        department_id: dept.id,
        user_id: userId,
        source: 'SELF_CHECKIN',
        observed_at: session.date_start,
        metadata: {},
      })
      await db.from('attendance').upsert(
        {
          org_id: org.id,
          session_id: session.id,
          department_id: dept.id,
          user_id: userId,
          status: 'PRESENT',
          primary_source: 'SELF_CHECKIN',
          first_evidence_at: session.date_start,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'session_id,user_id' }
      )
      await db.from('session_feedback').insert({
        org_id: org.id,
        session_id: session.id,
        rating: 4 + (userId.charCodeAt(0) % 2),
        comment: 'Great structure — more cases next time please.',
        answers: [],
      })
    }
  }

  console.log('Creating an open teaching slot…')
  await db.from('teaching_slots').insert({
    org_id: org.id,
    department_id: dept.id,
    date_start: daysFromNow(9, 12),
    date_end: daysFromNow(9, 13),
    location_type: 'IN_PERSON',
    status: 'OPEN',
    created_by: moderatorId,
  })

  console.log(`\nDemo seeded. Sign in as demo-moderator@example.org / ${PASSWORD}`)
  console.log('Trainees: demo-trainee-1..5@example.org (same password).')
}

main().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
