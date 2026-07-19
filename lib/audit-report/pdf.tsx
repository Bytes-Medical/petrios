import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { AuditSessionRow } from '@/app/actions/audit'

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Courier', fontSize: 9 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#666', marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginTop: 16, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#000', paddingBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ccc', paddingVertical: 4 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', paddingBottom: 4, marginBottom: 2 },
  cell: { flex: 1 },
  cellWide: { flex: 2 },
  cellNarrow: { flex: 0.7 },
  bold: { fontWeight: 'bold' },
  statsRow: { flexDirection: 'row', marginBottom: 12, gap: 16 },
  statBox: { flex: 1, borderWidth: 1, borderColor: '#000', padding: 8 },
  statValue: { fontSize: 14, fontWeight: 'bold' },
  statLabel: { fontSize: 8, color: '#666', marginTop: 2 },
})

interface AuditReportProps {
  departmentNames: string[]
  sessions: AuditSessionRow[]
  dateFrom?: string
  dateTo?: string
}

export function buildAuditReportDocument(props: AuditReportProps) {
  const { departmentNames, sessions, dateFrom, dateTo } = props

  const totalSessions = sessions.length
  const totalPresent = sessions.reduce((s, r) => s + r.attendancePresent, 0)
  const totalAttendees = sessions.reduce((s, r) => s + r.attendanceTotal, 0)
  const avgAttendance = totalAttendees > 0 ? Math.round((totalPresent / totalAttendees) * 100) : 0

  const dateRange = dateFrom || dateTo
    ? `${dateFrom || 'start'} to ${dateTo || 'present'}`
    : 'All time'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Audit & Attendance Report</Text>
        <Text style={styles.subtitle}>
          {departmentNames.join(', ')} — {dateRange}
        </Text>
        <Text style={styles.subtitle}>
          Generated: {new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>

        {/* Summary Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalSessions}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{avgAttendance}%</Text>
            <Text style={styles.statLabel}>Avg Attendance</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalPresent}</Text>
            <Text style={styles.statLabel}>Total Present</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalAttendees}</Text>
            <Text style={styles.statLabel}>Total Expected</Text>
          </View>
        </View>

        {/* Sessions Table */}
        <Text style={styles.sectionTitle}>Session Breakdown</Text>
        <View style={styles.headerRow}>
          <Text style={[styles.cellWide, styles.bold]}>Session</Text>
          <Text style={[styles.cell, styles.bold]}>Date</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Present</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Total</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Rate</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Rating</Text>
        </View>
        {sessions.map((s) => {
          const rate = s.attendanceTotal > 0
            ? Math.round((s.attendancePresent / s.attendanceTotal) * 100)
            : 0
          const date = new Date(s.dateStart).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: '2-digit',
          })
          return (
            <View key={s.id} style={styles.row}>
              <Text style={styles.cellWide}>{s.title}</Text>
              <Text style={styles.cell}>{date}</Text>
              <Text style={styles.cellNarrow}>{s.attendancePresent}</Text>
              <Text style={styles.cellNarrow}>{s.attendanceTotal}</Text>
              <Text style={styles.cellNarrow}>{rate}%</Text>
              <Text style={styles.cellNarrow}>{s.averageRating ?? '—'}</Text>
            </View>
          )
        })}

        {sessions.length === 0 && (
          <Text style={{ color: '#999', marginTop: 8 }}>No sessions in this date range.</Text>
        )}
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Per-member attendance report
// ---------------------------------------------------------------------------

interface MemberReportProps {
  memberName: string
  email: string
  grade: string | null
  departmentNames: string[]
  attended: number
  total: number
  pct: number
  sessions: { title: string; date: string; status: string; source: string | null }[]
}

const SOURCE_LABELS: Record<string, string> = {
  SELF_CHECKIN: 'Self',
  GROUP_CODE: 'Code',
  FEEDBACK: 'Feedback',
  TEACHER: 'Teacher',
  TEAMS: 'Teams',
  RECALL: 'Audio recap catch-up',
  MODERATOR_CONFIRMATION: 'Moderator',
}

export function buildMemberReportDocument(props: MemberReportProps) {
  const { memberName, email, grade, departmentNames, attended, total, pct, sessions } = props

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Attendance Report</Text>
        <Text style={styles.subtitle}>{memberName}</Text>
        <Text style={styles.subtitle}>
          {email}{grade ? ` — ${grade}` : ''}
        </Text>
        <Text style={styles.subtitle}>
          {departmentNames.join(', ')} — Generated: {new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>

        {/* Summary */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{attended}</Text>
            <Text style={styles.statLabel}>Attended</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{total}</Text>
            <Text style={styles.statLabel}>Total Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{pct}%</Text>
            <Text style={styles.statLabel}>Attendance Rate</Text>
          </View>
        </View>

        {/* Session-by-session breakdown */}
        <Text style={styles.sectionTitle}>Session Breakdown</Text>
        <View style={styles.headerRow}>
          <Text style={[styles.cellWide, styles.bold]}>Session</Text>
          <Text style={[styles.cell, styles.bold]}>Date</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Status</Text>
          <Text style={[styles.cellNarrow, styles.bold]}>Source</Text>
        </View>
        {sessions.map((s, i) => {
          const date = new Date(s.date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: '2-digit',
          })
          return (
            <View key={i} style={styles.row}>
              <Text style={styles.cellWide}>{s.title}</Text>
              <Text style={styles.cell}>{date}</Text>
              <Text style={styles.cellNarrow}>{s.status}</Text>
              <Text style={styles.cellNarrow}>{s.source ? SOURCE_LABELS[s.source] || s.source : '—'}</Text>
            </View>
          )
        })}

        {sessions.length === 0 && (
          <Text style={{ color: '#999', marginTop: 8 }}>No sessions found.</Text>
        )}
      </Page>
    </Document>
  )
}
