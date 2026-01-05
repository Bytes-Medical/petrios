import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value
        },
        set(name, value, options) {
          supabaseResponse.cookies.set(name, value, {
            ...options,
            sameSite: 'lax' as const,
            httpOnly: options?.httpOnly ?? false,
          })
        },
        remove(name, options) {
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
    error: authError,
  } = await supabase.auth.getUser()

  // Public routes
  const publicRoutes = ['/', '/login', '/signup', '/verify']
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname === route || 
    request.nextUrl.pathname.startsWith('/verify/') ||
    request.nextUrl.pathname.startsWith('/sessions/') && request.nextUrl.pathname.endsWith('/feedback')
  )
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')

  // Log for debugging (remove in production)
  if (request.nextUrl.pathname === '/dashboard') {
    console.log('Middleware check for /dashboard:', {
      hasUser: !!user,
      userEmail: user?.email,
      authError: authError?.message,
      cookies: request.cookies.getAll().map(c => c.name),
    })
  }

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
