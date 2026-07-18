import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options?: any) {
            supabaseResponse.cookies.set(name, value, {
              ...options,
              sameSite: 'lax' as const,
              httpOnly: options?.httpOnly ?? false,
            })
          },
          remove(name: string, options?: any) {
            supabaseResponse.cookies.set(name, '', {
              ...options,
              sameSite: 'lax' as const,
              httpOnly: options?.httpOnly ?? false,
              maxAge: 0,
            })
          },
        },
    }
  )

  // Signed-in check via LOCAL JWT verification (getClaims: WebCrypto ES256
  // against the project's cached JWKS — no network call), instead of a
  // ~150ms auth.getUser() round trip on every request. Safe because this
  // middleware only decides redirect-to-login vs pass-through: every page
  // re-checks getCurrentUser() (network-verified) and every action runs its
  // require* ladder, with RLS beneath. Known tradeoff: a revoked-but-
  // unexpired token passes HERE for up to its TTL but still gets zero data.
  // getClaims() also refreshes near-expiry sessions via the cookie handlers
  // above, preserving this middleware's session-refresh role.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const user = claimsError || !claimsData?.claims ? null : claimsData.claims

  // Public routes
  const publicRoutes = ['/', '/login', '/trainee-login', '/signup', '/verify', '/join', '/join/callback', '/privacy']
  const isPublicRoute = publicRoutes.some(route =>
    request.nextUrl.pathname === route ||
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/verify/') ||
    request.nextUrl.pathname.startsWith('/join/') ||
    request.nextUrl.pathname.startsWith('/sessions/') && request.nextUrl.pathname.endsWith('/feedback') ||
    request.nextUrl.pathname.match(/^\/sessions\/[^/]+\/teacher-rsvp\/[^/]+$/) ||
    request.nextUrl.pathname.match(/^\/departments\/[^/]+\/feedback$/) ||
    request.nextUrl.pathname.match(/^\/claim\/[^/]+$/) ||
    // Newsletter unsubscribe: must work from an email link without a session.
    request.nextUrl.pathname.match(/^\/ops\/unsubscribe\/[^/]+$/) ||
    // Recall answer page: HMAC capability link from the recall email.
    request.nextUrl.pathname.match(/^\/recall\/[^/]+$/) ||
    // Federation instance identity (public key discovery).
    request.nextUrl.pathname.startsWith('/.well-known/') ||
    // Open-source project pages.
    request.nextUrl.pathname === '/contributors' ||
    request.nextUrl.pathname === '/features' ||
    request.nextUrl.pathname === '/open-source' ||
    request.nextUrl.pathname === '/news' ||
    // SEO surfaces: crawlers must reach these without a session.
    request.nextUrl.pathname === '/robots.txt' ||
    request.nextUrl.pathname === '/sitemap.xml' ||
    request.nextUrl.pathname.startsWith('/opengraph-image')
  )
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')

  if (!user && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
