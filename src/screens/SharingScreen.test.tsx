import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import {
  fetchLists,
  fetchMembers,
  removeMember,
  setMemberRole,
  shareList,
  type Member,
} from '../lib/listsApi';
import type { SharingScreenProps } from '../navigation/types';
import { ListsProvider } from '../state/ListsContext';
import type { Role } from '../state/types';
import { SharingScreen } from './SharingScreen';

/**
 * `src/lib/listsApi.ts` is mocked at the module boundary, as every list suite does. This screen is
 * the one that calls it directly rather than through the provider: the roster is not in `State`, it
 * is not cached, and its writes deliberately skip the outbox, so what is worth asserting is which
 * function was called with what — and what the screen does with the answer.
 */
jest.mock('../lib/listsApi', () => ({
  fetchLists: jest.fn(async () => ({ lists: [], error: null })),
  insertList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  insertItem: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setItemDone: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  updateListName: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  fetchMembers: jest.fn(),
  shareList: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  setMemberRole: jest.fn(async () => ({ error: null, verdict: 'ok' })),
  removeMember: jest.fn(async () => ({ error: null, verdict: 'ok' })),
}));

/** The signed-in account, matching the `userId` the provider is given below. */
const ALICE: Member = { userId: 'u1', email: 'alice@example.com', role: 'owner' };
const BOB: Member = { userId: 'u2', email: 'bob@example.com', role: 'reader' };

const navigation = { navigate: jest.fn(), popToTop: jest.fn(), setOptions: jest.fn() };

function sharingProps(listId: string) {
  return { navigation, route: { params: { listId } } } as unknown as SharingScreenProps;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  jest.mocked(shareList).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(setMemberRole).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(removeMember).mockResolvedValue({ error: null, verdict: 'ok' });
  jest.mocked(fetchMembers).mockResolvedValue({ members: [ALICE, BOB], error: null });
});

/** Renders the screen for a list the signed-in account holds `role` on. */
async function renderScreen(role: Role = 'owner') {
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role, items: [] }],
    error: null,
  });

  await render(
    <ListsProvider userId="u1">
      <SharingScreen {...sharingProps('l1')} />
    </ListsProvider>
  );

  // The roster arrives a microtask after the list does.
  await screen.findByText('bob@example.com');
}

it('shows everyone with access, and which one is you', async () => {
  await renderScreen();

  expect(screen.getByText('alice@example.com (you)')).toBeOnTheScreen();
  expect(screen.getByText('bob@example.com')).toBeOnTheScreen();
  expect(fetchMembers).toHaveBeenCalledWith('l1');
});

it('says the roster is on its way before it arrives', async () => {
  jest.mocked(fetchMembers).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchLists).mockResolvedValue({
    lists: [{ id: 'l1', name: 'Groceries', role: 'owner', items: [] }],
    error: null,
  });

  await render(
    <ListsProvider userId="u1">
      <SharingScreen {...sharingProps('l1')} />
    </ListsProvider>
  );

  expect(screen.getByLabelText('Loading who has access')).toBeOnTheScreen();
});

it('falls back to a not-found state for an unknown list', async () => {
  await render(
    <ListsProvider userId="u1">
      <SharingScreen {...sharingProps('does-not-exist')} />
    </ListsProvider>
  );

  expect(screen.getByText('List not found')).toBeOnTheScreen();
});

/**
 * The roster is readable by every member — `list_members_of` is gated on the caller's own
 * membership, not on ownership — so "who else can see my shopping list" is a question a reader gets
 * an answer to. Changing the answer is another matter.
 */
describe('somebody who is not an owner', () => {
  it('sees who has access but is given nothing to change', async () => {
    await renderScreen('reader');

    expect(screen.getByText('bob@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Only an owner can change who has access.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Email address')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Remove bob@example.com')).not.toBeOnTheScreen();
  });
});

describe('an owner', () => {
  it('shares the list with the address and role that were picked', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'carol@example.com');
    await fireEvent.press(screen.getByLabelText('Share as owner'));
    await fireEvent.press(screen.getByLabelText('Share'));

    expect(shareList).toHaveBeenCalledWith('l1', 'carol@example.com', 'owner');
    // The roster is re-read rather than patched in memory: the database is what decides.
    expect(fetchMembers).toHaveBeenCalledTimes(2);
  });

  it('will not share a blank address', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Share')).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Share'));
    expect(shareList).not.toHaveBeenCalled();
  });

  it('clears the invite field once the share lands', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'carol@example.com');
    await fireEvent.press(screen.getByLabelText('Share'));

    expect(screen.getByLabelText('Email address')).toHaveDisplayValue('');
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
});

// --- When it goes wrong -------------------------------------------------------------------------

/**
 * The most likely thing to go wrong on this screen, and the reason `verdictFor` classifies `P0002`
 * by its SQLSTATE: PostgREST answers it with a 500, and a 500 otherwise means "try again". Rendered
 * as an outage, a typo in the invite field would look like the app being broken.
 */
it('renders the database refusal for an address with no account', async () => {
  jest
    .mocked(shareList)
    .mockResolvedValue({ error: 'no account with that email yet', verdict: 'permanent' });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'nobody@example.com');
  await fireEvent.press(screen.getByLabelText('Share'));

  expect(await screen.findByText('no account with that email yet')).toBeOnTheScreen();
  // The address stays in the field, because it is the thing that needs correcting.
  expect(screen.getByLabelText('Email address')).toHaveDisplayValue('nobody@example.com');
});

/** The one screen in the app that cannot work offline, so it says so rather than queueing. */
it('says a connection is needed when the request never arrives', async () => {
  jest
    .mocked(shareList)
    .mockResolvedValue({ error: 'TypeError: Failed to fetch', verdict: 'retryable' });

  await renderScreen();
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'carol@example.com');
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
