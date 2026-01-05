'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/client'
import { Button } from './Button'
import type { User } from '@supabase/supabase-js'

interface AdminLink {
  href: string
  label: string
}

interface NavProps {
  adminLink?: AdminLink | null
}

export function Nav({ adminLink }: NavProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
    <nav className="border-b border-black">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <img 
              src="/assets/byte_logo.png" 
              alt="Byte Teaching Logo" 
              className="h-8 sm:h-10 w-auto"
            />
            <span className="font-mono text-lg font-bold hidden sm:inline">
              BYTE TEACHING
            </span>
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <div className="flex gap-4 font-mono text-sm">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <Link href="/departments" className="hover:underline">
                Departments
              </Link>
              <Link href="/certificates" className="hover:underline">
                Certificates
              </Link>
              {adminLink && (
                <Link href={adminLink.href} className="hover:underline">
                  {adminLink.label}
                </Link>
              )}
            </div>
            <div className="flex items-center gap-4 ml-4">
              {!loading && user && (
                <span className="font-mono text-sm text-gray-600 truncate max-w-[150px]">
                  {user.email}
                </span>
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
              <Link 
                href="/dashboard" 
                className="hover:underline py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
              <Link 
                href="/departments" 
                className="hover:underline py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Departments
              </Link>
              <Link 
                href="/certificates" 
                className="hover:underline py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Certificates
              </Link>
              {adminLink && (
                <Link 
                  href={adminLink.href} 
                  className="hover:underline py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {adminLink.label}
                </Link>
              )}
            </div>
            <div className="pt-4 border-t border-gray-300">
              {!loading && user && (
                <p className="font-mono text-sm text-gray-600 mb-3 break-all">
                  {user.email}
                </p>
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
