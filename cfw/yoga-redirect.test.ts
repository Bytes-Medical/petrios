import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { redirectInstantiateToPrecompiled } from './yoga-redirect'

// (module (func (export "answer") (result i32) i32.const 42))
const ANSWER_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00,
  0x07, 0x0a, 0x01, 0x06, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x00, 0x00, 0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a,
  0x0b,
])

function setup() {
  const precompiled = new WebAssembly.Module(ANSWER_WASM)
  const original = vi.fn(WebAssembly.instantiate)
  const api = { instantiate: original as unknown as typeof WebAssembly.instantiate }
  redirectInstantiateToPrecompiled(api, {
    module: precompiled,
    byteLength: ANSWER_WASM.byteLength,
    sha256: createHash('sha256').update(ANSWER_WASM).digest('hex'),
  })
  return { api, precompiled, original }
}

describe('redirectInstantiateToPrecompiled', () => {
  it('answers byte-identical sources from the precompiled module', async () => {
    const { api, precompiled, original } = setup()
    const copy = new Uint8Array(ANSWER_WASM)
    const result = (await api.instantiate(copy)) as WebAssembly.WebAssemblyInstantiatedSource
    expect(result.module).toBe(precompiled)
    expect((result.instance.exports.answer as () => number)()).toBe(42)
    expect(original).toHaveBeenCalledTimes(1)
    expect(original.mock.calls[0][0]).toBe(precompiled)
  })

  it('accepts an ArrayBuffer or an offset view of the same bytes', async () => {
    const { api, precompiled } = setup()
    const padded = new Uint8Array(ANSWER_WASM.byteLength + 3)
    padded.set(ANSWER_WASM, 3)
    const fromView = (await api.instantiate(padded.subarray(3))) as WebAssembly.WebAssemblyInstantiatedSource
    const fromBuffer = (await api.instantiate(ANSWER_WASM.slice().buffer)) as WebAssembly.WebAssemblyInstantiatedSource
    expect(fromView.module).toBe(precompiled)
    expect(fromBuffer.module).toBe(precompiled)
  })

  it('passes other sources through unchanged', async () => {
    const { api, precompiled, original } = setup()
    const sameLength = new Uint8Array(ANSWER_WASM)
    sameLength[sameLength.length - 2] = 0x07
    const differentBytes = (await api.instantiate(sameLength)) as WebAssembly.WebAssemblyInstantiatedSource
    expect(differentBytes.module).not.toBe(precompiled)
    expect(original.mock.calls[0][0]).toBe(sameLength)

    const instance = await api.instantiate(precompiled)
    expect(instance).toBeInstanceOf(WebAssembly.Instance)
    expect(original.mock.calls[1][0]).toBe(precompiled)

    await expect(api.instantiate(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    expect(original).toHaveBeenCalledTimes(3)
  })
})
