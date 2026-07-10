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

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

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
    request.nextUrl.pathname.match(/^\/ops\/unsubscribe\/[^/]+$/)
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
