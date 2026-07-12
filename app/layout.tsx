import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import { ToastProvider } from '@/components/ToastProvider'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site'
import './globals.css'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'Petrios',
    'NHS teaching platform',
    'clinical education software',
    'medical education platform',
    'teaching attendance tracking',
    'ARCP portfolio evidence',
    'postgraduate medical education',
    'open source LMS alternative',
    'self-hosted teaching management',
    'teaching programme management',
    'departmental teaching NHS',
  ],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_GB',
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  // Google Search Console ownership: set GOOGLE_SITE_VERIFICATION to the
  // token from the "HTML tag" verification method (content="..." value).
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${plexMono.variable} font-mono`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
