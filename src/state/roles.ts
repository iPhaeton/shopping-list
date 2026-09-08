import type { Role } from './types';

/**
 * What each role may do, as the *client* understands it. The database is what actually decides —
 * every rule here is also a row-level security policy — so these are for choosing which controls to
 * render, never for authorization.
 *
 * The point is courtesy, not safety: a reader whose optimistic item appears and then vanishes with a
 * red banner is a worse experience than an Add bar that was never there.
 */

/** Mirrors the enum's declaration order, which is what `role >= 'writer'` means in the policies. */
const RANK: Record<Role, number> = { reader: 0, writer: 1, owner: 2 };

export const canEditItems = (role: Role) => RANK[role] >= RANK.writer;

export const canManageList = (role: Role) => role === 'owner';
