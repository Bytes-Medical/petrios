import { describe, expect, it } from 'vitest'
import {
  contactDisplayName,
  mergeContactNames,
  normalizeContactEmail,
} from './contacts'

describe('normalizeContactEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeContactEmail('  Dr.Jones@NHS.net ')).toBe('dr.jones@nhs.net')
  })
})

describe('mergeContactNames', () => {
  const empty = { first_name: null, last_name: null, role_note: null }
  const filled = { first_name: 'Ada', last_name: 'Lovelace', role_note: 'Consultant' }

  it('fills empty fields when not overwriting', () => {
    expect(
      mergeContactNames(empty, { firstName: 'Ada', lastName: 'Lovelace' }, { overwriteNames: false })
    ).toEqual({ first_name: 'Ada', last_name: 'Lovelace' })
  })

  it('does not touch already-set fields when not overwriting', () => {
    expect(
      mergeContactNames(filled, { firstName: 'Grace', lastName: 'Hopper' }, { overwriteNames: false })
    ).toEqual({})
  })

  it('overwrites differing fields when overwriting (self-reported)', () => {
    expect(
      mergeContactNames(filled, { firstName: 'Grace', lastName: 'Lovelace' }, { overwriteNames: true })
    ).toEqual({ first_name: 'Grace' })
  })

  it('ignores blank or whitespace-only incoming values in both modes', () => {
    expect(
      mergeContactNames(filled, { firstName: '  ', lastName: '' }, { overwriteNames: true })
    ).toEqual({})
    expect(
      mergeContactNames(empty, { firstName: undefined, lastName: null }, { overwriteNames: false })
    ).toEqual({})
  })

  it('handles role notes with the same rules', () => {
    expect(
      mergeContactNames(empty, { roleNote: 'Registrar' }, { overwriteNames: false })
    ).toEqual({ role_note: 'Registrar' })
    expect(
      mergeContactNames(filled, { roleNote: 'Registrar' }, { overwriteNames: false })
    ).toEqual({})
  })
})

describe('contactDisplayName', () => {
  it('joins names and falls back to email', () => {
    expect(
      contactDisplayName({ first_name: 'Ada', last_name: 'Lovelace', email: 'a@b.c' })
    ).toBe('Ada Lovelace')
    expect(
      contactDisplayName({ first_name: 'Ada', last_name: null, email: 'a@b.c' })
    ).toBe('Ada')
    expect(
      contactDisplayName({ first_name: null, last_name: null, email: 'a@b.c' })
    ).toBe('a@b.c')
  })
})
