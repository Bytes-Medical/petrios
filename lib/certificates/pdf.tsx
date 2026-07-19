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
} from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { buildSignatories } from './signatories'

// react-pdf cannot use next/font, so certificates register the same bundled
// IBM Plex Mono family used by the application UI.
const fontDir = path.join(process.cwd(), 'public', 'fonts')

Font.register({
  family: 'IBM Plex Mono',
  fonts: [
    { src: path.join(fontDir, 'IBMPlexMono-Regular.ttf'), fontWeight: 400 },
    { src: path.join(fontDir, 'IBMPlexMono-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(fontDir, 'IBMPlexMono-Bold.ttf'), fontWeight: 700 },
  ],
})

Font.registerHyphenationCallback((word) => [word])

// Canonical Petrios UI tokens from app/globals.css and tailwind.config.ts.
const INK = '#1F1D1A'
const PAPER = '#F0EEE6'
const SURFACE = '#FAF9F5'
const CLAY = '#A95134'
const CLAY_DARK = '#7E3A26'
const MUTED = '#6D6759'
const RULE = '#CBC6BA'

const styles = StyleSheet.create({
  page: {
    width: 841.89,
    height: 595.28,
    minHeight: 595.28,
    maxHeight: 595.28,
    flexShrink: 0,
    backgroundColor: PAPER,
    color: INK,
    fontFamily: 'IBM Plex Mono',
    padding: 26,
  },
  frame: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    border: 2,
    borderColor: INK,
    backgroundColor: SURFACE,
  },
  accentTop: {
    height: 11,
    backgroundColor: CLAY,
  },
  accentLeft: {
    position: 'absolute',
    left: 0,
    top: 11,
    bottom: 0,
    width: 8,
    backgroundColor: CLAY,
  },
  innerRule: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 28,
    bottom: 18,
    border: 0.75,
    borderColor: RULE,
  },
  header: {
    marginTop: 29,
    marginHorizontal: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandBlock: {
    width: 31,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLAY,
  },
  brandInitial: {
    color: SURFACE,
    fontSize: 18,
    fontWeight: 700,
  },
  brandWord: {
    marginLeft: 11,
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: 1.8,
  },
  organization: {
    maxWidth: 330,
    alignItems: 'flex-end',
  },
  organizationName: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: 'right',
  },
  departmentName: {
    marginTop: 4,
    color: MUTED,
    fontSize: 8,
    letterSpacing: 1.2,
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  content: {
    marginTop: 43,
    marginHorizontal: 70,
    alignItems: 'center',
  },
  certificateType: {
    color: CLAY_DARK,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 3.4,
    textTransform: 'uppercase',
  },
  presentedTo: {
    marginTop: 20,
    color: MUTED,
    fontSize: 8,
    letterSpacing: 2.1,
    textTransform: 'uppercase',
  },
  recipientName: {
    marginTop: 8,
    maxWidth: 650,
    fontWeight: 700,
    letterSpacing: -1.1,
    lineHeight: 1.08,
    textAlign: 'center',
  },
  recipientRule: {
    marginTop: 10,
    width: 430,
    height: 1.5,
    backgroundColor: CLAY,
  },
  recognitionLine: {
    marginTop: 16,
    color: MUTED,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  sessionTitle: {
    marginTop: 7,
    maxWidth: 650,
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: 'center',
  },
  sessionDate: {
    marginTop: 9,
    color: CLAY_DARK,
    fontSize: 9,
    fontWeight: 600,
  },
  credentialRow: {
    position: 'absolute',
    left: 39,
    right: 34,
    bottom: 42,
    minHeight: 77,
    borderTop: 1,
    borderTopColor: INK,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  coordinators: {
    flex: 1,
    paddingRight: 24,
  },
  issuer: {
    width: 170,
    borderLeft: 1,
    borderLeftColor: RULE,
    paddingLeft: 22,
    paddingRight: 18,
  },
  approvalLabel: {
    color: MUTED,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  approvalNames: {
    marginTop: 6,
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1.35,
  },
  coordinatorList: {
    marginTop: 6,
  },
  coordinatorName: {
    marginBottom: 3,
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  approvalEmpty: {
    marginTop: 6,
    color: MUTED,
    fontSize: 8,
  },
  qrGroup: {
    width: 72,
    alignItems: 'center',
  },
  qrTile: {
    padding: 4,
    backgroundColor: SURFACE,
    border: 1,
    borderColor: INK,
  },
  qrImage: {
    width: 44,
    height: 44,
  },
  qrLabel: {
    marginTop: 4,
    color: MUTED,
    fontSize: 5.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    left: 39,
    right: 34,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    color: MUTED,
    fontSize: 6,
    letterSpacing: 0.5,
  },
  footerCode: {
    color: INK,
    fontSize: 6,
    fontWeight: 700,
    letterSpacing: 0.8,
  },
})

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
  coordinatorNames?: string[]
  issuerName?: string
  recognitionBasis?: 'LIVE_ATTENDANCE' | 'AUDIO_RECAP_CATCH_UP' | 'TEACHING_ASSIGNMENT'
}

function trim(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value
}

function recipientFontSize(name: string): number {
  if (name.length <= 20) return 39
  if (name.length <= 32) return 34
  if (name.length <= 48) return 29
  return 24
}

const CertificateDocument = ({
  data,
  qrCodeDataUrl,
}: {
  data: CertificateData
  qrCodeDataUrl: string
}) => {
  const isTeacher = data.role === 'Teacher'
  const signatories = buildSignatories({
    coordinatorNames: data.coordinatorNames,
    issuerName: data.issuerName,
  })
  const coordinatorNames = signatories
    .filter((row) => row.label === 'Teaching coordinator')
    .map((row) => row.value)
  const issuer = signatories.find((row) => row.label === 'Issued by')?.value
  const issuerDisplay =
    issuer ||
    (data.issuerName
      ? 'Teaching coordinator listed at left'
      : 'Petrios certificate service')

  return (
    <Document
      title={`${isTeacher ? 'Teaching' : 'Attendance'} certificate - ${data.recipientName}`}
      author="Petrios"
      subject={`Verified teaching record ${data.certificateCode}`}
    >
      <Page size={[841.89, 595.28]} style={styles.page} wrap={false}>
        <View style={styles.frame}>
          <View style={styles.accentTop} />
          <View style={styles.accentLeft} />
          <View style={styles.innerRule} />

          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.brandBlock}>
                <Text style={styles.brandInitial}>P</Text>
              </View>
              <Text style={styles.brandWord}>PETRIOS</Text>
            </View>
            <View style={styles.organization}>
              <Text style={styles.organizationName}>{trim(data.orgName, 52)}</Text>
              <Text style={styles.departmentName}>{trim(data.departmentName, 62)}</Text>
            </View>
          </View>

          <View style={styles.content}>
            <Text style={styles.certificateType}>
              {isTeacher ? 'Certificate of teaching' : 'Certificate of attendance'}
            </Text>
            <Text style={styles.presentedTo}>Presented to</Text>
            <Text
              style={[
                styles.recipientName,
                { fontSize: recipientFontSize(data.recipientName) },
              ]}
            >
              {trim(data.recipientName, 75)}
            </Text>
            <View style={styles.recipientRule} />
            <Text style={styles.recognitionLine}>
              {isTeacher
                ? 'In recognition of delivering the teaching session'
                : data.recognitionBasis === 'AUDIO_RECAP_CATCH_UP'
                  ? 'In recognition of completing the approved Audio Recap catch-up pathway'
                  : 'In recognition of attending the teaching session'}
            </Text>
            <Text style={styles.sessionTitle}>{trim(data.sessionTitle, 110)}</Text>
            <Text style={styles.sessionDate}>{data.sessionDate}</Text>
          </View>

          <View style={styles.credentialRow}>
            <View style={styles.coordinators}>
              <Text style={styles.approvalLabel}>
                {coordinatorNames.length === 1
                  ? 'Teaching coordinator'
                  : 'Teaching coordinators'}
              </Text>
              {coordinatorNames.length > 0 ? (
                <View style={styles.coordinatorList}>
                  {coordinatorNames.map((name) => (
                    <Text key={name} style={styles.coordinatorName}>
                      {name}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.approvalEmpty}>Not specified</Text>
              )}
            </View>

            <View style={styles.issuer}>
              <Text style={styles.approvalLabel}>Issued by</Text>
              <Text style={issuer ? styles.approvalNames : styles.approvalEmpty}>
                {issuerDisplay}
              </Text>
            </View>

            <View style={styles.qrGroup}>
              <View style={styles.qrTile}>
                {/* react-pdf Image has no alt prop; adjacent text names its purpose. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image
                  src={qrCodeDataUrl}
                  style={styles.qrImage}
                />
              </View>
              <Text style={styles.qrLabel}>Scan to verify</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>ISSUED {data.issuedDate.toUpperCase()}</Text>
            <Text style={styles.footerCode}>CERTIFICATE {data.certificateCode}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  const qrCodeDataUrl = await QRCode.toDataURL(data.verifyUrl, {
    width: 240,
    margin: 0,
    color: { dark: INK, light: SURFACE },
  })

  const document = <CertificateDocument data={data} qrCodeDataUrl={qrCodeDataUrl} />
  const blob = await pdf(document).toBlob()
  return Buffer.from(await blob.arrayBuffer())
}
