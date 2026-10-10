/**
 * In-repo RFC 4180 CSV parser for the rota upload (spec/14). Runs in the
 * coordinator's browser: the raw file never leaves the device. No dependency
 * (DESIGN §5.2 rules out the npm `xlsx` package).
 *
 * Supports quoted fields, escaped quotes (""), embedded newlines, CRLF or LF
 * line endings and a UTF-8 BOM. Ragged rows are kept as-is (callers read a
 * missing cell as ''). Blank lines are skipped. Error messages carry a line
 * number and never echo a cell value.
 */

export const CSV_DEFAULT_MAX_BYTES = 10 * 1024 * 1024
export const CSV_DEFAULT_MAX_ROWS = 20_000

export class RotaCsvError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(line > 0 ? `${message} (line ${line})` : message)
    this.name = 'RotaCsvError'
    this.line = line
  }
}

function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

export function parseCsv(
  text: string,
  opts: { maxBytes?: number; maxRows?: number } = {}
): { header: string[]; rows: string[][] } {
  const maxBytes = opts.maxBytes ?? CSV_DEFAULT_MAX_BYTES
  const maxRows = opts.maxRows ?? CSV_DEFAULT_MAX_ROWS
  if (utf8Length(text) > maxBytes) throw new RotaCsvError('The file is larger than the upload limit', 0)

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let quotedField = false
  let afterQuote = false
  let line = 1
  let quoteStartLine = 0

  const endField = () => {
    record.push(field)
    field = ''
    quotedField = false
    afterQuote = false
  }
  const endRecord = () => {
    endField()
    const blank = record.length === 1 && record[0] === ''
    if (!blank) {
      records.push(record)
      // +1 for the header row.
      if (records.length > maxRows + 1) throw new RotaCsvError('The file has more rows than the upload limit', line)
    }
    record = []
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else {
        if (ch === '\n') line++
        field += ch
      }
      continue
    }
    if (ch === ',') {
      endField()
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++
      endRecord()
      line++
    } else if (ch === '\n') {
      endRecord()
      line++
    } else if (ch === '"') {
      if (field.length > 0 || quotedField) throw new RotaCsvError('Unexpected quote inside a field', line)
      inQuotes = true
      quotedField = true
      quoteStartLine = line
    } else {
      if (afterQuote) throw new RotaCsvError('Unexpected text after a closing quote', line)
      field += ch
    }
  }
  if (inQuotes) throw new RotaCsvError('A quoted field is not closed', quoteStartLine)
  if (field.length > 0 || record.length > 0 || quotedField) endRecord()

  if (records.length === 0) throw new RotaCsvError('The file is empty', 0)
  const [header, ...rows] = records
  return { header: header.map((name) => name.trim()), rows }
}
