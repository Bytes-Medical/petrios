#!/usr/bin/env node
// SYNTHETIC rota exports for tests and the local lab. Never commit a real export.
//
//   node lib/rota/__fixtures__/generate-synthetic.mjs [YYYY-MM-DD anchor] [wide|long]
//
// The anchor is "today" (default: the current UTC date). The WIDE grid covers
// anchor-14 … anchor+56. People (all fictional):
//   T1  nights on anchor-4 … anchor-2 (rest covers anchor-1) and on anchor+2
//   T2  normal day shifts (available)
//   T3  annual leave on anchor-1
//   T4  staff number only (no email column value); multi-code LD/OC on anchor-5
//   T5  normal day shifts (checks in on S4 in the lab)
//   Dr Ghost  not a Petrios user (unmatched)
// Weekends are OFF except anchor-1 and anchor+3 (the lab session days).

const anchor = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const layout = process.argv[3] ?? 'wide'
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error('anchor must be YYYY-MM-DD')

const DAY = 86_400_000
const base = Date.parse(`${anchor}T00:00:00Z`)
const key = (offset) => new Date(base + offset * DAY).toISOString().slice(0, 10)
const ddmmyyyy = (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`
const weekday = (offset) => new Date(base + offset * DAY).getUTCDay()

const people = [
  { staff: '10000001-1', name: 'Tess One', email: 't1.rota@example.test', code: (o) => ([-4, -3, -2, 2].includes(o) ? 'N' : [-1, 0, 3].includes(o) ? '' : 'SD') },
  { staff: '10000002-1', name: 'Theo Two', email: 't2.rota@example.test', code: () => 'SD' },
  { staff: '10000003-1', name: 'Tara Three', email: 't3.rota@example.test', code: (o) => (o === -1 ? 'AL' : 'SD') },
  { staff: '10000004-1', name: 'Tom Four', email: '', code: (o) => (o === -5 ? 'LD/OC' : 'SD') },
  { staff: '10000005-1', name: 'Tia Five', email: 't5.rota@example.test', code: () => 'SD' },
  { staff: '19999999-1', name: 'Dr Ghost', email: 'ghost.rota@example.test', code: (o) => (o % 7 === 0 ? 'ZD' : 'SD') },
]

const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const lines = []
const offsets = Array.from({ length: 71 }, (_, i) => i - 14)
const dayCode = (person, o) => {
  const w = weekday(o)
  const c = person.code(o)
  // Weekends off, except the lab session days (anchor-1 = S1/S4, anchor+3 = S2),
  // which keep their day shift whatever weekday the anchor falls on.
  if ((w === 0 || w === 6) && c === 'SD' && o !== -1 && o !== 3) return 'OFF'
  return c
}

if (layout === 'wide') {
  lines.push(['Staff Number', 'Name', 'Email', ...offsets.map((o) => ddmmyyyy(key(o)))].map(cell).join(','))
  for (const p of people) lines.push([p.staff, p.name, p.email, ...offsets.map((o) => dayCode(p, o))].map(cell).join(','))
} else {
  lines.push(['Assignment', 'Email', 'Full name', 'Duty date', 'Shift', 'Start', 'End'].join(','))
  for (const p of people) {
    for (const o of offsets.slice(0, 28)) {
      const c = dayCode(p, o)
      if (!c) continue
      for (const code of c.split('/')) {
        const times = code === 'N' ? ['20:30', '09:30'] : code === 'SD' ? ['08:00', '17:00'] : ['', '']
        lines.push([p.staff, p.email, p.name, key(o), code, ...times].map(cell).join(','))
      }
    }
  }
}
process.stdout.write('﻿' + lines.join('\r\n') + '\r\n')
