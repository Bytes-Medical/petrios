import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

/**
 * Site-wide Open Graph / Twitter card image, generated in the house style
 * (IBM Plex Mono, paper background, clay accent, hard borders). Served at
 * /opengraph-image and referenced automatically by the metadata system.
 */

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  const fontDir = path.join(process.cwd(), 'public', 'fonts')
  const [bold, regular] = await Promise.all([
    readFile(path.join(fontDir, 'IBMPlexMono-Bold.ttf')),
    readFile(path.join(fontDir, 'IBMPlexMono-Regular.ttf')),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#F5F4EF',
          padding: 48,
          fontFamily: 'IBM Plex Mono',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#ffffff',
            border: '3px solid #1F1D1A',
            borderTop: '14px solid #C25D3D',
            boxShadow: '16px 16px 0 rgba(31,29,26,0.10)',
          }}
        >
          <div
            style={{
              fontSize: 92,
              fontWeight: 700,
              color: '#1F1D1A',
              letterSpacing: -2,
            }}
          >
            PETRIOS
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 34,
              color: '#46413A',
            }}
          >
            {SITE_TAGLINE}
          </div>
          <div
            style={{
              marginTop: 36,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontSize: 26,
              color: '#7E3A26',
            }}
          >
            <span>Evidence-based</span>
            <span style={{ color: '#C25D3D' }}>▪</span>
            <span>Self-hostable</span>
            <span style={{ color: '#C25D3D' }}>▪</span>
            <span>Open source</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'IBM Plex Mono', data: bold, weight: 700, style: 'normal' },
        { name: 'IBM Plex Mono', data: regular, weight: 400, style: 'normal' },
      ],
    }
  )
}
