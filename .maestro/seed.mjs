// Seeds the data the tour flows expect, through the local stack's real API: OTP sign-in with the
// code read out of Mailpit, then the same RPCs and inserts the app makes. Going through the API
// rather than SQL matters — every write RPC checks for a live session row
// (ai/kb/entries/session-still-valid-guards-writes.md), which a psql role switch does not have.
//
//   node .maestro/seed.mjs [owner-email] [member-email]     (defaults: maya@example.com sam@example.com)
//
// Run it once per stack (`npx supabase db reset` starts over): names must be unique, and a second
// run adds a second copy of every list. Display names come from the address — maya@… is "Maya".
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'http://127.0.0.1:54321';
const MAILPIT = 'http://127.0.0.1:54324';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
);
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY_LOCAL;

const nameFor = (email) => email[0].toUpperCase() + email.slice(1, email.indexOf('@'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signIn(email) {
  const sentAt = Date.now();
  const headers = { apikey: anon, 'content-type': 'application/json' };
  const sent = await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!sent.ok) throw new Error(`otp ${email}: ${sent.status} ${await sent.text()}`);

  let code;
  for (let attempt = 0; attempt < 20 && !code; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const latest = (await search.json()).messages?.[0];
    if (latest && new Date(latest.Created).getTime() > sentAt - 3000) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json();
      code = message.Text.match(/\b(\d{6})\b/)[1];
    } else {
      await sleep(500);
    }
  }
  if (!code) throw new Error(`no code for ${email} in Mailpit`);

  const verified = await fetch(`${API}/auth/v1/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'email', email, token: code }),
  });
  const session = await verified.json();
  if (!session.access_token) throw new Error(`verify ${email}: ${JSON.stringify(session)}`);
  return session;
}

function as(session) {
  const headers = {
    apikey: anon,
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };

  async function call(path, body) {
    const response = await fetch(`${API}/rest/v1/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }

  return {
    userId: session.user.id,
    rpc: (fn, args) => call(`rpc/${fn}`, args),
    async list(name, titles) {
      const id = randomUUID();
      await call('lists', { id, name });
      const items = {};
      for (const title of titles) {
        items[title] = randomUUID();
        await call('rpc/add_item', { p_id: items[title], p_list_id: id, p_title: title });
      }
      return { id, items };
    },
  };
}

const [ownerEmail = 'maya@example.com', memberEmail = 'sam@example.com'] = process.argv.slice(2);

const owner = as(await signIn(ownerEmail));
const member = as(await signIn(memberEmail));
await owner.rpc('set_name', { p_name: nameFor(ownerEmail) });
await member.rpc('set_name', { p_name: nameFor(memberEmail) });

// The owner's own lists: one done item and one in the bin, so "Show 1 deleted" appears.
const groceries = await owner.list('Groceries', ['Milk', 'Bread', 'Eggs', 'Apples', 'Coffee']);
await owner.rpc('set_item_done', { p_item_id: groceries.items.Bread, p_done: true });
await owner.rpc('set_item_deleted', { p_item_id: groceries.items.Coffee, p_deleted: true });
await owner.list('Hardware store', []);
await owner.list('Pharmacy', []);
await owner.rpc('share_list', { p_list_id: groceries.id, p_user_id: member.userId, p_role: 'writer' });

// Shared with the owner: one they can edit, one read-only.
const bbq = await member.list('Weekend BBQ', ['Charcoal', 'Sausages', 'Corn on the cob', 'Lemonade']);
const party = await member.list('Birthday party', ['Candles', 'Balloons', 'Cake', 'Napkins']);
await member.rpc('share_list', { p_list_id: bbq.id, p_user_id: owner.userId, p_role: 'writer' });
await member.rpc('share_list', { p_list_id: party.id, p_user_id: owner.userId, p_role: 'reader' });

console.log(`seeded ${ownerEmail} (${nameFor(ownerEmail)}) and ${memberEmail} (${nameFor(memberEmail)})`);
