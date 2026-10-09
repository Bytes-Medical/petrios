/**
 * Test-only: a minimal ZIP writer for building DOCX/PPTX fixtures in tests
 * (stored or deflated entries, optional data descriptors and flags). CRCs are
 * zero: the extractor relies on the stored SHA-256 instead. Never imported by
 * application code.
 */

export interface ZipPart {
  name: string
  data: string
  /** 0 = stored, 8 = deflate (default). */
  method?: 0 | 8
  /** Write sizes in a trailing data descriptor (local header sizes are zero). */
  descriptor?: boolean
  flags?: number
}

const u16 = (value: number) => {
  const out = Buffer.alloc(2)
  out.writeUInt16LE(value)
  return out
}
const u32 = (value: number) => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value >>> 0)
  return out
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function zip(parts: ZipPart[]): Promise<Uint8Array> {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name, 'utf8')
    const raw = Buffer.from(part.data, 'utf8')
    const method = part.method ?? 8
    const data = method === 8 ? Buffer.from(await deflateRaw(raw)) : raw
    const flags = (part.flags ?? 0) | (part.descriptor ? 0x0008 : 0)
    const localSizes = part.descriptor ? [u32(0), u32(0)] : [u32(data.length), u32(raw.length)]
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(0),
      ...localSizes, u16(name.length), u16(0), name, data,
      ...(part.descriptor ? [u32(0x08074b50), u32(0), u32(data.length), u32(raw.length)] : []),
    ])
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(0),
      u32(data.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name,
    ]))
    locals.push(local)
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length),
    u32(directory.length), u32(offset), u16(0),
  ])
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}
