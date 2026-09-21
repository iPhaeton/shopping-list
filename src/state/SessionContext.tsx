import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clearCachedLists } from '../lib/listCache';
import type { Result as ApiResult } from '../lib/listsApi';
import { clearCachedName, readCachedName, writeCachedName } from '../lib/nameCache';
import { signInWithGoogle as runGoogleSignIn } from '../lib/googleSignIn';
import { fetchProfile, setName as setNameRpc } from '../lib/profileApi';
import { supabase } from '../lib/supabase';

/**
 * A discriminated union rather than a `session | null` boolean, so a further state is one new case
 * switched on (`RootNavigator`) instead of an edit to every place the app asks "is there a session?".
 * `nameRequired` is exactly the extension this shape was built for.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'revoked' }
  /**
   * `name: null` here always means "not yet known", never "confirmed empty" — a confirmed-empty
   * account is `nameRequired` instead. A returning user (a session restored at cold start) starts
   * here with `name: null` and stays here even if the profile fetch that would confirm it fails:
   * offline must never lock a returning user out of their cached lists over a name nobody has
   * actually found missing yet. It self-heals the next time the app cold-starts online.
   */
  | { status: 'signedIn'; session: Session; name: string | null }
  /**
   * The database confirmed this account has no name (`confirmed: true`), or the fetch that would
   * have confirmed one either way failed right after a live, interactive sign-in that just proved
   * this device has connectivity (`confirmed: false`) — a genuine anomaly, so the gate is shown
   * rather than assumed away. Both render `SetNameScreen`; `confirmed: false` gets one retry via
   * `retryName` before the person has to type anything.
   */
  | { status: 'nameRequired'; session: Session; confirmed: boolean };

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
  /** `reason: 'revoked'` marks a sign-out forced by a write refused for a session revoked elsewhere,
   * so `SignInScreen` can say why. Omitted for a sign-out the user chose themselves. */
  signOut: (reason?: 'revoked') => Promise<Result>;
  /** `scope: 'global'` — revokes every device the account is signed in on. */
  signOutEverywhere: () => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
  /**
   * Sets the signed-in account's name — from `SetNameScreen` (the gate) or from `AccountScreen` (an
   * edit); both land the same way. Returns `listsApi`'s richer `Result` (`verdict` +
   * `sessionRevoked`), not this module's plain one: both callers reproduce `SharingScreen.run()`'s
   * pattern themselves — a `sessionRevoked` refusal hands off to `signOut('revoked')`, and a
   * `retryable` one earns its own "you need a connection" sentence. On success, `AuthState` and the
   * on-device cache are updated together before this resolves.
   */
  setName: (name: string) => Promise<ApiResult>;
  /**
   * One retry of the profile fetch, for a `nameRequired` state that arrived `confirmed: false` — a
   * fetch failure right after a live sign-in, not a database-confirmed empty name. `SetNameScreen`
   * calls this once on mount so a person whose account already has a name (signing in on a new
   * device, offline at that exact instant) isn't asked to type one that would silently overwrite it.
   * A no-op outside that one state.
   */
  retryName: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Guards a late-resolving fetch or cache read against clobbering state that no longer belongs to it
 * — a sign-out, or a different account signing in, since the read was started.
 */
function withSameUser(userId: string, next: AuthState) {
  return (prev: AuthState): AuthState => {
    const current =
      prev.status === 'signedIn' || prev.status === 'nameRequired' ? prev.session.user.id : undefined;
    return current === userId ? next : prev;
  };
}

/**
 * The same guard, plus `loading`: the one transition that starts from `loading` rather than from an
 * already-signed-in state — `resolveRestoredSignIn` below, before anything (cache or fetch) has yet
 * said who is signed in as far as this state machine is concerned.
 */
function withSameUserOrLoading(userId: string, next: AuthState) {
  return (prev: AuthState): AuthState => (prev.status === 'loading' ? next : withSameUser(userId, next)(prev));
}

/**
 * Deliberately plain `useState`. `ListsContext` is the only file under `src/` allowed to call
 * `useReducer`, and `npm run kb:audit` asserts it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const mountedRef = useRef(true);

  // `onAuthStateChange`'s listener only ever sees the resulting session, never why it changed — so a
  // reason set just before `signOut('revoked')` calls `supabase.auth.signOut` is bridged across to the
  // listener here, then cleared, rather than threaded through the SDK's own event.
  const signOutReason = useRef<'revoked' | undefined>(undefined);

  // Set once `getSession()` has resolved for the first time. `onAuthStateChange` fires the literal
  // event `'SIGNED_IN'` both for an interactive sign-in and, occasionally, for an ordinary cold-start
  // restore (confirmed against `@supabase/auth-js`'s `GoTrueClient`: `_recoverAndRefresh`, the restore
  // path, broadcasts `'SIGNED_IN'` too) — the event name alone cannot tell them apart. This ref can:
  // before `getSession()` resolves, any `'SIGNED_IN'` belongs to the same restore it is about to
  // report; after, it is a genuine live sign-in. Being wrong here is not a new failure mode — the only
  // way to misclassify is to treat a live sign-in as a restore, which just applies the already-lenient
  // restore fallback once where the stricter one was due, never the reverse.
  const hasResolvedOnce = useRef(false);

  /**
   * Fires once, right after a session appears — from `getSession()` or from the listener.
   *
   * A live sign-in just proved connectivity, so it goes straight to the gate and lets `resolveName`
   * confirm or clear it — nothing here can be mistaken for a returning user reading cached data. A
   * restored session is the opposite: nothing is assumed about it at all before either a cache or a
   * fetch actually backs it up, so it is **not** given a `signedIn` state synchronously here — state
   * stays `loading` (no screens mounted, same as first boot) until `resolveRestoredSignIn` decides.
   * Setting `signedIn` optimistically here, before that, was the bug a real repro caught: a brand
   * new account that had never set a name flashed the full app on every reopen, because "assume set"
   * was being applied to the *pending* case, not only to a *failed-fetch* one — for one tick, then
   * two once the read caught up, the window was often wide enough to see and to act inside.
   */
  function enterSignedIn(session: Session, origin: 'restored' | 'live') {
    if (origin === 'live') {
      setState({ status: 'nameRequired', session, confirmed: false });
      void resolveName(session, 'live');
      return;
    }
    void resolveRestoredSignIn(session);
  }

  function enterSignedOut(reason?: 'revoked') {
    setState({ status: 'signedOut', reason });
  }

  function applyFetchedName(session: Session, name: string | null) {
    const userId = session.user.id;
    setState(
      withSameUser(
        userId,
        name ? { status: 'signedIn', session, name } : { status: 'nameRequired', session, confirmed: true }
      )
    );
    if (name) void writeCachedName(userId, name);
  }

  /**
   * A restored session's whole path: try the cache first (fast, local, the common case for a truly
   * returning user), and only once that comes up empty does a fetch decide — never a guess made
   * before either one has actually answered.
   */
  async function resolveRestoredSignIn(session: Session) {
    const userId = session.user.id;

    const cached = await readCachedName(userId);
    if (!mountedRef.current) return;

    if (cached) {
      setState(withSameUserOrLoading(userId, { status: 'signedIn', session, name: cached }));
      // Still confirmed/refreshed in the background; a failure here just leaves the cached answer
      // standing, exactly like `resolveName`'s own restored-origin failure case below.
      void resolveName(session, 'restored');
      return;
    }

    const { name, error } = await fetchProfile(userId);
    if (!mountedRef.current) return;

    if (error) {
      // The one place this app assumes a name exists with no evidence at all — deliberately, and
      // only here: a returning, already-onboarded account reopening the app offline, on a device
      // that has never cached its name before, must not be locked out of its own cached lists over
      // a name nobody has actually found missing. It self-heals the next time this runs and
      // succeeds, restored or live.
      setState(withSameUserOrLoading(userId, { status: 'signedIn', session, name: null }));
      return;
    }

    setState(
      withSameUserOrLoading(
        userId,
        name ? { status: 'signedIn', session, name } : { status: 'nameRequired', session, confirmed: true }
      )
    );
    if (name) void writeCachedName(userId, name);
  }

  /**
   * A live sign-in's confirmation, and a restored sign-in's background refresh after a cache hit —
   * both already have a `signedIn`/`nameRequired` state on screen, so both are safe to resolve with
   * the plain `withSameUser` guard `applyFetchedName` uses.
   */
  async function resolveName(session: Session, origin: 'restored' | 'live') {
    const { name, error } = await fetchProfile(session.user.id);
    if (!mountedRef.current) return;

    if (error) {
      // A live sign-in just proved connectivity, so a fetch failing right after it is a genuine
      // anomaly — default to the gate. A restored session's background refresh failing just leaves
      // whatever the cache already decided standing; it self-heals on the next successful fetch.
      if (origin === 'live') {
        setState(withSameUser(session.user.id, { status: 'nameRequired', session, confirmed: false }));
      }
      return;
    }

    applyFetchedName(session, name);
  }

  useEffect(() => {
    mountedRef.current = true;

    // A session persisted by a previous run is restored here; `onAuthStateChange` then owns every
    // subsequent transition, including the one that follows a successful verifyCode.
    supabase.auth.getSession().then(({ data }) => {
      hasResolvedOnce.current = true;
      if (!mountedRef.current) return;
      if (data.session) enterSignedIn(data.session, 'restored');
      else enterSignedOut();
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const reason = session ? undefined : signOutReason.current;
      signOutReason.current = undefined;

      if (!session) {
        enterSignedOut(reason);
        return;
      }

      if (event === 'SIGNED_IN') {
        enterSignedIn(session, hasResolvedOnce.current ? 'live' : 'restored');
        return;
      }

      // A token refresh or a metadata update: the same account's session object changed, not a new
      // sign-in. Keep whichever name state is already showing and just refresh the session it carries
      // — every write in the app reads its access token off this object.
      setState((prev) =>
        prev.status === 'signedIn' || prev.status === 'nameRequired' ? { ...prev, session } : prev
      );
    });

    return () => {
      mountedRef.current = false;
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

  const performSignOut = useCallback(
    async (scope: 'local' | 'global', reason?: 'revoked'): Promise<Result> => {
      // Signing out has always discarded this account's lists along with the provider; leaving a
      // readable copy of them, or of its name, on the device would quietly change that. The outbox is
      // deliberately *not* cleared — those writes are still owed to the database, and they flush at
      // the next sign-in. The residue is real and intended: unsent item titles stay on disk until they
      // land. `scope: 'global'` also signs this device out, so the same reasoning applies to it.
      if (state.status === 'signedIn' || state.status === 'nameRequired') {
        await clearCachedLists(state.session.user.id);
        await clearCachedName(state.session.user.id);
      }

      if (reason) signOutReason.current = reason;
      const { error } = await supabase.auth.signOut({ scope });
      return { error: error?.message ?? null };
    },
    [state]
  );

  // `scope: 'local'` revokes this device's refresh token and nothing else. supabase-js defaults to
  // `'global'`, which revokes every device the account is signed in on — signing out in a browser
  // would eventually sign out the phone too, so the plain "Sign out" action pins `'local'` and the
  // Account screen's separately confirmed "Sign out of all devices" is the only path to `'global'`.
  // A write refused for a revoked session is also `'local'`: that device's own credentials are what
  // are stale, and the account may still be validly signed in elsewhere.
  const signOut = useCallback(
    (reason?: 'revoked') => performSignOut('local', reason),
    [performSignOut]
  );
  const signOutEverywhere = useCallback(() => performSignOut('global'), [performSignOut]);

  // Delegates outright: `../lib/googleSignIn` is the one importer of the native module, same
  // module-boundary shape as `supabase.ts`. Success flows through `onAuthStateChange` above like
  // every other sign-in.
  const signInWithGoogle = useCallback((): Promise<Result> => runGoogleSignIn(), []);

  const setName = useCallback(
    async (name: string): Promise<ApiResult> => {
      if (state.status !== 'signedIn' && state.status !== 'nameRequired') {
        return { error: 'Not signed in.', verdict: 'permanent' };
      }
      const { session } = state;
      const result = await setNameRpc(name);
      if (!result.error) {
        const trimmed = name.trim();
        setState(withSameUser(session.user.id, { status: 'signedIn', session, name: trimmed }));
        void writeCachedName(session.user.id, trimmed);
      }
      return result;
    },
    [state]
  );

  const retryName = useCallback(() => {
    if (state.status === 'nameRequired' && !state.confirmed) void resolveName(state.session, 'live');
  }, [state]);

  const value = useMemo(
    () => ({
      state,
      requestCode,
      verifyCode,
      signOut,
      signOutEverywhere,
      signInWithGoogle,
      setName,
      retryName,
    }),
    [state, requestCode, verifyCode, signOut, signOutEverywhere, signInWithGoogle, setName, retryName]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a <SessionProvider>');
  return value;
}
