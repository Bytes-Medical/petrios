/** Split top-level PostgreSQL statements, preserving quoted functions and nested comments. */
export function splitSql(sql) {
  const statements = []
  let start = 0, i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unclosed SQL comment')
      continue
    }
    const quote = sql[i]
    if (quote === "'" || quote === '"') {
      const escapes = quote === "'" && /[eE]/.test(sql[i - 1] || '') && !/[\w$]/.test(sql[i - 2] || '')
      i++
      let closed = false
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue }
          i++; closed = true; break
        }
        i++
      }
      if (!closed) throw new Error('Unclosed SQL string')
      continue
    }
    if (quote === '$') {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length)
        if (end < 0) throw new Error('Unclosed SQL dollar quote')
        i = end + tag.length; continue
      }
    }
    if (quote === ';') { statements.push(sql.slice(start, i + 1)); start = i + 1 }
    i++
  }
  if (sql.slice(start).trim()) statements.push(sql.slice(start))
  return statements
}

export function isEnumAddition(statement) {
  const withoutLeadingComments = statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '')
  return /^ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i.test(withoutLeadingComments)
}
