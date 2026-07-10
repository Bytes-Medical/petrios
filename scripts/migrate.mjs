#!/usr/bin/env node
/**
 * Migration runner for self-hosted deployments (no Supabase CLI needed).
 *
 *   DATABASE_URL=postgres://postgres:...@host:5432/postgres npm run db:migrate
 *
 * Applies supabase/migrations/*.sql in filename order, tracking applied files
 * in a _bytes_migrations table so reruns are no-ops. Each migration runs in
 * its own transaction EXCEPT files containing ALTER TYPE ... ADD VALUE
 * (which Postgres requires outside an explicit transaction block when the
 * enum is subsequently used).
 *
 * Supabase-CLI users can keep using `supabase db push` instead — both paths
 * are supported; this table only tracks what THIS runner applied.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required, e.g. postgres://postgres:pass@localhost:5432/postgres')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._bytes_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const { rows } = await client.query('SELECT filename FROM public._bytes_migrations')
    const applied = new Set(rows.map((r) => r.filename))

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      const needsNoTx = /ALTER TYPE\s+\S+\s+ADD VALUE/i.test(sql)

      console.log(`→ applying ${file}${needsNoTx ? ' (no transaction: enum change)' : ''}`)
      if (needsNoTx) {
        await client.query(sql)
        await client.query('INSERT INTO public._bytes_migrations (filename) VALUES ($1)', [file])
      } else {
        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query('INSERT INTO public._bytes_migrations (filename) VALUES ($1)', [file])
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        }
      }
      count++
    }

    console.log(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
