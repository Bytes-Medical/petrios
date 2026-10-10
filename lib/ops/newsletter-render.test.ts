import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  NEWSLETTER_HTML_BUDGET_BYTES,
  NEWSLETTER_HTML_HARD_LIMIT_BYTES,
  NEWSLETTER_INDEX_TITLE_MAX,
  NEWSLETTER_LAYOUT_LABELS,
  NEWSLETTER_PREVIEW_SANDBOX,
  newsletterByteLength,
  newsletterLayoutOf,
  newsletterPreviewDocument,
  newsletterPreviewFrameStyle,
  renderNewsletterEmail,
  renderNewsletterWithLayout,
  UNSUBSCRIBE_PLACEHOLDER,
  type NewsletterRenderInput,
} from './newsletter-render'
import {
  PDF,
  PPTX,
  SAMPLE_DEPARTMENT_ID,
  SAMPLE_IDS,
  sampleNewsletterInput,
  stressNewsletterInput,
  stressUuid,
} from './newsletter-render.fixture'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
const BUDGET = 61_440

describe('renderNewsletterEmail: approved design', () => {
  it('reproduces the approved mockup HTML and text byte for byte', () => {
    const out = renderNewsletterEmail(sampleNewsletterInput())
    expect(out.layout).toBe('full')
    expect(out.html).toBe(fixture('newsletter-sample.html'))
    expect(out.text).toBe(fixture('newsletter-sample.txt'))
  })

  it('has no images, SVG, data: URIs or web fonts', () => {
    const { html } = renderNewsletterEmail(sampleNewsletterInput())
    expect(html).not.toMatch(/<img|<svg|data:|@font-face|fonts\.googleapis/i)
  })
})

describe('escaping', () => {
  const hostile = `<img src=x onerror=alert(1)>"'&${UNSUBSCRIBE_PLACEHOLDER}`

  function hostileInput(): NewsletterRenderInput {
    const input = sampleNewsletterInput()
    input.organizationName = hostile
    input.departmentName = hostile
    input.content.subject = hostile
    input.content.intro = hostile
    input.content.closing = hostile
    for (const session of input.content.sessions) {
      session.title = hostile
      session.overview = hostile
      session.learning_points = session.learning_points.map(() => hostile)
    }
    for (const meta of Object.values(input.render.sessions)) meta.teachers = [hostile, `${hostile} 2`]
    input.render.coordinators = [hostile]
    for (const row of input.render.upcoming.sessions) {
      row.title = hostile
      row.teachers = [hostile]
    }
    return input
  }

  it('escapes every dynamic field and never lets text spell the unsubscribe placeholder', () => {
    for (const layout of ['full', 'compact', 'index'] as const) {
      const { html, text } = renderNewsletterWithLayout(hostileInput(), layout)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('onerror=alert(1)>')
      expect(count(html, UNSUBSCRIBE_PLACEHOLDER)).toBe(1)
      expect(html).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`)
      expect(html).toContain('&#37;&#37;UNSUBSCRIBE_URL&#37;&#37;')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;')
      expect(count(text, UNSUBSCRIBE_PLACEHOLDER)).toBe(1)
      expect(text.trimEnd().endsWith(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`)).toBe(true)
    }
  })

  it('escapes the title, the aria-label and the preheader too', () => {
    const { html } = renderNewsletterEmail(hostileInput())
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]
    expect(title).toBe(escapeHtml(hostile))
    expect(html).toContain(`aria-label="${escapeHtml(hostile)}"`)
  })

  it('strips control characters from the plain-text part', () => {
    const input = sampleNewsletterInput()
    input.content.intro = 'Line one\u0000\u0007\u001b[31m\u007f done'
    const { text } = renderNewsletterEmail(input)
    expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/)
    expect(text).toContain('Line one[31m done')
  })

  it('escapeHtml encodes % as well as the five HTML specials', () => {
    expect(escapeHtml(`<a href="x">&'%</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&#37;&lt;/a&gt;')
  })
})

describe('links', () => {
  it('every href is the unsubscribe placeholder or an app URL', () => {
    for (const layout of ['full', 'compact', 'index'] as const) {
      const { html } = renderNewsletterWithLayout(sampleNewsletterInput(), layout)
      for (const href of hrefs(html)) {
        expect(href === UNSUBSCRIBE_PLACEHOLDER || href.startsWith('https://petrios.example/')).toBe(true)
      }
    }
    const { html } = renderNewsletterEmail(sampleNewsletterInput())
    expect(hrefs(html)).toContain(`https://petrios.example/departments/${SAMPLE_DEPARTMENT_ID}/sessions`)
    expect(hrefs(html)).toContain(`https://petrios.example/departments/${SAMPLE_DEPARTMENT_ID}/sessions/past`)
  })

  it('trims a trailing slash from the app URL', () => {
    const input = sampleNewsletterInput()
    input.appUrl = 'https://petrios.example///'
    expect(hrefs(renderNewsletterEmail(input).html)).toContain(`https://petrios.example/sessions/${SAMPLE_IDS.asthma}`)
  })

  it('throws for a non-UUID session or department id', () => {
    const input = sampleNewsletterInput()
    const bad = '../../admin'
    input.content.sessions[0].session_id = bad
    input.render.sessions[bad] = input.render.sessions[SAMPLE_IDS.asthma]
    expect(() => renderNewsletterEmail(input)).toThrow('UUID')

    const department = sampleNewsletterInput()
    department.departmentId = 'not-a-uuid'
    expect(() => renderNewsletterEmail(department)).toThrow('UUID')
  })

  it('links the Audio Recap (#recap) only for sessions with an approved recap in the snapshot', () => {
    const { html, text } = renderNewsletterEmail(sampleNewsletterInput())
    const recapLinks = hrefs(html).filter((href) => href.endsWith('#recap'))
    expect(new Set(recapLinks)).toEqual(new Set([`https://petrios.example/sessions/${SAMPLE_IDS.asthma}#recap`]))
    expect(html).toContain('Listen to the Audio Recap')
    expect(html).toContain('5:12')
    expect(text).toContain(`Audio Recap (moderator-approved, 5:12): https://petrios.example/sessions/${SAMPLE_IDS.asthma}#recap`)

    const none = sampleNewsletterInput()
    for (const meta of Object.values(none.render.sessions)) meta.recap = null
    const rendered = renderNewsletterEmail(none)
    expect(rendered.html).not.toContain('#recap')
    expect(rendered.html).not.toContain('Listen to the Audio Recap')
    expect(rendered.text).not.toContain('Audio Recap')
  })

  it('throws when the snapshot is missing a newsletter session', () => {
    const input = sampleNewsletterInput()
    delete input.render.sessions[SAMPLE_IDS.mdt]
    expect(() => renderNewsletterEmail(input)).toThrow(`missing session ${SAMPLE_IDS.mdt}`)
  })
})

describe('Outlook branch', () => {
  it('hides the rasterised strip from Outlook and gives Outlook a flat wide-cell masthead', () => {
    const { html } = renderNewsletterEmail(sampleNewsletterInput())
    const nonMso = html.indexOf('<!--[if !mso]><!-->')
    const nonMsoEnd = html.indexOf('<!--<![endif]-->', nonMso)
    expect(nonMso).toBeGreaterThan(-1)
    expect(html.slice(nonMso, nonMsoEnd)).toContain('aria-hidden="true"')

    const mso = html.indexOf('<!--[if mso]>', nonMsoEnd)
    const msoEnd = html.indexOf('<![endif]-->', mso)
    const masthead = html.slice(mso, msoEnd)
    expect(masthead).toContain('PETRIOS')
    expect(masthead).toContain('width="600"')
    const widths = [...masthead.matchAll(/<td[^>]*\swidth="(\d+)"/g)].map((match) => Number(match[1]))
    expect(widths.length).toBeGreaterThanOrEqual(5)
    // Regression guard: Word collapses 1–2 px columns, so none may exist here.
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(8)
  })
})

describe('readouts', () => {
  const readouts = (html: string) =>
    [...html.matchAll(/text-transform:uppercase;color:#DF9377;">([^<]+)<\/p><p style="margin:4px 0 0;font-size:32px;[^"]*">([^<]+)<\/p>/g)]
      .map((match) => [match[1], match[2]])

  it('labels exactly Sessions, Hours, Files and Teachers, and never says "delivered"', () => {
    const { html, text } = renderNewsletterEmail(sampleNewsletterInput())
    // 90 + 60 + 60 minutes = 3.5 h; Dr Hannah Whitfield teaches twice but counts once.
    expect(readouts(html)).toEqual([['Sessions', '3'], ['Hours', '3.5'], ['Files', '5'], ['Teachers', '4']])
    expect(text).toContain('Sessions 3  |  Hours 3.5  |  Files 5  |  Teachers 4')
    expect(html.toLowerCase()).not.toContain('delivered')
    expect(text.toLowerCase()).not.toContain('delivered')
  })

  it('counts a teacher once across sessions whatever the capitalisation', () => {
    const input = sampleNewsletterInput()
    input.render.sessions[SAMPLE_IDS.mdt].teachers = ['Dr Marcus Bell', 'DR HANNAH WHITFIELD']
    expect(readouts(renderNewsletterEmail(input).html)[3]).toEqual(['Teachers', '4'])
  })

  it('prints whole hours without a decimal', () => {
    const input = sampleNewsletterInput()
    input.render.sessions[SAMPLE_IDS.asthma].dateEnd = '2026-10-06T12:30:00.000Z'
    expect(readouts(renderNewsletterEmail(input).html)[1]).toEqual(['Hours', '3'])
  })
})

describe('provenance', () => {
  it('names the files a session was drawn from', () => {
    const { html, text } = renderNewsletterEmail(sampleNewsletterInput())
    expect(html).toContain('Drawn from 3 teaching files (2 PDF, PPTX).')
    expect(html).toContain('Drawn from 2 teaching files (PPTX, PDF).')
    expect(text).toContain('Drawn from 3 teaching files (2 PDF, PPTX).')
  })

  it('marks a no-file session as description only and heads its points honestly', () => {
    const input = sampleNewsletterInput()
    input.content.sessions[2].learning_points = ['Bring cases from the ward.']
    const { html, text } = renderNewsletterEmail(input)
    expect(html).toContain('Drawn from the session description only. No teaching files were uploaded.')
    expect(html).toMatch(/border:1px dashed #6D6759;[^"]*">Description only<\/td>/)
    expect(count(html, '>Key points</p>')).toBe(2)
    expect(count(html, '>From the session description</p>')).toBe(1)
    expect(text).toContain('From the session description\n 1. Bring cases from the ward.')
  })

  it('omits the points heading for a no-file session without points', () => {
    const { html } = renderNewsletterEmail(sampleNewsletterInput())
    expect(html).not.toContain('>From the session description</p>')
  })
})

describe('tiers and byte budget', () => {
  it('renders 6 maximum-word sessions as full cards within budget', () => {
    const out = renderNewsletterEmail(stressNewsletterInput(6, 30, 3))
    expect(out.layout).toBe('full')
    expect(newsletterByteLength(out.html)).toBeLessThanOrEqual(BUDGET)
  })

  it('renders 7 sessions as compact rows and 21 as an index', () => {
    const compact = renderNewsletterEmail(stressNewsletterInput(7, 30, 3))
    expect(compact.layout).toBe('compact')
    expect(compact.html).toContain('A big week: overviews are here, and each session&#39;s key points are in Petrios.')
    expect(compact.html).not.toContain('>Key points</p>')
    expect(compact.text).not.toContain('Key points')

    const index = renderNewsletterEmail(stressNewsletterInput(21, 5, 1))
    expect(index.layout).toBe('index')
    expect(index.html).toContain('A big week: each session&#39;s overview and key points are in Petrios.')
    expect(index.text).not.toContain(' teaching teaching')
  })

  it('keeps 50 sessions (the generation cap) within budget in the index tier', () => {
    // build.mjs worst case: long title and long teacher names on every row.
    const out = renderNewsletterEmail(stressNewsletterInput(50, 5, 1))
    expect(out.layout).toBe('index')
    expect(newsletterByteLength(out.html)).toBeLessThanOrEqual(BUDGET)
  })

  it('shortens index titles and lists at most two teachers + N; the text part keeps them whole', () => {
    const title = `${'Long title '.repeat(15)}END`.slice(0, 160)
    const teachers = ['Dr One', 'Dr Two', 'Dr Three', 'Dr Four']
    const out = renderNewsletterEmail(stressNewsletterInput(21, 5, 1, { title, teachers }))
    expect(out.layout).toBe('index')
    const shown = `${title.slice(0, NEWSLETTER_INDEX_TITLE_MAX - 1).trimEnd()}…`
    expect(out.html).toContain(`>${escapeHtml(shown)}</a>`)
    expect(out.html).not.toContain(escapeHtml(title))
    expect(out.html).toContain('&middot; Dr One, Dr Two +2</span>')
    expect(out.text).toContain(title.slice(0, 60))
    expect(out.text).toContain('With Dr One, Dr Two, Dr Three and Dr Four')
  })

  it('never lets the index tier pass the hard limit: lists what fits, then "+N more", and keeps the footer', () => {
    // Schema maxima in 3-byte characters: the largest HTML any draft can make.
    const c = (n: number) => '€'.repeat(n)
    const names = Array.from({ length: 8 }, (_, i) => `${i}${c(119)}`)
    const input = stressNewsletterInput(50, 5, 1, { title: c(180), teachers: names })
    Object.assign(input.content, { subject: c(120), intro: c(650), closing: c(500) })
    Object.assign(input, { organizationName: c(200), departmentName: c(200) })
    input.render.coordinators = Array.from({ length: 4 }, () => c(120))
    input.render.upcoming.sessions = input.render.upcoming.sessions.map((r) => ({ ...r, title: c(180), teachers: names }))
    expect(newsletterByteLength(renderNewsletterWithLayout(input, 'index').html)).toBeGreaterThan(NEWSLETTER_HTML_HARD_LIMIT_BYTES)

    const out = renderNewsletterEmail(input)
    expect(out.layout).toBe('index')
    expect(newsletterLayoutOf(out.html)).toBe('index')
    expect(newsletterByteLength(out.html)).toBeLessThanOrEqual(NEWSLETTER_HTML_HARD_LIMIT_BYTES)
    const listed = count(out.html, '<td width="92" valign="top" class="hl t2"')
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(50)
    expect(out.html).toContain(`+${50 - listed} more sessions this week in Petrios`)
    expect(out.html).toContain(`/departments/${SAMPLE_DEPARTMENT_ID}/sessions/past`)
    expect(out.html).toContain(UNSUBSCRIBE_PLACEHOLDER)
    // The text part is never clipped by mail clients and keeps every session.
    expect(count(out.text, 'Open: https://petrios.example/sessions/')).toBe(50)
    expect(out.text).toContain(`/sessions/${stressUuid(50)}`)
  })

  it('keeps 50 schema-maximum titles with two maximum-length names under the Gmail clip (102 KB)', () => {
    const name = (letter: string) => letter.repeat(120)
    const out = renderNewsletterEmail(stressNewsletterInput(50, 5, 1, { title: 'T'.repeat(180), teachers: [name('A'), name('B')] }))
    expect(out.layout).toBe('index')
    expect(newsletterByteLength(out.html)).toBeLessThan(102 * 1024)
  })

  it('steps a full render that is over budget down to compact', () => {
    const input = stressNewsletterInput(6, 300, 3)
    expect(newsletterByteLength(renderNewsletterWithLayout(input, 'full').html)).toBeGreaterThan(NEWSLETTER_HTML_BUDGET_BYTES)
    const out = renderNewsletterEmail(input)
    expect(out.layout).toBe('compact')
    expect(newsletterByteLength(out.html)).toBeLessThanOrEqual(BUDGET)
  })

  it('measures UTF-8 bytes, not UTF-16 code units', () => {
    expect(newsletterByteLength('—')).toBe(3)
  })
})

describe('optional blocks', () => {
  it('omits the Coming up board and "Next on the board" when nothing is upcoming', () => {
    const input = sampleNewsletterInput()
    input.render.upcoming.sessions = []
    const { html, text } = renderNewsletterEmail(input)
    expect(html).not.toContain('Coming up')
    expect(html).not.toContain('Next on the board')
    expect(html).not.toContain('coming up.')
    expect(text).not.toContain('COMING UP')
  })

  it('shows the board, the lightning tag and the next session when there is upcoming teaching', () => {
    const { html, text } = renderNewsletterEmail(sampleNewsletterInput())
    expect(html).toContain('Coming up')
    expect(html).toContain('12–18 OCT')
    expect(html).toContain('Lightning &middot; 15 min')
    expect(count(html, 'Lightning &middot;')).toBe(1)
    expect(html).toContain('Bronchiolitis season: assessment, oxygen and feeding support, Tue 13 Oct at 12:30 with Dr Hannah Whitfield.')
    expect(html).toContain('Times can change. Petrios always has the latest.')
    expect(html).not.toContain('more in Petrios')
    expect(text).toContain('COMING UP · 12–18 OCT')
  })

  it('omits the coordinator sign-off when none are configured', () => {
    const input = sampleNewsletterInput()
    input.render.coordinators = []
    const { html, text } = renderNewsletterEmail(input)
    expect(html).not.toContain('Teaching coordinator')
    expect(text).not.toContain('Teaching coordinator')
    expect(renderNewsletterEmail(sampleNewsletterInput()).html)
      .toContain('Dr Sarah Lindqvist and Dr Femi Adeyemi &middot; Teaching coordinators')
  })

  it('prints "+N more in Petrios" when more upcoming sessions exist', () => {
    const input = sampleNewsletterInput()
    input.render.upcoming.more = 4
    const { html, text } = renderNewsletterEmail(input)
    expect(html).toContain('+4 more in Petrios. Times can change.')
    expect(text).toContain('+4 more in Petrios. Times can change.')
  })

  it('omits the teacher line for a session with no named teachers', () => {
    const input = sampleNewsletterInput()
    input.render.sessions[SAMPLE_IDS.mdt].teachers = []
    const { html } = renderNewsletterEmail(input)
    expect(html).not.toContain('Dr Marcus Bell')
    expect(count(html, '>With</span>')).toBe(2)
  })
})

describe('time zone', () => {
  it('formats times in the given zone, never the server clock zone', () => {
    const london = renderNewsletterEmail(sampleNewsletterInput())
    expect(london.html).toContain('12:30–14:00')
    expect(london.text).toContain('TUE 6 OCT · 12:30–14:00 · In person')

    const utc = sampleNewsletterInput()
    utc.timeZone = 'UTC'
    const rendered = renderNewsletterEmail(utc)
    expect(rendered.html).toContain('11:30–13:00')
    expect(rendered.html).not.toContain('12:30–14:00')
    // Newsletter weeks are UTC calendar keys in every zone.
    expect(rendered.html).toContain('W/C 5 OCT 2026')
    expect(rendered.html).toContain('Week commencing 5 October 2026')
  })

  it('uses three-letter months everywhere, including September (en-GB "Sept")', () => {
    const input = sampleNewsletterInput()
    input.weekStartKey = '2026-09-07'
    for (const meta of Object.values(input.render.sessions)) {
      meta.dateStart = meta.dateStart.replace('2026-10-0', '2026-09-0')
      meta.dateEnd = meta.dateEnd.replace('2026-10-0', '2026-09-0')
    }
    input.render.upcoming.startIso = '2026-09-13T23:00:00.000Z'
    input.render.upcoming.endIso = '2026-09-20T23:00:00.000Z'
    input.render.upcoming.sessions = input.render.upcoming.sessions.map((r) => ({
      ...r,
      dateStart: r.dateStart.replace('2026-10-1', '2026-09-1'),
      dateEnd: r.dateEnd.replace('2026-10-1', '2026-09-1'),
    }))
    const { html, text } = renderNewsletterEmail(input)
    expect(html).toContain('W/C 7 SEP 2026')
    expect(html).toContain('>TUE SEP<')
    expect(html).toContain('14–20 SEP')
    expect(html).toContain(', Sun 13 Sep at')
    expect(text).toContain('COMING UP · 14–20 SEP')
    expect(text).toContain('TUE 8 SEP · ')
    expect(html).toContain('Week commencing 7 September 2026')
    expect(`${html}${text}`).not.toMatch(/\bSept\b/i)
  })
})

describe('preview helpers', () => {
  it('recovers the layout tier from the stored HTML', () => {
    expect(newsletterLayoutOf(renderNewsletterEmail(sampleNewsletterInput()).html)).toBe('full')
    expect(newsletterLayoutOf(renderNewsletterEmail(stressNewsletterInput(7, 30, 3)).html)).toBe('compact')
    expect(newsletterLayoutOf(renderNewsletterEmail(stressNewsletterInput(21, 5, 1)).html)).toBe('index')
    expect(newsletterLayoutOf(renderNewsletterEmail(stressNewsletterInput(6, 300, 3)).html)).toBe('compact')
    expect(newsletterLayoutOf('<div><h3>legacy</h3></div>')).toBeNull()
    expect(NEWSLETTER_LAYOUT_LABELS.compact).toBe('Compact rows (key points in Petrios)')
  })

  it('cannot be fooled by escaped dynamic text that quotes a tier signature', () => {
    const input = sampleNewsletterInput()
    input.content.intro = '<td width="92" valign="top" class="hl t2"'
    expect(newsletterLayoutOf(renderNewsletterEmail(input).html)).toBe('full')
  })

  it('sizes the preview frame by its content box, so Desktop 600 is a 600 px viewport', () => {
    // Tailwind preflight sets border-box on every element; with the frame's
    // 1px border that would be a 598 px viewport and the phone layout.
    for (const width of [600, 375]) {
      expect(newsletterPreviewFrameStyle(width)).toEqual({ width: `${width}px`, maxWidth: 'none', boxSizing: 'content-box' })
    }
    const component = readFileSync(path.join(__dirname, '../../components/ops/NewsletterWorkspace.tsx'), 'utf8')
    expect(component).toContain('style={newsletterPreviewFrameStyle(width)}')
  })

  it('sandboxes the preview without scripts or same-origin access and opens links outside the frame', () => {
    expect(NEWSLETTER_PREVIEW_SANDBOX).not.toContain('allow-scripts')
    expect(NEWSLETTER_PREVIEW_SANDBOX).not.toContain('allow-same-origin')
    const doc = newsletterPreviewDocument(renderNewsletterEmail(sampleNewsletterInput()).html)
    expect(doc).toContain('<head><base target="_blank"><style>html{scrollbar-width:none;}</style>')
    expect(doc).toContain('<title>Wheeze, newborn rashes and a radiology round-up</title>')
    expect(newsletterPreviewDocument('<div>legacy</div>')).toBe('<div>legacy</div>')
  })
})

describe('data boundaries', () => {
  const source = (file: string) => readFileSync(path.join(__dirname, file), 'utf8')
  const imports = (code: string) => [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
  const FORBIDDEN = /attendance|feedback|certificate|reflection|portfolio|recall/i

  it('never imports attendance, feedback, certificate, reflection or portfolio data', () => {
    for (const file of ['newsletter-render.ts', 'newsletter-context.ts']) {
      for (const specifier of imports(source(file))) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(FORBIDDEN)
      }
    }
  })

  it('the snapshot loader reads only the allow-listed DAL functions', () => {
    const calls = new Set(
      [...source('newsletter-context.ts').matchAll(/\b(\w+Db|opsReads)\.(\w+)\(/g)]
        .map((match) => `${match[1]}.${match[2]}`)
    )
    expect([...calls].sort()).toEqual([
      'audioRecapsDb.listApprovedRecapDurations',
      'departmentsDb.findDepartmentSettings',
      'opsReads.listAcceptedTeacherNamesForSessions',
      'opsReads.listDepartmentSessionsStartingInWindow',
      'organizationsDb.findOrganizationName',
    ])
  })

  it('the renderer stays pure and runtime-neutral (Node and Workers)', () => {
    const code = source('newsletter-render.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(imports(code).sort()).toEqual(['@/lib/datetime', '@/lib/types'])
    expect(code).not.toMatch(/process\.env|Date\.now|new Date\(\)|Buffer|node:|lib\/db/)
  })

  it('file kinds map to PDF/DOCX/PPTX labels with a generic fallback', () => {
    const input = sampleNewsletterInput()
    input.sourceDocuments = [
      { sessionId: SAMPLE_IDS.asthma, mimeType: PDF },
      { sessionId: SAMPLE_IDS.asthma, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { sessionId: SAMPLE_IDS.skin, mimeType: PPTX },
      { sessionId: SAMPLE_IDS.skin, mimeType: 'text/plain' },
    ]
    const { html } = renderNewsletterEmail(input)
    expect(html).toContain('Drawn from 2 teaching files (PDF, DOCX).')
    expect(html).toContain('Drawn from 2 teaching files (PPTX, file).')
  })
})
