/** Written next to the precompiled module by scripts/cloudflare/tasks.mjs. */
export interface PrecompiledWasm {
  readonly module: WebAssembly.Module
  readonly byteLength: number
  readonly sha256: string
}

type Instantiate = (source: unknown, imports?: WebAssembly.Imports) => Promise<unknown>

function asBytes(source: unknown): Uint8Array<ArrayBuffer> | null {
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (ArrayBuffer.isView(source) && source.buffer instanceof ArrayBuffer) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  }
  return null
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Workers forbid compiling WebAssembly from bytes at runtime, and yoga-layout
 * (under @react-pdf/layout) instantiates its embedded wasm from bytes. A call
 * carrying exactly those bytes is answered from the module wrangler
 * precompiled at upload; every other call passes through unchanged.
 */
export function redirectInstantiateToPrecompiled(
  api: { instantiate: typeof WebAssembly.instantiate },
  target: PrecompiledWasm
): void {
  const original = api.instantiate.bind(api) as Instantiate
  const redirected: Instantiate = async (source, imports) => {
    const bytes = asBytes(source)
    if (bytes && bytes.byteLength === target.byteLength && (await sha256Hex(bytes)) === target.sha256) {
      const instance = await original(target.module, imports)
      return { module: target.module, instance }
    }
    return original(source, imports)
  }
  api.instantiate = redirected as typeof WebAssembly.instantiate
}
