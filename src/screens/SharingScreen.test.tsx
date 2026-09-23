import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchLists } from '../lib/listsApi';
import {
  fetchMembers,
  leaveList,
  removeMember,
  searchUsers,
  setMemberRole,
  shareList,
  type Member,
  type UserSuggestion,
} from '../lib/membersApi';
import { subscribeToChanges } from '../lib/listsChannel';
import { fetchProfile } from '../lib/profileApi';
import { supabase } from '../lib/supabase';
import type { SharingScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import { SessionProvider } from '../state/SessionContext';
import type { Role } from '../state/types';
import { SharingScreen } from './SharingScreen';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary, as every list suite does — the provider
 * still reads and writes through it. `src/lib/membersApi.ts` is this screen's own seam: it calls
 * those four directly rather than through the provider, since the roster is not in `State`, it is
 * not cached, and its writes deliberately skip the outbox, so what is worth asserting is which
 * function was called with what — and what the screen does with the answer.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], error: null, truncated: false })),
  fetchItems: jest.fn(async () => ({ items: [], next: null, error: null })),
  fetchItem: jest.fn(async () => ({ item: null, error: null })),
  insertList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  addItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDone: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  renameList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setListDeleted: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDeleted: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

jest.mock('../lib/membersApi', () => ({
  fetchMembers: jest.fn(),
  searchUsers: jest.fn(),
  shareList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setMemberRole: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  removeMember: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  leaveList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

/** The provider opens a realtime channel once it is ready; stubbed so no websocket is involved.
 * The mock is also the handle: it captures `onNudge` (`ListsContext`'s combined onChange/
 * onResubscribe wrapper) so a test can deliver a nudge by hand, the same technique
 * `ListsContext.test.tsx` uses. */
jest.mock('../lib/listsChannel', () => ({ subscribeToChanges: jest.fn() }));

/**
 * The screen now reads `useSession()` too, for the sign-out a revoked-session refusal triggers — so
 * this needs the same `src/lib/supabase.ts` mock the auth suites use, not just `listsApi`.
 */
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  signOut: jest.Mock;
};

/** `SessionContext` imports this at the module boundary; the native module has no jest-safe stand-in. */
jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));

/** `SessionProvider` resolves the account's own name on every sign-in now; unmocked, the real module
 * reaches for the real Supabase client. This screen never reads it directly, so the default value
 * doesn't matter — only that it resolves. */
jest.mock('../lib/profileApi', () => ({ fetchProfile: jest.fn(), setName: jest.fn() }));

/** The signed-in account, matching the `userId` the provider is given below. `name: null` — neither
 * has cleared the name gate yet — so the roster falls back to email, exactly like a pre-migration
 * row; every label below keeps asserting on the email for that reason. */
const ALICE: Member = { userId: 'u1', email: 'alice@example.com', name: null, role: 'owner' };
const BOB: Member = { userId: 'u2', email: 'bob@example.com', name: null, role: 'reader' };

const navigation = { navigate: jest.fn(), popToTop: jest.fn(), setOptions: jest.fn() };

function sharingProps(listId: string) {
  return { navigation, route: { params: { listId } } } as unknown as SharingScreenProps;
}

/** Captured from `subscribeToChanges` in `beforeEach` below — delivers a realtime nudge the way
 * `ListsContext`'s own subscription effect would, `listId` omitted for a resubscribe/malformed
 * payload. */
let nudge: (listId?: string) => void = () => {};

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  jest.mocked(shareList).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(setMemberRole).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(removeMember).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(leaveList).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(fetchMembers).mockResolvedValue({ members: [ALICE, BOB], error: null });
  jest.mocked(fetchProfile).mockResolvedValue({ name: 'Alice', error: null });
  jest.mocked(searchUsers).mockResolvedValue({ users: [], error: null });

  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.signOut.mockResolvedValue({ error: null });

  jest.mocked(subscribeToChanges).mockImplementation((_userId, onChange) => {
    nudge = onChange;
    return () => {};
  });
});

/** What every test renders under: the real session and list providers, over the mocked API seams. */
function withProviders(children: ReactNode) {
  return (
    <SessionProvider>
      <ListsProvider userId="u1" onSessionRevoked={() => {}}>
        {children}
      </ListsProvider>
    </SessionProvider>
  );
}

/** Renders the screen for a list the signed-in account holds `role` on. */
async function renderScreen(role: Role = 'owner') {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role, deletedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

  await render(withProviders(<SharingScreen {...sharingProps('l1')} />));

  // The roster arrives a microtask after the list does.
  await screen.findByText('bob@example.com');
}

/**
 * Types a name, advances `UserAutocomplete`'s 300ms debounce, and taps the suggestion that comes
 * back — now the only way to reach a `selected` state, since typed text alone is no longer enough to
 * invite. Callers must have `jest.useFakeTimers()` active already.
 */
async function pickSuggestion(user: UserSuggestion) {
  jest.mocked(searchUsers).mockResolvedValue({ users: [user], error: null });
  await fireEvent.changeText(screen.getByLabelText('Name'), user.name);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await fireEvent.press(await screen.findByLabelText(`Share with ${user.name}`));
}

it('shows everyone with access, and which one is you', async () => {
  await renderScreen();

  expect(screen.getByText('alice@example.com (you)')).toBeOnTheScreen();
  expect(screen.getByText('bob@example.com')).toBeOnTheScreen();
  expect(fetchMembers).toHaveBeenCalledWith('l1');
});

it("shows a member's name instead of their email once they have one", async () => {
  jest
    .mocked(fetchMembers)
    .mockResolvedValue({ members: [ALICE, { ...BOB, name: 'Bob' }], error: null });
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

  await render(withProviders(<SharingScreen {...sharingProps('l1')} />));

  expect(await screen.findByText('Bob')).toBeOnTheScreen();
  expect(screen.queryByText('bob@example.com')).not.toBeOnTheScreen();
  // Every label built from the member switches to the name too, matching what's now on screen.
  expect(screen.getByLabelText('Remove Bob')).toBeOnTheScreen();
});

it('says the roster is on its way before it arrives', async () => {
  jest.mocked(fetchMembers).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role: 'owner', deletedAt: null, itemsLoaded: false, items: [], nextLive: null, nextBin: null }],
    error: null,
    truncated: false,
  });

  await render(withProviders(<SharingScreen {...sharingProps('l1')} />));

  expect(screen.getByLabelText('Loading who has access')).toBeOnTheScreen();
});

it('falls back to a not-found state for an unknown list', async () => {
  await render(withProviders(<SharingScreen {...sharingProps('does-not-exist')} />));

  expect(screen.getByText('List not found')).toBeOnTheScreen();
});

/**
 * The roster is readable by every member — `list_members_of` is gated on the caller's own
 * membership, not on ownership — so "who else can see my shopping list" is a question a reader gets
 * an answer to. Changing the answer is another matter.
 */
describe('somebody who is not an owner', () => {
  it('sees who has access but is given nothing to change about anybody else', async () => {
    await renderScreen('reader');

    expect(screen.getByText('bob@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Only an owner can change who has access.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Name')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Remove bob@example.com')).not.toBeOnTheScreen();
  });

  it('is offered a way to leave, on their own row only', async () => {
    await renderScreen('reader');

    expect(screen.getByLabelText('Leave list')).toBeOnTheScreen();
    // Bob's row stays plain text — a non-owner cannot act on anyone but themselves.
    expect(screen.queryByLabelText('Leave bob@example.com')).not.toBeOnTheScreen();
  });

  it('does not leave until the confirm step is pressed', async () => {
    await renderScreen('reader');

    await fireEvent.press(screen.getByLabelText('Leave list'));

    expect(leaveList).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm leave list')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Confirm leave list'));
    expect(leaveList).toHaveBeenCalledWith('l1');
  });

  it('cancels out of the confirm step without leaving', async () => {
    await renderScreen('reader');

    await fireEvent.press(screen.getByLabelText('Leave list'));
    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(leaveList).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Leave list')).toBeOnTheScreen();
  });

  it('leaves the screen once the list is left', async () => {
    jest
      .mocked(fetchMembers)
      .mockResolvedValueOnce({ members: [ALICE, BOB], error: null })
      .mockResolvedValueOnce({ members: [BOB], error: null });

    await renderScreen('reader');
    await fireEvent.press(screen.getByLabelText('Leave list'));
    await fireEvent.press(screen.getByLabelText('Confirm leave list'));

    expect(navigation.popToTop).toHaveBeenCalled();
  });

  it('collapses back to the plain button and shows why when leaving is refused', async () => {
    jest
      .mocked(leaveList)
      .mockResolvedValue({ error: 'you are not a member of this list', verdict: 'permanent' });

    await renderScreen('reader');
    await fireEvent.press(screen.getByLabelText('Leave list'));
    await fireEvent.press(screen.getByLabelText('Confirm leave list'));

    expect(await screen.findByText('you are not a member of this list')).toBeOnTheScreen();
    expect(screen.getByLabelText('Leave list')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Confirm leave list')).not.toBeOnTheScreen();
  });

  it('signs out this device instead of showing a refusal for a revoked session, when leaving', async () => {
    jest.mocked(leaveList).mockResolvedValue({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });

    await renderScreen('reader');
    await fireEvent.press(screen.getByLabelText('Leave list'));
    await fireEvent.press(screen.getByLabelText('Confirm leave list'));

    await act(async () => {});
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.queryByText('this device has been signed out')).not.toBeOnTheScreen();
  });
});

describe('an owner', () => {
  it('shares the list with the account and role that were picked', async () => {
    jest.useFakeTimers();
    await renderScreen();

    await pickSuggestion({ userId: 'u3', name: 'Carol' });
    await fireEvent.press(screen.getByLabelText('Share as owner'));
    await fireEvent.press(screen.getByLabelText('Share'));

    expect(shareList).toHaveBeenCalledWith('l1', 'u3', 'owner');
    // The roster is re-read rather than patched in memory: the database is what decides.
    expect(fetchMembers).toHaveBeenCalledTimes(2);
  });

  it('will not share without picking a suggestion', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Share')).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Share'));
    expect(shareList).not.toHaveBeenCalled();
  });

  it('clears the invite field once the share lands', async () => {
    jest.useFakeTimers();
    await renderScreen();

    await pickSuggestion({ userId: 'u3', name: 'Carol' });
    await fireEvent.press(screen.getByLabelText('Share'));

    expect(screen.getByLabelText('Name')).toHaveDisplayValue('');
  });

  it('changes somebody else role', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Set bob@example.com to writer'));

    expect(setMemberRole).toHaveBeenCalledWith('l1', 'u2', 'writer');
  });

  it('removes somebody', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Remove bob@example.com'));

    expect(removeMember).toHaveBeenCalledWith('l1', 'u2');
  });

  /** `leaveList` is a reader/writer's path — an owner still removes themselves the way they already
   * could, through `remove_member`, not the new confirm-step control. */
  it("still uses Remove on their own row, not the reader/writer 'Leave list' control", async () => {
    await renderScreen();

    expect(screen.getByLabelText('Remove alice@example.com')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Leave list')).not.toBeOnTheScreen();
  });
});

// --- When it goes wrong -------------------------------------------------------------------------

/**
 * A search suggestion can go stale between being shown and being tapped: `verdictFor` classifies
 * `P0002` by its SQLSTATE (PostgREST answers it with a 500, and a 500 otherwise means "try again"),
 * because the target account existed a moment ago and no longer does. Picking a name is no longer a
 * typo path the way an unresolved email address once was — a suggestion only ever names a real
 * account at search time.
 */
it('renders the database refusal for a suggestion whose account is gone', async () => {
  jest
    .mocked(shareList)
    .mockResolvedValue({ error: 'that account no longer exists', verdict: 'permanent' });

  jest.useFakeTimers();
  await renderScreen();
  await pickSuggestion({ userId: 'u3', name: 'Carol' });
  await fireEvent.press(screen.getByLabelText('Share'));

  expect(await screen.findByText('that account no longer exists')).toBeOnTheScreen();
  // The name stays in the field, since `run()` never clears it on failure.
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('Carol');
});

/**
 * A membership write can be refused for the same reason a queued write is: this device's own
 * session was revoked elsewhere. It must hand off to sign-out rather than show a roster refusal the
 * screen is about to be replaced anyway.
 */
it('signs out this device instead of showing a refusal for a revoked session', async () => {
  jest.mocked(removeMember).mockResolvedValue({
    error: 'this device has been signed out',
    verdict: 'permanent',
    sessionRevoked: true,
  });

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Remove bob@example.com'));

  await act(async () => {});
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(screen.queryByText('this device has been signed out')).not.toBeOnTheScreen();
});

/** The one screen in the app that cannot work offline, so it says so rather than queueing. */
it('says a connection is needed when the request never arrives', async () => {
  jest
    .mocked(shareList)
    .mockResolvedValue({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

  jest.useFakeTimers();
  await renderScreen();
  await pickSuggestion({ userId: 'u3', name: 'Carol' });
  await fireEvent.press(screen.getByLabelText('Share'));

  expect(
    await screen.findByText('You need a connection to change who has access.')
  ).toBeOnTheScreen();
});

it('disables the controls while a request is in flight', async () => {
  let settle = (_result: { error: string | null; verdict: 'ok' }) => {};
  jest.mocked(removeMember).mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    })
  );

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Remove bob@example.com'));

  expect(screen.getByLabelText('Remove bob@example.com')).toBeDisabled();
  expect(screen.getByLabelText('Set bob@example.com to writer')).toBeDisabled();

  await act(async () => settle({ error: null, verdict: 'ok' }));
});

// --- The last owner ------------------------------------------------------------------------------

/**
 * `keep_last_owner` is a trigger, so it has the final say and its refusal is still rendered when it
 * comes. Disabling the control is the courtesy on top: the same wording, computed from the roster.
 */
describe('the only owner a list has', () => {
  beforeEach(() => {
    jest.mocked(fetchMembers).mockResolvedValue({ members: [ALICE, BOB], error: null });
  });

  it('cannot demote or remove themselves', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Set alice@example.com to reader')).toBeDisabled();
    expect(screen.getByLabelText('Remove alice@example.com')).toBeDisabled();
    expect(screen.getByText('A list must keep at least one owner.')).toBeOnTheScreen();
  });

  it('can still act on everybody else', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Remove bob@example.com')).not.toBeDisabled();
  });

  it('is free to leave once somebody else is an owner too', async () => {
    jest
      .mocked(fetchMembers)
      .mockResolvedValue({ members: [ALICE, { ...BOB, role: 'owner' }], error: null });

    await renderScreen();

    expect(screen.queryByText('A list must keep at least one owner.')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Remove alice@example.com')).not.toBeDisabled();
  });
});

/** Removing yourself is legal while another owner remains — and the list stops being yours to see. */
it('leaves the screen when your own membership is gone', async () => {
  jest
    .mocked(fetchMembers)
    .mockResolvedValueOnce({ members: [ALICE, { ...BOB, role: 'owner' }], error: null })
    .mockResolvedValueOnce({ members: [{ ...BOB, role: 'owner' }], error: null });

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Remove alice@example.com'));

  expect(removeMember).toHaveBeenCalledWith('l1', 'u1');
  expect(navigation.popToTop).toHaveBeenCalled();
});

it('stays put when somebody else is removed', async () => {
  jest
    .mocked(fetchMembers)
    .mockResolvedValueOnce({ members: [ALICE, BOB], error: null })
    .mockResolvedValueOnce({ members: [ALICE], error: null });

  await renderScreen();
  await fireEvent.press(screen.getByLabelText('Remove bob@example.com'));

  expect(navigation.popToTop).not.toHaveBeenCalled();
});

// --- Realtime ------------------------------------------------------------------------------

/**
 * The roster isn't in `ListsContext`'s reducer state, so it doesn't get a live update "for free"
 * the way a list's items do — `ListsContext` exposes `lastNudge` instead, and this screen reacts
 * to it directly with its own `load()`, not through `run()`: nobody here made a write.
 */
it('re-reads the roster when a nudge names this list', async () => {
  await renderScreen();
  expect(fetchMembers).toHaveBeenCalledTimes(1);

  jest
    .mocked(fetchMembers)
    .mockResolvedValueOnce({ members: [ALICE, BOB, { ...BOB, userId: 'u3', email: 'carol@example.com' }], error: null });

  await act(async () => nudge('l1'));

  expect(fetchMembers).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('carol@example.com')).toBeOnTheScreen();
});

it('ignores a nudge naming a different list', async () => {
  await renderScreen();
  expect(fetchMembers).toHaveBeenCalledTimes(1);

  await act(async () => nudge('some-other-list'));

  expect(fetchMembers).toHaveBeenCalledTimes(1);
});

/** No `listId` is a resubscribe or a malformed payload — "not sure what changed," so this list's
 * roster is re-read too, the same call `refreshSoon` answers with `dirty = 'all'`. */
it('re-reads the roster on a nudge naming no particular list', async () => {
  await renderScreen();
  expect(fetchMembers).toHaveBeenCalledTimes(1);

  await act(async () => nudge());

  expect(fetchMembers).toHaveBeenCalledTimes(2);
});
