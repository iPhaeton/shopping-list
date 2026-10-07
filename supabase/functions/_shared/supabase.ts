import {
  createClient,
  isAuthSessionMissingError,
  type SupabaseClient,
  type User,
} from 'npm:@supabase/supabase-js@2.112.4';

/**
 * The caller, and a client acting as them: the anon key and the caller's own token, so that
 * `auth.uid()` and `session_still_valid()` see exactly what they see when the app calls an RPC
 * itself. A refusal comes back as the `Response` to answer with.
 */
export async function callerOf(
  request: Request
): Promise<{ supabase: SupabaseClient; user: User } | Response> {
  const authorization = request.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(authorization.replace(/^Bearer /, ''));
  if (error || !data.user) return refusedSession(error);
  return { supabase, user: data.user };
}

/**
 * The service role, which bypasses RLS: for `public.apple_tokens` only, which grants nothing to
 * `anon` or `authenticated`. Everything else runs as the caller. The edge runtime injects
 * `SUPABASE_SERVICE_ROLE_KEY` (CLI 2.116.0, and on hosted projects).
 */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GoTrue refuses a token whose session is gone (`session_not_found`, which auth-js turns into an
 * `AuthSessionMissingError`) before `delete_account()` could. Answered in the words
 * `session_still_valid()` raises, so the app's `sessionRevoked` sends it to Sign in as it does when
 * the RPC refuses. Anything else is GoTrue's own answer.
 */
function refusedSession(error: { status?: number; code?: string; message: string } | null) {
  if (isAuthSessionMissingError(error)) {
    return Response.json({ code: '42501', message: 'this device has been signed out' }, { status: 403 });
  }
  return Response.json(
    { code: error?.code ?? 'unauthorized', message: error?.message ?? 'Not signed in.' },
    { status: error?.status ?? 401 }
  );
}
