#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { splitSql, isEnumAddition } from './self-hosting/sql-statements.mjs'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  await client.connect()
  await client.query("SET lock_timeout = '60s'")
  await client.query("SELECT pg_advisory_lock(hashtext('petrios:migrations'))")
  try {
    const { rows: [state] } = await client.query("SELECT to_regclass('public._bytes_migrations') AS ledger, to_regclass('public.organizations') AS existing")
    if (!state.ledger && state.existing) throw new Error('Unrecognised migration history. Restore a backup and reconcile history before using this runner.')
    await client.query(`CREATE TABLE IF NOT EXISTS public._bytes_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text);
      ALTER TABLE public._bytes_migrations ADD COLUMN IF NOT EXISTS checksum text;
      ALTER TABLE public._bytes_migrations ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public._bytes_migrations FROM anon, authenticated;`)
    const { rows } = await client.query('SELECT filename, checksum FROM public._bytes_migrations')
    const applied = new Map(rows.map(row => [row.filename, row.checksum]))
    const dir = path.join(process.cwd(), 'supabase', 'migrations')
    const files = (await readdir(dir)).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort()
    if (!files.length) throw new Error('No migrations packaged in image')
    for (const name of applied.keys()) if (!files.includes(name)) throw new Error(`Database contains a newer or unknown migration: ${name}`)
    // Supabase installs extensions in its extensions schema. 000 predates the explicit extension in 001.
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; SET search_path = public, extensions;')
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      if (applied.has(file)) {
        if (applied.get(file) && applied.get(file) !== checksum) throw new Error(`Applied migration changed: ${file}`)
        if (!applied.get(file)) await client.query('UPDATE public._bytes_migrations SET checksum=$1 WHERE filename=$2', [checksum, file])
        continue
      }
      console.log(`Applying ${file}`)
      const statements = splitSql(sql)
      // Commit enum additions first: later SQL may use the new value. Historical SQL stays untouched.
      for (const statement of statements.filter(isEnumAddition)) {
        if (!/ADD\s+VALUE\s+IF\s+NOT\s+EXISTS/i.test(statement)) throw new Error(`Non-retryable enum addition in ${file}`)
        await client.query(statement)
      }
      await client.query('BEGIN')
      try {
        for (const statement of statements.filter(s => !isEnumAddition(s))) await client.query(statement)
        await client.query('INSERT INTO public._bytes_migrations(filename,checksum) VALUES ($1,$2)', [file, checksum])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error }
    }
    await client.query("NOTIFY pgrst, 'reload schema'")
    console.log('Schema is up to date.')
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('petrios:migrations'))") }
}
main().catch(error => { console.error('Migration failed:', error.message); process.exitCode = 1 }).finally(() => client.end())
