import React from 'react'
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer'
import QRCode from 'qrcode'

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontFamily: 'Helvetica',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 18,
    marginBottom: 40,
    textAlign: 'center',
  },
  text: {
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  label: {
    fontSize: 12,
    marginTop: 30,
    marginBottom: 5,
    textAlign: 'center',
    color: '#666',
  },
  code: {
    fontSize: 10,
    marginTop: 20,
    textAlign: 'center',
    color: '#999',
  },
  qrCode: {
    width: 100,
    height: 100,
    marginTop: 20,
    alignSelf: 'center',
  },
  divider: {
    borderBottom: '1 solid #000',
    marginVertical: 20,
    width: '100%',
  },
})

interface CertificateData {
  orgName: string
  departmentName: string
  sessionTitle: string
  sessionDate: string
  recipientName: string
  role: string
  certificateCode: string
  issuedDate: string
  verifyUrl: string
}

const CertificateDocument = ({ data, qrCodeDataUrl }: { data: CertificateData; qrCodeDataUrl: string }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.title}>CERTIFICATE OF PARTICIPATION</Text>
        <View style={styles.divider} />
        <Text style={styles.subtitle}>This is to certify that</Text>
        <Text style={styles.text}>{data.recipientName}</Text>
        <Text style={styles.text}>has {data.role === 'Teacher' ? 'delivered' : 'attended'}</Text>
        <Text style={styles.text}>{data.sessionTitle}</Text>
        <Text style={styles.text}>on {data.sessionDate}</Text>
        <Text style={styles.label}>Organization: {data.orgName}</Text>
        <Text style={styles.label}>Department: {data.departmentName}</Text>
        <Text style={styles.label}>Issued: {data.issuedDate}</Text>
        <Text style={styles.code}>Certificate ID: {data.certificateCode}</Text>
        {qrCodeDataUrl && (
          <Image src={qrCodeDataUrl} style={styles.qrCode} />
        )}
      </View>
    </Page>
  </Document>
)

export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  // Generate QR code
  const qrCodeDataUrl = await QRCode.toDataURL(data.verifyUrl, {
    width: 200,
    margin: 2,
  })

  const doc = <CertificateDocument data={data} qrCodeDataUrl={qrCodeDataUrl} />
  const blob = await pdf(doc).toBlob()
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
