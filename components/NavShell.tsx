import { Nav } from '@/components/Nav'
import { createSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserId, isSuperAdmin } from '@/lib/auth'

export async function NavShell() {
  const userId = await getCurrentUserId()
  let adminLink: { href: string; label: string } | null = null

  if (userId) {
    if (await isSuperAdmin()) {
      adminLink = { href: '/super-admin', label: 'Super Admin' }
    } else {
      const supabase = await createSupabaseClient()

      const { data: orgAdmin } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'org_admin')
        .maybeSingle()

      if (orgAdmin) {
        adminLink = { href: '/admin', label: 'Admin' }
      } else {
        const { data: deptAdmin } = await supabase
          .from('department_members')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'department_admin')
          .maybeSingle()

        if (deptAdmin) {
          adminLink = { href: '/admin', label: 'Moderator' }
        }
      }
    }
  }

  return <Nav adminLink={adminLink} />
}
