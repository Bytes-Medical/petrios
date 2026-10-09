import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { splitSql, isEnumAddition } from './sql-statements.mjs'
import { apiKey } from './keys.mjs'

test('SQL splitting preserves quoted functions, nested comments, and escaped strings', () => {
  const sql = `-- preamble;\nALTER TYPE e ADD VALUE IF NOT EXISTS 'new';\nCREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM ';'; END; $body$ LANGUAGE plpgsql; /* outer; /* inner; */ end */ SELECT 'a'';b', E'a\\\';b';`
  const parts = splitSql(sql)
  assert.equal(parts.length, 3)
  assert.equal(parts.filter(isEnumAddition).length, 1)
  assert.match(parts[1], /PERFORM ';'/)
  assert.throws(() => splitSql('SELECT $x$unfinished'))
})
test('API keys are deterministic, role-specific, and signed using the installation secret', () => {
  const secret = 'a'.repeat(64)
  const key = apiKey(secret, 'anon')
  assert.equal(key, apiKey(secret, 'anon'))
  assert.notEqual(key, apiKey(secret, 'service_role'))
  assert.notEqual(key, apiKey('b'.repeat(64), 'anon'))
  const [header, payload, signature] = key.split('.')
  assert.equal(signature, createHmac('sha256',secret).update(`${header}.${payload}`).digest('base64url'))
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).role, 'anon')
})
