import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { clearCachedLists } from '../lib/listCache';
import { signInWithGoogle as runGoogleSignIn } from '../lib/googleSignIn';
import { supabase } from '../lib/supabase';

/**
 * A discriminated union rather than a `session | null` boolean. A biometric unlock would add
 * `{ status: 'locked' }` as one new case that `RootNavigator` switches on, instead of an edit to
 * every place the app asks "is there a session?".
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session };

/**
 * Mutations report failure by returning it rather than throwing, so the calling screen can render
 * the message. Every one of these can fail — this is the app's first async failure surface, and
 * nothing here may fail silently.
 */
export type Result = { error: string | null };

type SessionContextValue = {
  state: AuthState;
  /** Emails a six-digit code, creating the account if the address is new. */
  requestCode: (email: string) => Promise<Result>;
  verifyCode: (email: string, code: string) => Promise<Result>;
  signOut: () => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function stateFor(session: Session | null): AuthState {
  return session ? { status: 'signedIn', session } : { status: 'signedOut' };
}

/**
 * Deliberately plain `useState`. `ListsContext` is the only file under `src/` allowed to call
 * `useReducer`, and `npm run kb:audit` asserts it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    // A session persisted by a previous run is restored here; `onAuthStateChange` then owns every
    // subsequent transition, including the one that follows a successful verifyCode.
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(stateFor(data.session));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(stateFor(session));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const requestCode = useCallback(async (email: string): Promise<Result> => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Sign-in and sign-up are the same path, so there is no separate registration screen.
      options: { shouldCreateUser: true },
    });
    return { error: error?.message ?? null };
  }, []);

  const verifyCode = useCallback(async (email: string, code: string): Promise<Result> => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async (): Promise<Result> => {
    // Signing out has always discarded this account's lists along with the provider; leaving a
    // readable copy of them on the device would quietly change that. The outbox is deliberately
    // *not* cleared — those writes are still owed to the database, and they flush at the next
    // sign-in. The residue is real and intended: unsent item titles stay on disk until they land.
    if (state.status === 'signedIn') await clearCachedLists(state.session.user.id);

    // `scope: 'local'` revokes this device's refresh token and nothing else. supabase-js defaults
    // to 'global', which would revoke every device the account is signed in on — signing out in a
    // browser would eventually sign out the phone too. That belongs behind a deliberate "sign out
    // everywhere" action, not behind this button.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return { error: error?.message ?? null };
  }, [state]);

  // Delegates outright: `../lib/googleSignIn` is the one importer of the native module, same
  // module-boundary shape as `supabase.ts`. Success flows through `onAuthStateChange` above like
  // every other sign-in.
  const signInWithGoogle = useCallback((): Promise<Result> => runGoogleSignIn(), []);

  const value = useMemo(
    () => ({ state, requestCode, verifyCode, signOut, signInWithGoogle }),
    [state, requestCode, verifyCode, signOut, signInWithGoogle]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a <SessionProvider>');
  return value;
}
