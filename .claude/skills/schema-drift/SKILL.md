---
name: schema-drift
description: Diff the production Supabase schema against supabase/migrations/ to find unapplied migrations or manual prod edits. Use before deployments, after adding migrations, or when prod behaviour suggests a missing column/table.
---

# Prod schema drift check

Migrations are applied manually (`supabase db push` or the SQL editor), so prod
can drift from `supabase/migrations/`. This procedure finds the drift without
any privileged access.

## Method

1. Read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
   `.env.local` (or ask which environment to check). These are public-by-design
   values; never read or print the service-role key for this task.
2. Fetch the live schema via PostgREST's OpenAPI description:

   ```
   curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $ANON_KEY"
   ```

   The JSON `definitions` object is the authoritative list of live tables and
   their columns (RLS does not hide table shape from this endpoint).
   Use `/usr/bin/curl` — the system Python's urllib fails SSL verification on
   this host.
3. Parse `supabase/migrations/*.sql` in numeric order for `CREATE TABLE`,
   `ALTER TABLE ... ADD COLUMN`, `DROP COLUMN`, and renames to build the
   expected schema. Watch for `IF NOT EXISTS` variants and quoted identifiers.
4. Diff both directions and report:
   - **Expected but missing in prod** → these migrations still need applying;
     output the exact SQL (or migration file names) the user should run.
   - **In prod but not in migrations** → someone edited prod by hand; propose a
     backport migration so the repo becomes the source of truth again.

## Rules

- Never attempt to fix prod directly (no PATCH/DDL against the live database) —
  report the SQL and let the user run it in the Supabase SQL editor.
- Views and RPCs don't fully appear in the OpenAPI dump; this check is for
  tables/columns. Flag that limitation in your report when relevant.
- Present the result as a short table: object, expected source (migration
  number), prod status.
