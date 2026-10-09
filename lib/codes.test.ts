import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_ALPHABET, cryptoRandom, generateCode } from './codes'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cryptoRandom', () => {
  it('returns floats in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = cryptoRandom()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('maps the extreme 32-bit draws to 0 and just below 1', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    spy.mockImplementationOnce((array) => {
      ;(array as Uint32Array)[0] = 0
      return array
    })
    expect(cryptoRandom()).toBe(0)
    spy.mockImplementationOnce((array) => {
      ;(array as Uint32Array)[0] = 0xffff_ffff
      return array
    })
    const top = cryptoRandom()
    expect(top).toBeLessThan(1)
    expect(Math.floor(top * CODE_ALPHABET.length)).toBe(CODE_ALPHABET.length - 1)
  })
})

describe('generateCode', () => {
  it('draws from the CSPRNG by default, never Math.random', () => {
    const mathRandom = vi.spyOn(Math, 'random')
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const code = generateCode(8)
    expect(mathRandom).not.toHaveBeenCalled()
    expect(getRandomValues).toHaveBeenCalledTimes(8)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
  })

  it('uses only the lookalike-free alphabet', () => {
    const codes = Array.from({ length: 200 }, () => generateCode(12)).join('')
    expect(codes).not.toMatch(/[01OIa-z]/)
  })

  it('honours an injected random source (deterministic tests)', () => {
    expect(generateCode(4, () => 0)).toBe('AAAA')
    expect(generateCode(4, () => 0.999999)).toBe('9999')
  })
})
