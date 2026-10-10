import { describe, expect, it } from 'vitest'
import { parseCsv, RotaCsvError } from './csv'

describe('parseCsv', () => {
  it('parses quotes, escaped quotes and embedded newlines', () => {
    const { header, rows } = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n')
    expect(header).toEqual(['a', 'b', 'c'])
    expect(rows).toEqual([['x, y', 'say "hi"', 'line1\nline2']])
  })

  it('handles CRLF, a BOM, trailing blank lines and ragged rows', () => {
    const { header, rows } = parseCsv('﻿ Name ,Code\r\nA,1,extra\r\nB\r\n\r\n')
    expect(header).toEqual(['Name', 'Code'])
    expect(rows).toEqual([['A', '1', 'extra'], ['B']])
  })

  it('keeps empty fields', () => {
    expect(parseCsv('a,b\n,\n').rows).toEqual([['', '']])
  })

  it('refuses a file over the byte cap', () => {
    expect(() => parseCsv('a\n' + 'x'.repeat(100), { maxBytes: 50 })).toThrow(RotaCsvError)
    expect(() => parseCsv('a\n' + 'x'.repeat(10), { maxBytes: 50 })).not.toThrow()
  })

  it('refuses more rows than the cap', () => {
    expect(() => parseCsv('h\n1\n2\n3\n', { maxRows: 2 })).toThrow(/more rows/)
  })

  it('reports line numbers without echoing values', () => {
    try {
      parseCsv('h1,h2\nok,ok\nSECRET"VALUE,x\n')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RotaCsvError)
      expect((error as RotaCsvError).line).toBe(3)
      expect((error as Error).message).not.toContain('SECRET')
    }
    try {
      parseCsv('h\n"never closed SECRET\n')
      expect.unreachable()
    } catch (error) {
      expect((error as RotaCsvError).line).toBe(2)
      expect((error as Error).message).not.toContain('SECRET')
    }
    expect(() => parseCsv('h\n"a"b\n')).toThrow(/after a closing quote/)
  })

  it('refuses an empty file', () => {
    expect(() => parseCsv('')).toThrow(/empty/)
  })
})
