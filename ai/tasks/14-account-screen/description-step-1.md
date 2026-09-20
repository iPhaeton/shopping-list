Add an Account screen for backlog item 3, "Sign out every device". Move today's sign out there
from the `Lists` header (replacing `SignOutButton`'s header slot with an entry point to the new
screen), and add it alongside a second, separately confirmed action, "Sign out of all devices",
calling `supabase.auth.signOut({ scope: 'global' })` — see the reserved-for-this comment in
`SessionContext.tsx`.
