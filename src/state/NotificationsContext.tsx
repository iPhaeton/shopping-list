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
import { AppState, Platform } from 'react-native';

import { fetchUnreadCount } from '../lib/notificationsApi';
import { useLists } from './ListsContext';

/**
 * A burst of nudges is one read: marking n notifications read sends n of them, one per row (task 28
 * step 1's log), and each would otherwise be a read of its own.
 */
const NUDGE_DEBOUNCE_MS = 300;

type NotificationsContextValue = {
  /** How many notifications are unread — `null` until the first answer, so a cold start offline
   * shows no dot rather than a guess. */
  unread: number | null;
  /** Reads the count again — after the Notifications screen marks a page read, say. */
  refreshUnread: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * The unread count behind the Lists screen's bell. Mounted inside `ListsProvider` (see `App.tsx`),
 * so it lives and dies with the signed-in account, and it hears the database through that provider's
 * one channel (`lastNotificationsNudge`) rather than opening a second.
 *
 * Read on mount, on coming back to the app, and once per burst of nudges. The count is never
 * computed here — not even set to 0 when the screen marks a page read — because the server's answer
 * already includes anything that arrived meanwhile. A failed read keeps the last count: a dot that
 * is a little stale beats one that flickers off whenever the signal drops.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { lastNotificationsNudge } = useLists();
  const [unread, setUnread] = useState<number | null>(null);

  // Only the latest read to start may land: the mount read, a nudge's and the screen's can overlap,
  // and an older answer arriving last would put back a count that is already wrong.
  const latest = useRef(0);
  const live = useRef(true);

  const refreshUnread = useCallback(async () => {
    const mine = ++latest.current;
    const { count } = await fetchUnreadCount();
    if (live.current && mine === latest.current && count !== null) setUnread(count);
  }, []);

  useEffect(() => {
    live.current = true;
    void refreshUnread();
    return () => {
      live.current = false;
    };
  }, [refreshUnread]);

  // Coming back to the app, as `ListsContext` re-reads the lists: the socket may have been down.
  useEffect(() => {
    const resume = () => void refreshUnread();

    if (Platform.OS === 'web') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') resume();
      };

      window.addEventListener('online', resume);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('online', resume);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') resume();
    });
    return () => subscription.remove();
  }, [refreshUnread]);

  // Trailing: each nudge restarts the wait, so a burst ends in one read.
  useEffect(() => {
    if (!lastNotificationsNudge) return;
    const timer = setTimeout(() => void refreshUnread(), NUDGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [lastNotificationsNudge, refreshUnread]);

  const value = useMemo(() => ({ unread, refreshUnread }), [unread, refreshUnread]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications must be used inside a <NotificationsProvider>');
  return value;
}
