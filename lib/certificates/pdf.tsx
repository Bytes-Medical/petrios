import React from 'react'
import path from 'path'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  pdf,
  Image,
  Svg,
  Circle,
  Line,
} from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { buildSignatories } from './signatories'

// ---------------------------------------------------------------------------
// Fonts — IBM Plex Mono (the app face). react-pdf can't use next/font, so we
// register the bundled .ttf weights from /public/fonts. `public/` is reliably
// present on disk at runtime, unlike arbitrary files under lib/.
// ---------------------------------------------------------------------------

const fontDir = path.join(process.cwd(), 'public', 'fonts')

Font.register({
  family: 'IBM Plex Mono',
  fonts: [
    { src: path.join(fontDir, 'IBMPlexMono-Regular.ttf'), fontWeight: 400 },
    { src: path.join(fontDir, 'IBMPlexMono-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(fontDir, 'IBMPlexMono-Bold.ttf'), fontWeight: 700 },
  ],
})

// Monospace: never hyphenate/break a word (keeps codes and names intact).
Font.registerHyphenationCallback((word) => [word])

// ---------------------------------------------------------------------------
// Two-tone system — strict black & white. No colour, by design.
// ---------------------------------------------------------------------------

const INK = '#000000'
const PAPER = '#ffffff'

// ---------------------------------------------------------------------------
// Styles  (252 x 144 pt — a 3.5" x 2" card)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    width: 252,
    height: 144,
    backgroundColor: PAPER,
    fontFamily: 'IBM Plex Mono',
    color: INK,
    padding: 7,
  },

  frame: {
    flex: 1,
    position: 'relative',
    border: 1.5,
    borderColor: INK,
    backgroundColor: PAPER,
    overflow: 'hidden',
  },

  content: {
    flex: 1,
    paddingTop: 6,
    paddingHorizontal: 10,
    paddingBottom: 35, // clear the absolute footer bar
  },

  // --- Masthead ---
  masthead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orgName: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    maxWidth: 150,
  },
  deptName: {
    fontSize: 5,
    fontWeight: 400,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 2,
    maxWidth: 150,
  },
  roleBlock: {
    alignItems: 'flex-end',
  },
  roleChip: {
    backgroundColor: INK,
    color: PAPER,
    fontSize: 5,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  serial: {
    fontSize: 5,
    fontWeight: 400,
    letterSpacing: 0.5,
    marginTop: 3,
  },

  // --- Rule (heavy + hairline, double) ---
  ruleHeavy: {
    height: 2,
    backgroundColor: INK,
    marginTop: 5,
  },
  ruleHair: {
    height: 0.6,
    backgroundColor: INK,
    marginTop: 1.5,
    marginBottom: 5,
  },

  // --- Hero ---
  presentedTo: {
    fontSize: 4.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  recipientName: {
    fontWeight: 700,
    letterSpacing: 0.3,
    maxWidth: 165,
    lineHeight: 1.05,
  },

  // --- Body ---
  forLine: {
    fontSize: 5,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 4,
    maxWidth: 165,
  },
  sessionTitle: {
    fontSize: 6,
    fontWeight: 400,
    marginTop: 2,
    maxWidth: 165,
    lineHeight: 1.25,
  },
  sessionDate: {
    fontSize: 5,
    fontWeight: 600,
    marginTop: 3,
  },

  // --- Stamp seal (the single eccentric mark) ---
  seal: {
    position: 'absolute',
    top: 44,
    right: 12,
    alignItems: 'center',
  },
  sealLabel: {
    fontSize: 3.6,
    fontWeight: 700,
    letterSpacing: 1.6,
    marginTop: 2,
  },

  // --- Footer bar (inverted: white on black) ---
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 31,
    backgroundColor: INK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 10,
    paddingRight: 4,
  },
  footerLeft: {
    flex: 1,
    paddingRight: 6,
    justifyContent: 'center',
  },
  footerSig: {
    color: PAPER,
    fontSize: 4.8,
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  footerSigSub: {
    color: PAPER,
    fontSize: 4.4,
    fontWeight: 400,
    letterSpacing: 0.3,
    marginTop: 1.5,
  },
  footerMeta: {
    color: PAPER,
    fontSize: 4.4,
    fontWeight: 400,
    letterSpacing: 0.3,
    marginTop: 1.5,
  },
  qrTile: {
    backgroundColor: PAPER,
    padding: 2,
  },
  qrImg: {
    width: 18,
    height: 18,
  },
})

// ---------------------------------------------------------------------------
// Data interface  (unchanged — call sites already supply all of this)
// ---------------------------------------------------------------------------

export interface CertificateData {
  orgName: string
  departmentName: string
  sessionTitle: string
  sessionDate: string
  recipientName: string
  role: string
  certificateCode: string
  issuedDate: string
  verifyUrl: string
  leadName?: string
  issuerName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keep long values from overflowing the tiny card. */
const trim = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

/** Scale the hero name down as it gets longer so it never overflows. */
function recipientFontSize(name: string): number {
  const n = name.length
  if (n <= 14) return 16
  if (n <= 20) return 13
  if (n <= 28) return 11
  return 9
}

/** Small square registration / crop mark, à la print proofs. */
const CornerMark = ({
  v,
  h,
}: {
  v: 'top' | 'bottom'
  h: 'left' | 'right'
}) => (
  <View
    style={{
      position: 'absolute',
      [v]: 3,
      [h]: 3,
      width: 7,
      height: 7,
    }}
  >
    <View
      style={{
        position: 'absolute',
        [v]: 0,
        [h]: 0,
        width: 7,
        height: 1,
        backgroundColor: INK,
      }}
    />
    <View
      style={{
        position: 'absolute',
        [v]: 0,
        [h]: 0,
        width: 1,
        height: 7,
        backgroundColor: INK,
      }}
    />
  </View>
)

// ---------------------------------------------------------------------------
// Document component
// ---------------------------------------------------------------------------

const CertificateDocument = ({
  data,
  qrCodeDataUrl,
}: {
  data: CertificateData
  qrCodeDataUrl: string
}) => {
  const isTeacher = data.role === 'Teacher'
  const roleLabel = isTeacher ? 'TEACHER' : 'ATTENDEE'
  const forLabel = isTeacher ? 'For delivering' : 'For attending'
  const serial = data.certificateCode.slice(0, 4).toUpperCase()
  const signatories = buildSignatories(data.leadName, data.issuerName)

  return (
    <Document>
      <Page size={[252, 144]} style={styles.page} wrap={false}>
        <View style={styles.frame}>
          {/* registration marks */}
          <CornerMark v="top" h="left" />
          <CornerMark v="top" h="right" />
          <CornerMark v="bottom" h="left" />
          <CornerMark v="bottom" h="right" />

          {/* stamp seal */}
          <View style={styles.seal}>
            <Svg width={42} height={42}>
              <Circle cx={21} cy={21} r={20} stroke={INK} strokeWidth={1} fill="none" />
              <Circle cx={21} cy={21} r={15.5} stroke={INK} strokeWidth={0.5} fill="none" />
              {/* six-arm asterisk */}
              <Line x1={21} y1={11} x2={21} y2={31} stroke={INK} strokeWidth={1.4} />
              <Line x1={12.3} y1={16} x2={29.7} y2={26} stroke={INK} strokeWidth={1.4} />
              <Line x1={29.7} y1={16} x2={12.3} y2={26} stroke={INK} strokeWidth={1.4} />
            </Svg>
            <Text style={styles.sealLabel}>VERIFIED</Text>
          </View>

          <View style={styles.content}>
            {/* masthead */}
            <View style={styles.masthead}>
              <View>
                <Text style={styles.orgName}>{trim(data.orgName, 26)}</Text>
                <Text style={styles.deptName}>{trim(data.departmentName, 30)}</Text>
              </View>
              <View style={styles.roleBlock}>
                <Text style={styles.roleChip}>{roleLabel}</Text>
                <Text style={styles.serial}>№ {serial}</Text>
              </View>
            </View>

            {/* double rule */}
            <View style={styles.ruleHeavy} />
            <View style={styles.ruleHair} />

            {/* hero */}
            <Text style={styles.presentedTo}>Presented to</Text>
            <Text
              style={[
                styles.recipientName,
                { fontSize: recipientFontSize(data.recipientName) },
              ]}
            >
              {data.recipientName}
            </Text>

            {/* body */}
            <Text style={styles.forLine}>{forLabel} the teaching session</Text>
            <Text style={styles.sessionTitle}>{trim(data.sessionTitle, 78)}</Text>
            <Text style={styles.sessionDate}>{data.sessionDate}</Text>
          </View>

          {/* inverted footer bar: signatories + issue record + QR */}
          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              {signatories.map((s, i) => (
                <Text
                  key={s.label}
                  style={i === 0 ? styles.footerSig : styles.footerSigSub}
                >
                  {s.label.toUpperCase()} · {trim(s.value, 30)}
                </Text>
              ))}
              <Text style={styles.footerMeta}>
                {data.certificateCode} · ISSUED {data.issuedDate}
              </Text>
            </View>
            {qrCodeDataUrl ? (
              <View style={styles.qrTile}>
                <Image src={qrCodeDataUrl} style={styles.qrImg} />
              </View>
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Generate PDF buffer
// ---------------------------------------------------------------------------

export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  const qrCodeDataUrl = await QRCode.toDataURL(data.verifyUrl, {
    width: 160,
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  })

  const doc = <CertificateDocument data={data} qrCodeDataUrl={qrCodeDataUrl} />
  const blob = await pdf(doc).toBlob()
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
