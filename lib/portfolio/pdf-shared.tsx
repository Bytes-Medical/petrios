import path from 'node:path'
import { Font, StyleSheet } from '@react-pdf/renderer'

// Shared A4 document styling for Evidence Engine PDFs (portfolio pack +
// teaching dossier). Same bundled IBM Plex Mono faces as the certificate
// module; registering twice with identical config is a no-op in react-pdf.

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

export const docStyles = StyleSheet.create({
  page: {
    fontFamily: 'IBM Plex Mono',
    fontSize: 9,
    color: '#000000',
    backgroundColor: '#ffffff',
    padding: 36,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 8,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 9, marginTop: 3, color: '#333333' },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 3,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
    paddingVertical: 3,
  },
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingVertical: 3,
    fontWeight: 700,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: '#999999',
    paddingTop: 6,
    fontSize: 7,
    color: '#555555',
  },
})

export function formatPdfDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
