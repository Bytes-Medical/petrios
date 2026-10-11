import { formatInAppTimeZone } from '@/lib/datetime'
import type {
  OpsNewsletterRenderContext,
  OpsNewsletterSessionSection,
} from '@/lib/types'

/**
 * Petrios weekly newsletter email renderer ("Monitor strip" design, spec 06).
 *
 * Pure: no lib/db, no process.env, no clock. Every value (app origin, time
 * zone, names, the draft-time render snapshot) is passed in, so the stored
 * HTML the moderator previews is exactly what the executor later sends, and
 * the module runs unchanged on Node (Docker/self-hosting) and Cloudflare Workers.
 *
 * No images, SVG, data: URIs or web fonts. The ECG trace is the HUD
 * CalibrationStrip path rasterised into table columns for every client except
 * Outlook desktop (Word engine), which gets a flat, wide-cell masthead.
 *
 * Escaping contract: every dynamic string passes through `escapeHtml` (text
 * and attributes); no dynamic value is placed in a style attribute, a CSS
 * block or a comment. `%` is encoded so no dynamic text can ever spell the
 * executor's per-recipient UNSUBSCRIBE_PLACEHOLDER. Link paths accept only
 * UUID ids.
 */

// ------------------------------------------------------------------ tokens
// lib/hud-tokens.ts HUD_DAY / HUD_NIGHT (trace = the site's phosphor clay).
const C = {
  bg: '#F0EEE6', surface: '#FAF9F5', sunk: '#F5F4EF', ink: '#1F1D1A', graphite: '#5D5749',
  caption: '#6D6759', clay: '#A95134', onClay: '#FAF9F5', wash: '#FBF3EF', hair: '#CBC6BA',
  term: '#1F1D1A', termInk: '#F0EEE6', termDim: '#A8A292', termPrompt: '#DF9377',
  trace: '#D97757', termHair: '#4A453D',
} as const
const N = {
  bg: '#1F1D1A', surface: '#282520', sunk: '#211E19', ink: '#F0EEE6', graphite: '#CBC6BA',
  caption: '#A8A292', clay: '#DF9377', fill: '#D97757', hair: '#4A453D', edge: '#A8A292',
  mon: '#141210', wash: '#413028',
} as const
const MONO = "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace"
const SERIF = "Georgia,'Times New Roman',Times,serif"
const P = 'role="presentation" cellpadding="0" cellspacing="0"'

/** Layout tiers: full cards up to 6 sessions, compact rows (overview, no key
 *  points) up to 20, then index rows (title + teachers). A tier that still
 *  exceeds the byte budget falls through to the next one. */
export const NEWSLETTER_FULL_CARD_LIMIT = 6
export const NEWSLETTER_COMPACT_LIMIT = 20
export const NEWSLETTER_HTML_BUDGET_BYTES = 60 * 1024
/** Hard ceiling, below Gmail's ~102 KB clip with headroom for the
 *  per-recipient unsubscribe URLs: past it, the index tier lists only as many
 *  sessions as fit, then "+N more sessions this week in Petrios", so the
 *  footer and unsubscribe link are never clipped. */
export const NEWSLETTER_HTML_HARD_LIMIT_BYTES = 96 * 1024
/** Index tier only: titles and teacher lists are shortened (the full values
 *  stay in the text part and in Petrios). */
export const NEWSLETTER_INDEX_TITLE_MAX = 90
export const NEWSLETTER_INDEX_TEACHERS_MAX = 2
export type NewsletterLayout = 'full' | 'compact' | 'index'
const LAYOUTS: readonly NewsletterLayout[] = ['full', 'compact', 'index']
/** Upcoming board shows at most this many rows (+ "n more in Petrios"). */
export const NEWSLETTER_UPCOMING_LIMIT = 6
/** Replaced per-recipient by the executor with a signed unsubscribe URL. */
export const UNSUBSCRIBE_PLACEHOLDER = '%%UNSUBSCRIBE_URL%%'

export interface NewsletterRenderSourceDocument {
  sessionId: string
  mimeType: string
}

export interface NewsletterRenderInput {
  /** Public app origin (getAppUrl()); links are built only from it + UUIDs. */
  appUrl: string
  /** IANA zone (appTimeZone()); the renderer never uses the server clock's zone. */
  timeZone: string
  organizationName: string
  departmentName: string
  departmentId: string
  /** issue.week_start, 'YYYY-MM-DD' (UTC Monday). */
  weekStartKey: string
  content: {
    subject: string
    intro: string
    sessions: OpsNewsletterSessionSection[]
    closing: string
  }
  /** issue.source_documents (only sessionId + mimeType are read). */
  sourceDocuments: NewsletterRenderSourceDocument[]
  /** The draft-time snapshot stored at content.render. */
  render: OpsNewsletterRenderContext
}

export interface NewsletterRenderOutput {
  html: string
  text: string
  layout: NewsletterLayout
}

// ------------------------------------------------------------------ escaping
/** HTML text/attribute escape for AI-, moderator- and DB-derived strings.
 *  `%` is also encoded so no dynamic text can ever spell the executor's
 *  per-recipient %%UNSUBSCRIBE_URL%% placeholder. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/%/g, '&#37;')
}
const esc = escapeHtml

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function link(appUrl: string, path: string, ...ids: string[]): string {
  for (const id of ids) if (!UUID.test(id)) throw new Error('newsletter link id must be a UUID')
  return esc(`${appUrl.replace(/\/+$/, '')}${path}`)
}

// ------------------------------------------------------------------ dates (APP_TIME_ZONE)
const part = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
  formatInAppTimeZone(iso, { ...opts, timeZone: tz })
const up = (s: string) => s.toUpperCase().replace('.', '')
// Fixed three-letter months: en-GB ICU spells September "Sept", which would
// break the three-letter date tabs and range labels.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const mon = (iso: string, tz: string) => MONTHS[Number(part(iso, tz, { month: 'numeric' })) - 1]
const MON = (iso: string, tz: string) => mon(iso, tz).toUpperCase()
function tab(iso: string, tz: string) {
  return {
    day: part(iso, tz, { day: '2-digit' }),
    weekday: up(part(iso, tz, { weekday: 'short' })),
    month: MON(iso, tz),
    dayShort: `${up(part(iso, tz, { weekday: 'short' }))} ${part(iso, tz, { day: 'numeric' })}`,
  }
}
const hm = (iso: string, tz: string) => part(iso, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const timeRange = (a: string, b: string, tz: string) => `${hm(a, tz)}–${hm(b, tz)}`
const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000))
function rangeLabel(startIso: string, endIsoExclusive: string, tz: string): string {
  const last = new Date(Date.parse(endIsoExclusive) - 1).toISOString()
  const [d1, m1] = [part(startIso, tz, { day: 'numeric' }), MON(startIso, tz)]
  const [d2, m2] = [part(last, tz, { day: 'numeric' }), MON(last, tz)]
  return m1 === m2 ? `${d1}–${d2} ${m1}` : `${d1} ${m1}–${d2} ${m2}`
}
// Newsletter weeks are UTC Monday–Sunday windows, so the week labels are UTC.
function weekShort(weekStartKey: string): string {
  const d = new Date(`${weekStartKey}T00:00:00.000Z`)
  return `W/C ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()} ${d.getUTCFullYear()}`
}
function weekLong(weekStartKey: string): string {
  return `Week commencing ${formatInAppTimeZone(new Date(`${weekStartKey}T00:00:00.000Z`), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
}
const LOCATION: Record<string, string> = { IN_PERSON: 'In person', HYBRID: 'Hybrid', MS_TEAMS: 'Online', JITSI: 'Petrios Meet' }
const KIND: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
}
function fileSummary(docs: NewsletterRenderSourceDocument[]): string {
  const counts = new Map<string, number>()
  for (const d of docs) { const k = KIND[d.mimeType] ?? 'file'; counts.set(k, (counts.get(k) ?? 0) + 1) }
  const kinds = [...counts].map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(', ')
  return `${docs.length} teaching file${docs.length === 1 ? '' : 's'} (${kinds})`
}
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
/** Shortened to `max` characters (code points) with an ellipsis. */
function clipText(value: string, max: number): string {
  const chars = [...value]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : value
}
/** "A, B +3": the index tier's bounded teacher list. */
function indexTeachers(names: readonly string[]): string {
  return names.length > NEWSLETTER_INDEX_TEACHERS_MAX
    ? `${names.slice(0, NEWSLETTER_INDEX_TEACHERS_MAX).join(', ')} +${names.length - NEWSLETTER_INDEX_TEACHERS_MAX}`
    : joinNames(names)
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const hoursLabel = (mins: number) => { const h = Math.round((mins / 60) * 10) / 10; return Number.isInteger(h) ? String(h) : h.toFixed(1) }

// ------------------------------------------------------------------ type helper
// Mono is inherited from the wrapper; Outlook gets Consolas from the MSO block.
const t = (size: number, lh: number, extra = '') => `font-size:${size}px;line-height:${lh}px;${extra}`
const serif = (size: number, lh: number, extra = '') => `font-family:${SERIF};${t(size, lh, extra)}`

// ------------------------------------------------------------------ ECG trace
// Same geometry as components/hud/CalibrationStrip.tsx:
// "M0 10Q2.5 7 5 10L9 10L10 11L11.25 0L12.5 13L13.5 10L18.5 10Q22.5 4 26.5 10"
const S = 2.5, THICK = 2, COL = 2
const Y = (mm: number) => mm * S + THICK / 2
const BASE_TOP = Math.round(Y(10) - THICK / 2) // 25
const BAND = Math.round(Y(13) + THICK / 2) // 34

type Point = [number, number]
interface Column { w: number; top: number; h: number }

function complexPolyline(): Point[] {
  const pts: Point[] = []
  const seg = (f: (u: number) => Point) => { for (let i = 0; i <= 60; i++) pts.push(f(i / 60)) }
  const quad = (a: Point, b: Point, c: Point) => seg((u) => [(1 - u) ** 2 * a[0] + 2 * (1 - u) * u * b[0] + u * u * c[0], (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * b[1] + u * u * c[1]])
  const line = (a: Point, b: Point) => seg((u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])
  quad([0, 10], [2.5, 7], [5, 10])
  line([5, 10], [9, 10]); line([9, 10], [10, 11]); line([10, 11], [11.25, 0])
  line([11.25, 0], [12.5, 13]); line([12.5, 13], [13.5, 10]); line([13.5, 10], [18.5, 10])
  quad([18.5, 10], [22.5, 4], [26.5, 10])
  return pts.map(([x, y]): Point => [x * S, Y(y)])
}
function yAt(pts: Point[], x: number): number[] {
  const ys: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) {
      ys.push(x1 === x0 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0))
      if (x1 === x0) ys.push(y1)
    }
  }
  return ys
}
let COLUMNS: Column[] | null = null
function complexColumns(): Column[] {
  if (COLUMNS) return COLUMNS
  const pts = complexPolyline()
  const width = Math.round(26.5 * S)
  const cols: Column[] = []
  for (let x = 0, step: number; x < width; x += step) {
    step = x >= 9 * S - 1 && x < 13.6 * S ? 1 : COL
    const x1 = Math.min(x + step, width)
    const ys = [...yAt(pts, x), ...yAt(pts, x1), ...pts.filter(([px]) => px >= x && px <= x1).map(([, py]) => py)]
    const top = Math.max(0, Math.round(Math.min(...ys) - THICK / 2))
    const bottom = Math.round(Math.max(...ys) + THICK / 2)
    cols.push({ w: x1 - x, top, h: Math.max(THICK, bottom - top) })
  }
  const merged: Column[] = []
  for (const col of cols) {
    const last = merged[merged.length - 1]
    if (last && last.top === col.top && last.h === col.h) last.w += col.w
    else merged.push({ ...col })
  }
  return (COLUMNS = merged)
}
const ink = (w: number | '100%', h: number, cls = '') =>
  `<table ${P} width="${w}" style="width:${w === '100%' ? '100%' : w + 'px'};"><tr><td${cls ? ` class="${cls}"` : ''} height="${h}" bgcolor="${C.trace}" style="height:${h}px;background-color:${C.trace};font-size:1px;line-height:${h}px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>`
const word = (w: number) =>
  `<td width="${w}" valign="top" style="${w > 1 ? `width:${w}px;` : ''}padding:0 6px;white-space:nowrap;${t(36, 28, `font-weight:700;letter-spacing:-1px;color:${C.termInk};`)}">PETRIOS</td>`

/** Every client except Outlook desktop: the rasterised P-QRS-T strip. Each
 *  column is a top-padded cell holding one filled div (Outlook never sees it). */
function strip(): string {
  const bar = (h: number, extra = '') => `<div${extra} style="height:${h}px;background-color:${C.trace};${extra ? 'border-radius:4px;' : ''}"></div>`
  const col = ({ w, top, h }: Column) => `<td width="${w}" style="padding-top:${top}px;">${bar(h)}</td>`
  return `<table ${P} width="100%" aria-hidden="true" style="width:100%;height:${BAND}px;font-size:0;line-height:0;"><tr valign="top"><td width="14%" style="padding-top:${BASE_TOP}px;">${bar(THICK)}</td>${col({ w: Math.round(10 * S) + 1, top: 0, h: BASE_TOP + THICK })}${word(1)}${complexColumns().map(col).join('')}<td style="padding-top:${BASE_TOP}px;">${bar(THICK)}</td><td width="8" style="padding-top:${BASE_TOP - 3}px;">${bar(8, ' class="wh"')}</td><td width="14"></td></tr></table>`
}
/** Outlook desktop (Word engine): wide cells only — baseline, calibration
 *  block, wordmark, baseline, write-head square. No 1–2 px columns. */
function msoStrip(): string {
  const at = (w: number, top: number, h: number) => `<td width="${w}" valign="top" style="width:${w}px;padding-top:${top}px;font-size:1px;line-height:1px;">${ink(w, h)}</td>`
  return `<table ${P} width="600" style="width:600px;height:${BAND}px;"><tr>${at(84, BASE_TOP, THICK)}${at(26, 0, BASE_TOP + THICK)}${word(156)}${at(312, BASE_TOP, THICK)}${at(8, BASE_TOP - 3, 8)}<td width="14" style="width:14px;font-size:1px;">&nbsp;</td></tr></table>`
}

// ------------------------------------------------------------------ blocks
const ghostOpen = (w: number) => `<!--[if mso]><table ${P} width="552"><tr><td width="${w}" valign="top"><![endif]-->`
const ghostNext = (w: number) => `<!--[if mso]></td><td width="${w}" valign="top"><![endif]-->`
const ghostClose = `<!--[if mso]></td></tr></table><![endif]-->`

function readouts(stats: [string, string][]): string {
  const cells = stats.map(([label, value]) => `<div class="r4" style="display:inline-block;width:100%;max-width:137px;vertical-align:top;"><table ${P} width="100%"><tr><td style="padding:0 8px 16px 12px;border-left:1px solid ${C.termHair};"><p style="margin:0;${t(11, 16, `letter-spacing:1px;text-transform:uppercase;color:${C.termPrompt};`)}">${label}</p><p style="margin:4px 0 0;${t(32, 34, `font-weight:700;color:${C.termInk};`)}">${esc(value)}</p></td></tr></table></div>`)
  return `${ghostOpen(138)}${cells.map((c, i) => (i ? ghostNext(138) : '') + c).join('\n')}${ghostClose}`
}

function sectionHead(label: string, right: string): string {
  return `<table ${P} width="100%"><tr><td class="ek" style="padding:0 0 8px;border-bottom:2px solid ${C.ink};"><h2 class="t1" style="margin:0;${t(12, 18, `font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.ink};`)}"><span class="tc" style="color:${C.clay};">&#9632;</span>&nbsp;&nbsp;${label}</h2></td><td align="right" class="t3 ek" style="padding:0 0 8px;border-bottom:2px solid ${C.ink};white-space:nowrap;${t(12, 18, `color:${C.caption};`)}">${right}</td></tr></table>`
}

const chip = (text: string, dashed = false) =>
  `<td class="${dashed ? 't3 hb' : 't1 ek'}" style="padding:1px 7px;border:1px ${dashed ? 'dashed' : 'solid'} ${dashed ? C.caption : C.ink};white-space:nowrap;${t(11, 18, `letter-spacing:1px;text-transform:uppercase;color:${dashed ? C.caption : C.ink};`)}">${text}</td>`
const chipGap = `<td width="6" style="width:6px;font-size:1px;">&nbsp;</td>`

type SessionMeta = OpsNewsletterRenderContext['sessions'][string]
type UpcomingRow = OpsNewsletterRenderContext['upcoming']['sessions'][number]

interface RenderModel {
  appUrl: string
  tz: string
  meta: (id: string) => SessionMeta
  docs: (id: string) => NewsletterRenderSourceDocument[]
}

/** The monitor-style date tab that opens each session. */
function dateTab(meta: SessionMeta, tz: string, index: number, total: number): string {
  const d = tab(meta.dateStart, tz)
  return `<table ${P} width="100%"><tr><td valign="middle"><table ${P}><tr>
<td class="mo" bgcolor="${C.term}" valign="middle" style="background-color:${C.term};padding:5px 8px 5px 10px;${t(24, 28, `font-weight:700;letter-spacing:-1px;color:${C.termInk};`)}">${d.day}</td>
<td class="mo" bgcolor="${C.term}" valign="middle" style="background-color:${C.term};padding:5px 12px 5px 0;"><p style="margin:0;${t(11, 14, `font-weight:700;letter-spacing:1px;color:${C.termPrompt};`)}">${d.weekday} ${d.month}</p><p style="margin:1px 0 0;white-space:nowrap;${t(12, 15, `color:${C.termDim};`)}">${timeRange(meta.dateStart, meta.dateEnd, tz)}</p></td>
</tr></table></td><td align="right" valign="middle" class="t3" style="white-space:nowrap;${t(12, 18, `color:${C.caption};`)}">${String(index + 1).padStart(2, '0')}&nbsp;/&nbsp;${String(total).padStart(2, '0')}</td></tr></table>`
}

function recapBar(href: string, seconds: number, marginTop: number): string {
  const a = (cls: string, style: string, body: string) => `<a class="${cls}" href="${href}" style="text-decoration:none;${style}">${body}</a>`
  return `<table ${P} width="100%" class="ek" style="width:100%;margin-top:${marginTop}px;border:1px solid ${C.ink};"><tr>
<td width="44" align="center" valign="middle" class="bt" bgcolor="${C.clay}" style="width:44px;background-color:${C.clay};">${a('btt', `display:block;${t(16, 48, `color:${C.onClay};`)}`, '&#9656;')}</td>
<td valign="middle" class="cd" bgcolor="${C.surface}" style="background-color:${C.surface};padding:7px 12px;">${a('t1', t(14, 20, `font-weight:700;color:${C.ink};`), 'Listen to the Audio Recap')}<p class="t3" style="margin:1px 0 0;${t(12, 16, `color:${C.caption};`)}">Moderator-approved &middot; plays in Petrios</p></td>
<td align="right" valign="middle" class="cd t1" bgcolor="${C.surface}" style="background-color:${C.surface};padding:0 14px 0 4px;white-space:nowrap;${t(18, 24, `font-weight:700;color:${C.ink};`)}">${mmss(seconds)}</td>
</tr></table>`
}

function provenanceLine(docs: NewsletterRenderSourceDocument[]): string {
  return docs.length
    ? `Drawn from ${fileSummary(docs)}.`
    : 'Drawn from the session description only. No teaching files were uploaded.'
}

function sessionCard(m: RenderModel, s: OpsNewsletterSessionSection, i: number, total: number): string {
  const meta = m.meta(s.session_id)
  const docs = m.docs(s.session_id)
  const href = link(m.appUrl, `/sessions/${s.session_id}`, s.session_id)
  const chips = [chip(esc(LOCATION[meta.locationType] ?? 'Session'))]
  chips.push(docs.length ? chip(`${docs.length} file${docs.length === 1 ? '' : 's'}`) : chip('Description only', true))
  const points = s.learning_points.map((p, j) => `<tr><td width="30" valign="top" style="padding:3px 0 12px;"><table ${P}><tr><td class="tc bc" width="20" height="20" align="center" style="border:1px solid ${C.clay};${t(11, 20, `font-weight:700;color:${C.clay};`)}">${j + 1}</td></tr></table></td><td valign="top" class="t1 sf" style="padding:0 0 12px;${t(16, 25, `color:${C.ink};`)}">${esc(p)}</td></tr>`).join('')
  const pointsLabel = docs.length ? 'Key points' : 'From the session description'
  return `<tr><td class="${i ? 'hl' : ''}" style="padding:${i ? 24 : 20}px 0 24px;${i ? `border-top:1px solid ${C.hair};` : ''}">
${dateTab(meta, m.tz, i, total)}
<h3 class="t1" style="margin:14px 0 0;${t(19, 26, `font-weight:700;color:${C.ink};`)}"><a class="t1" href="${href}" style="color:${C.ink};text-decoration:none;">${esc(s.title)}</a></h3>
${meta.teachers.length ? `<p class="t2" style="margin:6px 0 0;${t(13, 20, `color:${C.graphite};`)}"><span class="t3" style="color:${C.caption};">With</span> ${esc(joinNames(meta.teachers))}</p>` : ''}
<table ${P} style="margin-top:10px;"><tr>${chips.join(chipGap)}</tr></table>
<p class="t2 sf" style="margin:12px 0 0;${serif(16, 26, `color:${C.graphite};`)}">${esc(s.overview)}</p>
${s.learning_points.length ? `<p class="t3" style="margin:16px 0 8px;${t(11, 16, `letter-spacing:1px;text-transform:uppercase;color:${C.caption};`)}">${pointsLabel}</p><table ${P} width="100%" style="font-family:${SERIF};">${points}</table>` : ''}
${meta.recap ? recapBar(link(m.appUrl, `/sessions/${s.session_id}#recap`, s.session_id), meta.recap.durationSeconds, s.learning_points.length ? 4 : 16) : ''}
<p class="t3" style="margin:12px 0 0;${t(12, 18, `color:${C.caption};`)}">${provenanceLine(docs)}</p>
</td></tr>`
}

/** Compact tier (7–20 sessions): date, linked title, overview, teachers and
 *  provenance; key points stay in Petrios. */
function sessionRow(m: RenderModel, s: OpsNewsletterSessionSection, i: number): string {
  const meta = m.meta(s.session_id)
  const docs = m.docs(s.session_id)
  const d = tab(meta.dateStart, m.tz)
  const rule = i ? `border-top:1px solid ${C.hair};` : ''
  return `<tr><td width="76" valign="top" class="hl t1" style="padding:14px 8px 14px 0;${rule}${t(13, 18, `font-weight:700;color:${C.ink};`)}">${d.dayShort}<br><span class="t3" style="font-weight:400;color:${C.caption};">${hm(meta.dateStart, m.tz)}</span></td><td valign="top" class="hl" style="padding:14px 0;${rule}"><a class="t1" href="${link(m.appUrl, `/sessions/${s.session_id}`, s.session_id)}" style="${t(15, 22, `font-weight:700;color:${C.ink};text-decoration:none;`)}">${esc(s.title)}</a><p class="t2 sf" style="margin:4px 0 0;${serif(15, 23, `color:${C.graphite};`)}">${esc(s.overview)}</p><p class="t3" style="margin:4px 0 0;${t(12, 18, `color:${C.caption};`)}">${meta.teachers.length ? `${esc(joinNames(meta.teachers))} &middot; ` : ''}${docs.length ? `${docs.length} file${docs.length === 1 ? '' : 's'}` : 'Description only'}${meta.recap ? ` &middot; Audio Recap ${mmss(meta.recap.durationSeconds)}` : ''}</p></td></tr>`
}

/** Index tier (> 20 sessions, or when compact is still over budget): one
 *  line per session — when, linked title (shortened), at most two teachers. */
function indexRow(m: RenderModel, s: OpsNewsletterSessionSection, i: number): string {
  const meta = m.meta(s.session_id)
  const rule = i ? `border-top:1px solid ${C.hair};` : ''
  return `<tr><td width="92" valign="top" class="hl t2" style="padding:8px 8px 8px 0;${rule}${t(12, 20, `color:${C.graphite};`)}">${tab(meta.dateStart, m.tz).dayShort} ${hm(meta.dateStart, m.tz)}</td><td valign="top" class="hl" style="padding:8px 0;${rule}${t(14, 20)}"><a class="t1" href="${link(m.appUrl, `/sessions/${s.session_id}`, s.session_id)}" style="font-weight:700;color:${C.ink};text-decoration:none;">${esc(clipText(s.title, NEWSLETTER_INDEX_TITLE_MAX))}</a>${meta.teachers.length ? ` <span class="t3" style="font-size:12px;color:${C.caption};">&middot; ${esc(indexTeachers(meta.teachers))}</span>` : ''}</td></tr>`
}

/** Closes an index list cut short by NEWSLETTER_HTML_HARD_LIMIT_BYTES. */
function indexMoreRow(href: string, hidden: number): string {
  return `<tr><td colspan="2" class="hl" style="padding:8px 0;border-top:1px solid ${C.hair};${t(13, 20)}"><a class="tc" href="${href}" style="font-weight:700;color:${C.clay};text-decoration:underline;">+${hidden} more session${hidden === 1 ? '' : 's'} this week in Petrios</a></td></tr>`
}

function upcomingRow(m: RenderModel, r: UpcomingRow, i: number): string {
  const d = tab(r.dateStart, m.tz)
  const rule = i ? `border-top:1px solid ${C.hair};` : ''
  const lightning = minutes(r.dateStart, r.dateEnd) <= 20
    ? `<table ${P} style="margin-top:6px;"><tr><td class="tc bc" style="padding:0 6px;border:1px solid ${C.clay};white-space:nowrap;${t(11, 18, `letter-spacing:1px;text-transform:uppercase;color:${C.clay};`)}">Lightning &middot; ${minutes(r.dateStart, r.dateEnd)} min</td></tr></table>`
    : ''
  const who = [r.teachers.length ? esc(joinNames(r.teachers)) : '', esc(LOCATION[r.locationType] ?? '')].filter(Boolean).join(' &middot; ')
  return `<tr><td width="104" valign="top" class="sk hl bl" bgcolor="${C.sunk}" style="width:104px;padding:12px 10px 12px 12px;background-color:${C.sunk};${rule}"><p class="t1 bi" style="margin:0;${t(14, 20, `font-weight:700;color:${C.ink};`)}">${d.dayShort}</p><p class="t2 bi bt2" style="margin:2px 0 0;white-space:nowrap;${t(12, 16, `color:${C.graphite};`)}">${timeRange(r.dateStart, r.dateEnd, m.tz)}</p></td><td valign="top" class="br hl" style="padding:12px 12px 12px 14px;${rule}"><a class="t1" href="${link(m.appUrl, `/sessions/${r.id}`, r.id)}" style="${t(15, 22, `font-weight:700;color:${C.ink};text-decoration:underline;`)}">${esc(r.title)}</a><p class="t3" style="margin:4px 0 0;${t(12, 18, `color:${C.caption};`)}">${who}</p>${lightning}</td></tr>`
}

// ------------------------------------------------------------------ styles
const css = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
.grid{background-image:linear-gradient(rgba(217,119,87,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(217,119,87,.16) 1px,transparent 1px),linear-gradient(rgba(217,119,87,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(217,119,87,.07) 1px,transparent 1px);background-size:12.5px 12.5px,12.5px 12.5px,2.5px 2.5px,2.5px 2.5px;}
.wh{box-shadow:0 0 0 3px rgba(223,147,119,.22),0 0 14px 2px rgba(223,147,119,.75);}
@media screen and (max-width:599px){
.wrap{padding:12px 8px 28px!important;}
.px{padding-left:16px!important;padding-right:16px!important;}
.r4{max-width:50%!important;}
.h1{font-size:24px!important;line-height:31px!important;}
.bl,.br{display:block!important;width:auto!important;}
.bl{padding:8px 12px!important;}
.br{border-top:0!important;padding:10px 12px 14px!important;}
.bi{display:inline!important;}
.bt2{margin:0 0 0 10px!important;}
}`
// Apple Mail / iOS only: a slow phosphor pulse on the write-head. Isolated so a
// client that rejects @keyframes cannot take the layout block down with it.
const motion = `@media (prefers-reduced-motion:no-preference){.wh{animation:ph 2.4s ease-in-out infinite;}}
@keyframes ph{0%,100%{box-shadow:0 0 0 3px rgba(223,147,119,.18),0 0 8px 1px rgba(223,147,119,.5);}50%{box-shadow:0 0 0 4px rgba(223,147,119,.28),0 0 18px 4px rgba(223,147,119,.85);}}`
const darkRules = (p: string) => `
${p}.pg{background-color:${N.bg}!important;}
${p}.cd{background-color:${N.surface}!important;}
${p}.sk{background-color:${N.sunk}!important;}
${p}.mo{background-color:${N.mon}!important;}
${p}.t1{color:${N.ink}!important;}
${p}.t2{color:${N.graphite}!important;}
${p}.t3{color:${N.caption}!important;}
${p}.tc{color:${N.clay}!important;}
${p}.ek{border-color:${N.edge}!important;}
${p}.hl{border-color:${N.hair}!important;}
${p}.hb{border-color:${N.caption}!important;}
${p}.bc{border-color:${N.clay}!important;}
${p}.bt{background-color:${N.fill}!important;border-color:${N.fill}!important;}
${p}.sh{border-right-color:${N.edge}!important;border-bottom-color:${N.edge}!important;}
${p}.btt{color:${N.bg}!important;}`

// ------------------------------------------------------------------ main
/** UTF-8 byte length; TextEncoder exists on both Node and Workers. */
export function newsletterByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Render the newsletter, trying the tier implied by the session count and
 * stepping down (full → compact → index) toward NEWSLETTER_HTML_BUDGET_BYTES.
 * The index tier is final and may exceed the budget; only if it would pass
 * NEWSLETTER_HTML_HARD_LIMIT_BYTES does it list the most sessions that fit
 * (at least one) plus a "+N more" row. The text part always lists every session.
 */
export function renderNewsletterEmail(input: NewsletterRenderInput): NewsletterRenderOutput {
  const n = input.content.sessions.length
  let start = n > NEWSLETTER_COMPACT_LIMIT ? 2 : n > NEWSLETTER_FULL_CARD_LIMIT ? 1 : 0
  for (;; start += 1) {
    const out = renderNewsletterWithLayout(input, LAYOUTS[start])
    const size = newsletterByteLength(out.html)
    if (size <= NEWSLETTER_HTML_BUDGET_BYTES) return out
    if (start < LAYOUTS.length - 1) continue
    if (size <= NEWSLETTER_HTML_HARD_LIMIT_BYTES || n <= 1) return out
    // Largest row count that fits (rendering is monotonic in rows shown).
    let [lo, hi, best] = [1, n - 1, renderNewsletterWithLayout(input, 'index', 1)]
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const candidate = renderNewsletterWithLayout(input, 'index', mid)
      if (newsletterByteLength(candidate.html) <= NEWSLETTER_HTML_HARD_LIMIT_BYTES) { best = candidate; lo = mid + 1 } else hi = mid - 1
    }
    return best
  }
}

/** `indexRows` (index tier only): list just the first n sessions + "+N more". */
export function renderNewsletterWithLayout(
  input: NewsletterRenderInput,
  layout: NewsletterLayout,
  indexRows?: number
): NewsletterRenderOutput {
  const { content, render } = input
  const tz = input.timeZone
  const m: RenderModel = {
    appUrl: input.appUrl,
    tz,
    meta: (id) => {
      const meta = Object.prototype.hasOwnProperty.call(render.sessions, id) ? render.sessions[id] : undefined
      if (!meta) throw new Error(`newsletter render context is missing session ${id}`)
      return meta
    },
    docs: (id) => input.sourceDocuments.filter((d) => d.sessionId === id),
  }
  const sessions = content.sessions
  const listed = layout === 'index' && indexRows !== undefined
    ? sessions.slice(0, Math.max(1, indexRows))
    : sessions
  const hidden = sessions.length - listed.length
  const metas = sessions.map((s) => m.meta(s.session_id))
  const totalMinutes = metas.reduce((sum, x) => sum + minutes(x.dateStart, x.dateEnd), 0)
  // Same person across sessions counts once, whatever the capitalisation.
  const teacherCount = new Set(metas.flatMap((x) => x.teachers.map((name) => name.toLocaleLowerCase('en-GB')))).size
  const stats: [string, string][] = [
    ['Sessions', String(sessions.length)],
    ['Hours', hoursLabel(totalMinutes)],
    ['Files', String(input.sourceDocuments.length)],
    ['Teachers', String(teacherCount)],
  ]
  const upcoming = render.upcoming
  const upRows = upcoming.sessions.slice(0, NEWSLETTER_UPCOMING_LIMIT)
  const upMore = upcoming.sessions.length - upRows.length + (upcoming.more ?? 0)
  const next = upRows[0]
  const compact = layout !== 'full'
  const deptSessions = link(m.appUrl, `/departments/${input.departmentId}/sessions`, input.departmentId)
  const deptPast = link(m.appUrl, `/departments/${input.departmentId}/sessions/past`, input.departmentId)
  const coordinators = render.coordinators.filter(Boolean)
  const preheader = [
    `${sessions.length} session${sessions.length === 1 ? '' : 's'} this week: ${sessions.map((s) => s.title).join(' · ')}.`,
    upRows.length ? ` Plus ${upRows.length + upMore} coming up.` : '',
  ].join('')
  const pre = preheader.length > 150 ? `${preheader.slice(0, 147).trimEnd()}…` : preheader
  const weekLabel = weekLong(input.weekStartKey)

  const body = `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(pre)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(content.subject)}" lang="en-GB" dir="ltr" style="font-family:${MONO};">
<table ${P} width="100%" class="pg" bgcolor="${C.bg}" style="width:100%;background-color:${C.bg};font-family:${MONO};">
<tr><td align="center" class="wrap" style="padding:24px 0 40px;">
<!--[if mso]><table ${P} width="600" align="center"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;text-align:left;">
<table ${P} width="100%" class="cd ek" bgcolor="${C.surface}" style="width:100%;background-color:${C.surface};border:1px solid ${C.ink};">

<!-- MONITOR -->
<tr><td class="mo" bgcolor="${C.term}" style="background-color:${C.term};">
<table ${P} width="100%">
<tr><td class="px" style="padding:14px 24px 0;"><p style="margin:0;padding:0 0 12px;border-bottom:1px solid ${C.termHair};${t(12, 18, `font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.termInk};`)}">${esc(input.departmentName)}</p></td></tr>
<tr><td class="grid" style="padding:26px 0 0;">
<!--[if !mso]><!-->${strip()}<!--<![endif]-->
<!--[if mso]>${msoStrip()}<![endif]-->
<table ${P} width="100%"><tr><td class="px" style="padding:10px 24px 14px;"><table ${P} width="100%"><tr>
<td style="white-space:nowrap;${t(11, 16, `letter-spacing:1px;color:${C.termPrompt};`)}">${weekShort(input.weekStartKey)}</td>
<td align="right" style="white-space:nowrap;${t(11, 16, `color:${C.termDim};`)}">50&nbsp;mm/s&nbsp;&nbsp;10&nbsp;mm/mV</td>
</tr></table></td></tr></table>
</td></tr>
<tr><td class="px" style="padding:18px 24px 4px;border-top:1px solid ${C.termHair};font-size:0;">
${readouts(stats)}
</td></tr>
</table>
</td></tr>

<!-- TITLE -->
<tr><td class="px" style="padding:28px 24px 4px;">
<p class="tc" style="margin:0;${t(12, 18, `font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.clay};`)}">Weekly teaching digest</p>
<h1 class="t1 h1" style="margin:8px 0 0;${t(28, 35, `font-weight:700;letter-spacing:-0.5px;color:${C.ink};`)}">${esc(content.subject)}</h1>
<p class="t3" style="margin:8px 0 0;${t(12, 18, `color:${C.caption};`)}">${weekLabel} &middot; ${esc(input.organizationName)}</p>
<p class="t2 sf" style="margin:16px 0 0;${serif(17, 27, `color:${C.graphite};`)}">${esc(content.intro)}</p>
</td></tr>

<!-- THIS WEEK -->
<tr><td class="px" style="padding:28px 24px 0;">
${sectionHead('This week&#39;s teaching', `${sessions.length} session${sessions.length === 1 ? '' : 's'}`)}
<table ${P} width="100%">${listed.map((s, i) => layout === 'full' ? sessionCard(m, s, i, sessions.length) : layout === 'compact' ? sessionRow(m, s, i) : indexRow(m, s, i)).join('\n')}${hidden ? `\n${indexMoreRow(deptPast, hidden)}` : ''}</table>
${compact ? `<p class="t3" style="margin:0 0 20px;${t(12, 18, `color:${C.caption};`)}">${layout === 'compact' ? 'A big week: overviews are here, and each session&#39;s key points are in Petrios.' : 'A big week: each session&#39;s overview and key points are in Petrios.'}</p>` : ''}
</td></tr>
${upRows.length ? `
<!-- COMING UP -->
<tr><td class="px" style="padding:8px 24px 0;">
${sectionHead('Coming up', rangeLabel(upcoming.startIso, upcoming.endIso, tz))}
<table ${P} width="100%" class="ek" style="width:100%;margin-top:14px;border:1px solid ${C.ink};">${upRows.map((r, i) => upcomingRow(m, r, i)).join('\n')}</table>
<p class="t3" style="margin:10px 0 0;${t(12, 18, `color:${C.caption};`)}">${upMore > 0 ? `+${upMore} more in Petrios. ` : ''}Times can change. Petrios always has the latest.</p>
<p style="margin:8px 0 0;${t(13, 20)}"><a class="tc" href="${deptSessions}" style="color:${C.clay};font-weight:700;text-decoration:underline;">See all upcoming teaching&nbsp;&#9656;</a></p>
</td></tr>` : ''}

<!-- CLOSING -->
<tr><td class="px" style="padding:28px 24px 28px;">
<table ${P} width="100%"><tr><td class="sk bc" bgcolor="${C.sunk}" style="padding:16px 18px;background-color:${C.sunk};border-left:3px solid ${C.clay};">
<p class="t1 sf" style="margin:0;${serif(17, 27, `font-style:italic;color:${C.ink};`)}">${esc(content.closing)}</p>
${next ? `<p class="t2" style="margin:12px 0 0;${t(13, 20, `color:${C.graphite};`)}"><span class="tc" style="font-weight:700;color:${C.clay};">Next on the board:</span> ${esc(next.title)}, ${part(next.dateStart, tz, { weekday: 'short' })} ${part(next.dateStart, tz, { day: 'numeric' })} ${mon(next.dateStart, tz)} at ${hm(next.dateStart, tz)}${next.teachers.length ? ` with ${esc(joinNames(next.teachers))}` : ''}.</p>` : ''}
${coordinators.length ? `<p class="t3" style="margin:10px 0 0;${t(12, 18, `color:${C.caption};`)}">${esc(joinNames(coordinators))} &middot; Teaching coordinator${coordinators.length === 1 ? '' : 's'}</p>` : ''}
</td></tr></table>
<table ${P} style="margin-top:24px;"><tr><td class="bt sh" bgcolor="${C.clay}" style="background-color:${C.clay};border-right:3px solid ${C.ink};border-bottom:3px solid ${C.ink};mso-padding-alt:14px 22px;"><a class="btt" href="${deptPast}" style="display:inline-block;padding:14px 22px;${t(15, 20, `font-weight:700;color:${C.onClay};text-decoration:none;`)}">Open this week in Petrios&nbsp;&rarr;</a></td></tr></table>
</td></tr>

</table>

<!-- FOOTER -->
<table ${P} width="100%"><tr><td class="px" style="padding:20px 24px 0;">
<p class="t1" style="margin:0;${t(12, 18, `font-weight:700;color:${C.ink};`)}"><span class="tc" style="color:${C.clay};">&#9632;</span>&nbsp;How this digest is made</p>
<p class="t3" style="margin:6px 0 0;${t(12, 18, `color:${C.caption};`)}">Petrios drafted it from this week&#39;s published sessions and the teaching files uploaded to them. A department moderator edited and approved it before it was sent. It summarises teaching only: it contains no attendance, feedback or assessment data, and it does not replace local or national guidelines.</p>
<p class="t3" style="margin:12px 0 0;${t(12, 18, `color:${C.caption};`)}">You&#39;re receiving this as a member of ${esc(input.departmentName)} on Petrios, ${esc(input.organizationName)}.</p>
<p style="margin:12px 0 0;${t(12, 18)}"><a class="t3" href="${UNSUBSCRIBE_PLACEHOLDER}" style="color:${C.caption};text-decoration:underline;">Unsubscribe from this digest</a></p>
</td></tr></table>
</div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</div>`

  const html = `<!DOCTYPE html>
<html lang="en-GB" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table,td,p,a,span,h1,h2,h3{font-family:Consolas,'Courier New',monospace!important;mso-line-height-rule:exactly;}.sf,.sf a{font-family:Georgia,'Times New Roman',serif!important;}</style><![endif]-->
<style>${css}
</style>
<style>${motion}</style>
<style>
@media (prefers-color-scheme:dark){${darkRules('')}
}
</style>
<style>${darkRules('[data-ogsc] ').replace(/\[data-ogsc\] (\.[a-z0-9]+)\{/g, '[data-ogsc] $1,[data-ogsb] $1{')}
</style>
</head>
<body class="pg" style="margin:0;padding:0;background-color:${C.bg};">
${body}
</body>
</html>
`
  return { html, layout, text: renderNewsletterText(input, { stats, upRows, upMore, compact, layout, weekLabel, coordinators, m }) }
}

// ------------------------------------------------------------------ plain text
function wrap(text: string, width = 72, indent = ''): string {
  const out: string[] = []
  let line = ''
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + w).trim().length > width - indent.length && line) { out.push(indent + line); line = w }
    else line = line ? `${line} ${w}` : w
  }
  if (line) out.push(indent + line)
  return out.join('\n')
}

interface TextModel {
  stats: [string, string][]
  upRows: UpcomingRow[]
  upMore: number
  compact: boolean
  layout: NewsletterLayout
  weekLabel: string
  coordinators: string[]
  m: RenderModel
}

/** The text/plain part (72 columns). Dynamic text can never spell the
 *  placeholder (`%%` becomes `% %`) and control characters are stripped. */
function renderNewsletterText(input: NewsletterRenderInput, x: TextModel): string {
  const { content } = input
  const tz = input.timeZone
  const rule = '-'.repeat(72)
  const base = input.appUrl.replace(/\/+$/, '')
  const L: string[] = []
  L.push(`PETRIOS · ${input.departmentName.toUpperCase()}`, `${x.weekLabel} · ${input.organizationName}`, '', content.subject.toUpperCase(), '', wrap(content.intro), '')
  L.push(x.stats.map(([k, v]) => `${k} ${v}`).join('  |  '), '', rule, "THIS WEEK'S TEACHING", rule)
  content.sessions.forEach((s, i) => {
    const meta = x.m.meta(s.session_id)
    const docs = x.m.docs(s.session_id)
    const d = tab(meta.dateStart, tz)
    L.push('', `${String(i + 1).padStart(2, '0')}  ${d.weekday} ${Number(d.day)} ${d.month} · ${timeRange(meta.dateStart, meta.dateEnd, tz)} · ${LOCATION[meta.locationType] ?? 'Session'}`)
    L.push(wrap(s.title))
    if (meta.teachers.length) L.push(wrap(`With ${joinNames(meta.teachers)}`))
    if (x.layout !== 'index') L.push('', wrap(s.overview))
    if (!x.compact && s.learning_points.length) {
      L.push('', docs.length ? 'Key points' : 'From the session description')
      s.learning_points.forEach((p, j) => L.push(wrap(`${j + 1}. ${p}`, 72, '    ').replace(/^ {4}/, ' ')))
    }
    if (meta.recap) L.push('', `Audio Recap (moderator-approved, ${mmss(meta.recap.durationSeconds)}): ${base}/sessions/${s.session_id}#recap`)
    L.push('', provenanceLine(docs), `Open: ${base}/sessions/${s.session_id}`)
  })
  if (x.upRows.length) {
    L.push('', rule, `COMING UP · ${rangeLabel(input.render.upcoming.startIso, input.render.upcoming.endIso, tz)}`, rule)
    for (const r of x.upRows) {
      const d = tab(r.dateStart, tz)
      L.push('', `${d.dayShort} ${timeRange(r.dateStart, r.dateEnd, tz)}  ${r.title}`, `    ${[joinNames(r.teachers), LOCATION[r.locationType]].filter(Boolean).join(' · ')}`, `    ${base}/sessions/${r.id}`)
    }
    L.push('', `${x.upMore > 0 ? `+${x.upMore} more in Petrios. ` : ''}Times can change. Petrios always has the latest.`)
  }
  L.push('', rule, '', wrap(content.closing))
  if (x.coordinators.length) L.push(`${joinNames(x.coordinators)} · Teaching coordinator${x.coordinators.length === 1 ? '' : 's'}`)
  L.push('', `Open this week in Petrios: ${base}/departments/${input.departmentId}/sessions/past`, '', rule)
  L.push(wrap("How this digest is made: Petrios drafted it from this week's published sessions and the teaching files uploaded to them. A department moderator edited and approved it before it was sent. It summarises teaching only: it contains no attendance, feedback or assessment data, and it does not replace local or national guidelines."))
  L.push('', wrap(`You're receiving this as a member of ${input.departmentName} on Petrios, ${input.organizationName}.`))
  // Dynamic text can never spell the placeholder; strip control characters.
  const body = L.join('\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').split('%%').join('% %')
  return `${body}\nUnsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}\n`
}

// ------------------------------------------------------------------ preview helpers
/**
 * The tier a stored issue was rendered with, recovered from the stored HTML
 * itself (nothing new is stored). Each tier's session markup carries a
 * structural signature with literal attribute quotes that escaped dynamic
 * text can never produce. Returns null for legacy (pre-design) HTML.
 */
export function newsletterLayoutOf(html: string): NewsletterLayout | null {
  if (!html.includes('aria-roledescription="email"')) return null
  if (html.includes('<td width="92" valign="top" class="hl t2"')) return 'index'
  if (html.includes('<td width="76" valign="top" class="hl t1"')) return 'compact'
  if (html.includes('<h3 class="t1"')) return 'full'
  return null
}

export const NEWSLETTER_LAYOUT_LABELS: Record<NewsletterLayout, string> = {
  full: 'Full cards',
  compact: 'Compact rows (key points in Petrios)',
  index: 'Index (overviews in Petrios)',
}

/** The preview iframe sandbox: popups (links open in a new tab) but never
 *  scripts or same-origin access, so stored HTML cannot run or read cookies. */
export const NEWSLETTER_PREVIEW_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox'

/** Inline style for the preview iframe at a chosen client width. The frame's
 *  1px border sits outside that width (content-box): Tailwind's preflight
 *  makes every element border-box, which would shrink a 600 px viewport to
 *  598 px and trip the email's max-width:599px phone rules. */
export function newsletterPreviewFrameStyle(width: number): {
  width: string
  maxWidth: 'none'
  boxSizing: 'content-box'
} {
  return { width: `${width}px`, maxWidth: 'none', boxSizing: 'content-box' }
}

/** srcDoc for the preview iframe: the exact stored bytes plus a base target
 *  (links open outside the frame) and a hidden frame scrollbar, so a classic
 *  (Windows) scrollbar cannot shrink the 600/375 px viewport and trip the
 *  email's own max-width:599px phone rules. A legacy fragment is unchanged. */
export function newsletterPreviewDocument(html: string): string {
  return html.replace('<head>', '<head><base target="_blank"><style>html{scrollbar-width:none;}</style>')
}
