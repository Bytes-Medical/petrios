'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/client'
import { Button } from './Button'
import type { User } from '@supabase/supabase-js'

interface AdminLink {
  href: string
  label: string
}

interface NavProps {
  adminLink?: AdminLink | null
  roleLabel?: string | null
  isSuperAdmin?: boolean
  isPersonal?: boolean
}

export function Nav({ adminLink, roleLabel, isSuperAdmin: superAdmin, isPersonal }: NavProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navLinks = superAdmin
    ? [{ href: '/super-admin', label: 'Super Admin' }]
    : isPersonal
      ? // Individual account: enterprise tools (Audit, Settings, Admin) don't apply.
        [{ href: '/dashboard', label: 'Dashboard' }]
      : [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/audit', label: 'Audit' },
          { href: '/settings', label: 'Settings' },
          ...(adminLink ? [adminLink] : []),
        ]

  function getNavLinkClass(href: string) {
    const isActive = pathname === href || pathname.startsWith(`${href}/`)
    return isActive
      ? 'underline underline-offset-4 decoration-clay-600 decoration-2'
      : 'hover:underline hover:underline-offset-4'
  }

  useEffect(() => {
    async function fetchUser() {
      const supabase = createSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    fetchUser()

    // Listen for auth changes
    const supabase = createSupabaseClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function handleSignOut() {
    const supabase = createSupabaseClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="border-b border-black bg-white">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard">
            <img
              src="/assets/byte_logo.png"
              alt="Byte Teaching"
              className="h-10 sm:h-12 w-auto mix-blend-multiply"
            />
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-3 font-mono text-sm">
              {navLinks.map((link, index) => (
                <Fragment key={link.href}>
                  {index > 0 ? <span className="text-gray-400">|</span> : null}
                  <Link href={link.href} className={getNavLinkClass(link.href)}>
                    {link.label}
                  </Link>
                </Fragment>
              ))}
            </div>
            <div className="flex items-center gap-4 ml-4">
              {!loading && user && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-600 truncate max-w-[150px]">
                    {user.email}
                  </span>
                  {roleLabel && (
                    <span className="font-mono text-xs border border-clay-600 bg-clay-50 text-clay-800 px-2 py-0.5 whitespace-nowrap">
                      {roleLabel}
                    </span>
                  )}
                </div>
              )}
              <Button variant="secondary" onClick={handleSignOut}>
                Sign Out
              </Button>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 border border-black"
            aria-label="Toggle menu"
          >
            <span className="font-mono text-sm">{mobileMenuOpen ? '✕' : '☰'}</span>
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-4 pt-4 border-t border-black space-y-4">
            <div className="flex flex-col gap-2 font-mono text-sm">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${getNavLinkClass(link.href)} py-2`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="pt-4 border-t border-gray-300">
              {!loading && user && (
                <div className="mb-3">
                  <p className="font-mono text-sm text-gray-600 break-all">
                    {user.email}
                  </p>
                  {roleLabel && (
                    <span className="inline-block font-mono text-xs border border-clay-600 bg-clay-50 text-clay-800 px-2 py-0.5 mt-1">
                      {roleLabel}
                    </span>
                  )}
                </div>
              )}
              <Button variant="secondary" onClick={handleSignOut} className="w-full">
                Sign Out
              </Button>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
