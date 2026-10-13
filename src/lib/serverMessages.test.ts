import { i18n, type Messages } from '@lingui/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messages as pseudoMessages } from '../locales/pseudo/messages';
import {
  AUTH_SAMPLES,
  DATABASE_MESSAGES,
  EDGE_FUNCTION_CODES,
  NOT_DISPLAYED,
  recognise,
  serverMessage,
  type ServerFailure,
} from './serverMessages';

/**
 * The drift guard. Server messages are recognised by their exact text, which nothing but this suite
 * ties to the code that writes it: the migrations' `raise`s and the Edge Functions' answers are read
 * here as text, so a reworded or new message fails the suite instead of quietly showing in English.
 */
const ROOT = join(__dirname, '..', '..');

const key = ({ code, message }: ServerFailure) => `${code} ${message}`;
const keys = (failures: readonly ServerFailure[]) => failures.map(key).sort();

/**
 * Every `errcode`/`message` pair the database raises today: the latest definition of each function,
 * from the migrations in order, with dropped functions gone. A function is keyed by name alone, as
 * the KB audit's own parse is: no two overloads have ever been live at once.
 */
function raisedByTheDatabase(): ServerFailure[] {
  const dir = join(ROOT, 'supabase', 'migrations');
  const bodies = new Map<string, string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
    // A header may not run into the next `create`: a function without a `$$` body would otherwise
    // swallow the one after it.
    const statements =
      /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\((?:(?!create\s)[^$])*\$\$([\s\S]*?)\$\$|drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)/gi;
    for (const [, created, body, dropped] of sql.matchAll(statements)) {
      if (created) bodies.set(created, body);
      else bodies.delete(dropped);
    }
  }

  const pairs = new Map<string, ServerFailure>();
  for (const body of bodies.values()) {
    for (const [, code, quoted] of body.matchAll(
      /errcode\s*=\s*'([^']+)'\s*,\s*message\s*=\s*'((?:[^']|'')*)'/gi
    )) {
      const failure = { code, message: quoted.replace(/''/g, "'") };
      pairs.set(key(failure), failure);
    }
  }
  return [...pairs.values()];
}

/** `FAILURES` in the Apple half, and the session refusals in `_shared/supabase.ts`. */
function answeredByTheEdgeFunctions(): { mapped: ServerFailure[]; revoked: ServerFailure[] } {
  const shared = join(ROOT, 'supabase', 'functions', '_shared');
  const apple = readFileSync(join(shared, 'apple.ts'), 'utf8');
  const failures = apple.slice(apple.indexOf('const FAILURES = {'), apple.indexOf('} as const;'));
  const mapped = [...failures.matchAll(/(\w+):\s*\{\s*status:\s*\d+,\s*message:\s*("(?:[^"\\]|\\.)*")/g)].map(
    ([, code, message]) => ({ code, message: JSON.parse(message) as string })
  );

  const supabase = readFileSync(join(shared, 'supabase.ts'), 'utf8');
  const unauthorized = /code: error\?\.code \?\? '(\w+)', message: error\?\.message \?\? '([^']+)'/.exec(supabase);
  const revoked = /code: '(\w+)', message: '([^']+)'/.exec(supabase);
  if (!unauthorized || !revoked) throw new Error('_shared/supabase.ts no longer reads as this suite expects');
  mapped.push({ code: unauthorized[1], message: unauthorized[2] });
  return { mapped, revoked: [{ code: revoked[1], message: revoked[2] }] };
}

const notDisplayed: ServerFailure[] = Object.entries(NOT_DISPLAYED).flatMap(([code, texts]) =>
  Object.keys(texts).map((message) => ({ code, message }))
);

describe('the database', () => {
  const raised = raisedByTheDatabase();

  it('has every message it raises either mapped or listed as never shown, and nothing else', () => {
    expect(keys(raised)).toEqual(keys([...DATABASE_MESSAGES, ...notDisplayed]));
  });

  it('keeps each mapped message in its own English, with the limits put back', () => {
    for (const failure of DATABASE_MESSAGES) expect(recognise(failure)).toBe(failure.message);
  });

  it('never translates what is not shown', () => {
    for (const failure of notDisplayed) {
      expect(recognise(failure)).toBeNull();
      expect(serverMessage(failure)).toBe(failure.message);
    }
  });

  it('recognises a text only under its own SQLSTATE', () => {
    expect(recognise({ code: '42501', message: 'that name is taken' })).toBeNull();
    expect(recognise({ message: 'that name is taken' })).toBeNull();
  });
});

describe('the Edge Functions', () => {
  const { mapped, revoked } = answeredByTheEdgeFunctions();

  it("has every code they answer with mapped, in the functions' own English", () => {
    expect(mapped.length).toBeGreaterThanOrEqual(7);
    expect(mapped.map(({ code }) => code).sort()).toEqual([...EDGE_FUNCTION_CODES].sort());
    for (const failure of mapped) expect(recognise(failure)).toBe(failure.message);
  });

  it('answers a revoked session in the words that are never shown', () => {
    expect(keys(revoked)).toEqual(keys(notDisplayed));
  });
});

describe('GoTrue', () => {
  it('recognises every error the sign-in screen was seen to meet, in its own English', () => {
    expect(AUTH_SAMPLES.length).toBeGreaterThan(0);
    for (const failure of AUTH_SAMPLES) expect(recognise(failure)).toBe(failure.message);
  });

  it('puts the wait back into the sentence it came from', () => {
    for (const seconds of [1, 59]) {
      const message = `For security purposes, you can only request this after ${seconds} seconds.`;
      expect(recognise({ code: 'over_email_send_rate_limit', message })).toBe(message);
    }
  });

  it('shows what it does not recognise as it arrived', () => {
    for (const failure of [
      { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this soon.' },
      { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
      { code: 'validation_failed', message: 'Something else entirely' },
      { code: 'not_a_code', message: 'Whatever this is' },
      { code: 'constructor', message: 'Not a key of every object' },
      { message: 'TypeError: Failed to fetch' },
    ]) {
      expect(recognise(failure)).toBeNull();
      expect(serverMessage(failure)).toBe(failure.message);
    }
  });

  it('shares no code with the database or the Edge Functions', () => {
    const auth = new Set(AUTH_SAMPLES.map(({ code }) => code));
    const database = new Set(DATABASE_MESSAGES.map(({ code }) => code));
    for (const code of EDGE_FUNCTION_CODES) expect(auth.has(code) || database.has(code)).toBe(false);
    for (const code of auth) expect(database.has(code)).toBe(false);
  });
});

describe('in pseudo', () => {
  beforeAll(() => {
    i18n.load('pseudo', pseudoMessages as Messages);
    i18n.activate('pseudo');
  });

  afterAll(() => {
    i18n.activate('en');
  });

  it('comes from the catalog, every one of them', () => {
    const { mapped } = answeredByTheEdgeFunctions();
    for (const failure of [...DATABASE_MESSAGES, ...mapped, ...AUTH_SAMPLES]) {
      const text = recognise(failure);
      expect(text).not.toBeNull();
      expect(text).not.toBe(failure.message);
    }
  });
});
