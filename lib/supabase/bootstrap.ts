import { createSupabaseServiceClient } from './server'

/** Auth-plane only. Reservation was created by the token-gated setup DAL. */
export async function createBootstrapIdentity(email: string, password: string, name: string, reservation: string) {
  const client = await createSupabaseServiceClient()
  const { data, error } = await client.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name }, app_metadata: { petrios_setup: reservation },
  })
  if (!error && data.user) return data.user.id
  // A crash may have occurred after Auth committed but before the app transaction.
  // Fresh setup permits only this tagged identity; never promote an unrelated account.
  const { data: existing, error: lookupError } = await client.auth.admin.listUsers({ page: 1, perPage: 2 })
  const user = existing?.users.find(u => u.email?.toLowerCase() === email && u.app_metadata?.petrios_setup === reservation)
  if (lookupError || !user || existing.users.length !== 1) throw new Error('Could not create administrator. Check the password policy and retry.')
  return user.id
}
