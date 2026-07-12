import { ImageResponse } from 'next/og'

/** Generated favicon: white P on the clay block — the wordmark, condensed. */
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#C25D3D',
          color: '#ffffff',
          fontSize: 24,
          fontWeight: 700,
          fontFamily: 'monospace',
        }}
      >
        P
      </div>
    ),
    size
  )
}
