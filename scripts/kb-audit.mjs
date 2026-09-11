#!/usr/bin/env node
/**
 * Checks that every entry in ai/kb/ still holds.
 *
 * Each entry may carry a `verify:` line — a shell command run from the repo root where exit 0
 * means the fact is still true. Entries without one (judgment facts: rationale, scope) are
 * checked for age instead. See ai/kb/CHARTER.md.
 *
 * Both are backstopped by a ground-moved check: when a file an entry links to has been committed
 * to since anyone last read that entry, its prose may describe code that no longer exists — even
 * when its `verify:` still passes, since a check covers the invariant, not the explanation.
 *
 * Deliberately dependency-free: frontmatter is read as "key: rest of the line, raw", so a
 * verify command containing #, |, or quotes needs no escaping.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES_DIR = path.join(ROOT, 'ai/kb/entries');
const INDEX_FILE = path.join(ROOT, 'ai/kb/INDEX.md');

const TYPES = ['convention', 'constraint', 'gotcha', 'decision', 'environment', 'reference'];
const STATUSES = ['current', 'superseded', 'retired'];
const REQUIRED = ['id', 'title', 'type', 'status', 'last_verified'];
const STALE_AFTER_DAYS = 90;
const INDEX_BUDGET = 25;
// Lines per entry, frontmatter included. A warning rather than an error, like the index budget:
// every deposit pass reads every entry before it may dedup, so length is paid for on every future
// pass — but a red audit would push whoever tripped it into trimming under pressure, and the prose
// that earns an entry its place is easier to cut than the narrative that does not.
const ENTRY_BUDGET = 120;
const VERIFY_TIMEOUT_MS = 120_000;

const errors = [];
const warnings = [];

/** Reads frontmatter as raw `key: rest of line` pairs — no YAML, nothing stripped. */
function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    errors.push(`${file}: no frontmatter block`);
    return null;
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][\w-]*):[ \t]?(.*)$/);
    if (field) fields[field[1]] = field[2].trimEnd();
  }
  return fields;
}

/** Reads a slug reference that may be a `[a, b]` list or a bare `a`. */
function parseSlugList(value) {
  if (!value) return [];
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function daysSince(date) {
  return Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Ground-moved needs git history; without it the check sits out rather than failing the run. */
const gitAvailable = (() => {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
})();

const dirtyFiles = new Set(
  gitAvailable
    ? git(['status', '--porcelain'])
        .split('\n')
        .filter((line) => line && !line.startsWith('??'))
        .map((line) => line.slice(3).trim())
    : []
);

const commitTimes = new Map();
function lastCommitTime(relativePath) {
  if (!commitTimes.has(relativePath)) {
    let stamp = '';
    try {
      stamp = git(['log', '-1', '--format=%cI', '--', relativePath]).trim();
    } catch {
      stamp = '';
    }
    commitTimes.set(relativePath, stamp ? Date.parse(stamp) : null);
  }
  return commitTimes.get(relativePath);
}

/**
 * Repo files an entry links to — its "ground". Links into ai/kb/ itself are skipped: entries
 * point at each other constantly and every curation pass would light them all up.
 */
function groundOf(source) {
  const paths = new Set();
  for (const [, target] of source.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#|mailto:)/.test(target)) continue;

    const absolute = path.resolve(ENTRIES_DIR, target.split('#')[0]);
    const relative = path.relative(ROOT, absolute);
    if (relative.startsWith('..') || relative.startsWith('ai/kb/')) continue;
    if (!existsSync(absolute)) continue;

    paths.add(relative);
  }
  return [...paths];
}

/**
 * Files committed on a later day than `last_verified`, or dirty right now. Same-day commits are
 * ignored: `last_verified` is a date, so it cannot distinguish "read it before" from "after".
 */
function groundMoved(source, lastVerified) {
  if (!gitAvailable || !lastVerified || Number.isNaN(Date.parse(lastVerified))) return [];

  const threshold = Date.parse(lastVerified) + 86_400_000;
  const moved = [];

  for (const relative of groundOf(source)) {
    if (dirtyFiles.has(relative)) {
      moved.push(`${relative} (uncommitted changes)`);
      continue;
    }
    const committed = lastCommitTime(relative);
    if (committed !== null && committed >= threshold) {
      moved.push(`${relative} (committed ${new Date(committed).toISOString().slice(0, 10)})`);
    }
  }
  return moved;
}

function runVerify(command) {
  try {
    execSync(command, {
      cwd: ROOT,
      shell: '/bin/sh',
      stdio: 'pipe',
      timeout: VERIFY_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (error) {
    const output = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim().split('\n')[0] ?? '';
    return { ok: false, detail: error.signal === 'SIGTERM' ? 'timed out' : output };
  }
}

const files = readdirSync(ENTRIES_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort();

if (files.length === 0) errors.push('ai/kb/entries/ holds no entries');

const rows = [];
const seen = new Map();

for (const file of files) {
  const relative = `ai/kb/entries/${file}`;
  const slug = file.replace(/\.md$/, '');
  const source = readFileSync(path.join(ENTRIES_DIR, file), 'utf8');
  const fields = parseFrontmatter(source, relative);
  if (!fields) continue;

  seen.set(slug, fields);

  for (const key of REQUIRED) {
    if (!fields[key]) errors.push(`${relative}: missing required field \`${key}\``);
  }
  if (fields.id && fields.id !== slug) {
    errors.push(`${relative}: id \`${fields.id}\` does not match the filename`);
  }
  if (fields.type && !TYPES.includes(fields.type)) {
    errors.push(`${relative}: unknown type \`${fields.type}\``);
  }
  if (fields.status && !STATUSES.includes(fields.status)) {
    errors.push(`${relative}: unknown status \`${fields.status}\``);
  }
  if (fields.last_verified && Number.isNaN(Date.parse(fields.last_verified))) {
    errors.push(`${relative}: last_verified \`${fields.last_verified}\` is not a date`);
  }

  // Superseded and retired entries are frozen records, so their length is nobody's problem: a
  // deposit pass reads the current set.
  if (fields.status === 'current') {
    const lines = source.split('\n').filter((line, i, all) => i < all.length - 1 || line !== '').length;
    if (lines > ENTRY_BUDGET) {
      warnings.push(
        `${relative}: ${lines} lines, budget is ${ENTRY_BUDGET} — split it, or move the step-by-step narrative to the log it came from`
      );
    }
  }

  if (fields.status !== 'current') {
    rows.push({ slug, mark: '-', note: fields.status ?? 'unknown status' });
    continue;
  }

  // Runs whichever branch follows: a passing `verify:` proves the invariant, not the prose.
  const moved = groundMoved(source, fields.last_verified);
  if (moved.length > 0) {
    warnings.push(
      `${relative}: ground moved since last_verified ${fields.last_verified} — ${moved.join(', ')}`
    );
  }
  const drift = moved.length > 0 ? `ground moved: ${moved.length} file(s)` : '';
  const withDrift = (note) => [note, drift].filter(Boolean).join('; ');

  if (fields.verify) {
    const result = runVerify(fields.verify);
    if (result.ok) {
      rows.push({ slug, mark: 'ok', note: withDrift('') });
    } else {
      rows.push({ slug, mark: 'FAIL', note: withDrift(result.detail || 'verify command exited non-zero') });
      errors.push(`${relative}: verify failed — \`${fields.verify}\``);
    }
    continue;
  }

  const age = fields.last_verified ? daysSince(fields.last_verified) : null;
  if (age !== null && age > STALE_AFTER_DAYS) {
    rows.push({ slug, mark: 'STALE', note: withDrift(`unchecked for ${age} days`) });
    warnings.push(`${relative}: judgment fact unverified for ${age} days — re-read and bump last_verified`);
  } else {
    rows.push({ slug, mark: 'judge', note: withDrift(age === null ? '' : `reviewed ${age}d ago`) });
  }
}

// Index consistency: every current entry is reachable, and every link resolves.
const index = readFileSync(INDEX_FILE, 'utf8');
const linked = new Set(
  [...index.matchAll(/\(([^)]*entries\/([^)/]+)\.md)\)/g)].map((match) => match[2])
);

for (const slug of linked) {
  if (!seen.has(slug)) errors.push(`ai/kb/INDEX.md: links to \`${slug}\`, which does not exist`);
}

// Inbound `related:` links. A demoted entry is still searchable, but nothing surfaces it to an
// agent who did not think to ask; a link from a neighbour is what restores that.
const inbound = new Map();
for (const [slug, fields] of seen) {
  for (const target of parseSlugList(fields.related)) {
    if (!inbound.has(target)) inbound.set(target, new Set());
    inbound.get(target).add(slug);
  }
}

for (const [slug, fields] of seen) {
  const entry = `ai/kb/entries/${slug}.md`;
  const indexed = linked.has(slug);

  if (fields.status === 'current' && !indexed && fields.indexed !== 'false') {
    errors.push(`${entry}: current but missing from INDEX.md`);
  }
  if (fields.status !== 'current' && indexed) {
    warnings.push(`ai/kb/INDEX.md: still lists \`${slug}\`, which is ${fields.status}`);
  }

  for (const target of parseSlugList(fields.related)) {
    if (target === slug) {
      warnings.push(`${entry}: related: lists itself`);
    } else if (!seen.has(target)) {
      errors.push(`${entry}: related: points at \`${target}\`, which does not exist`);
    }
  }

  const replacements = parseSlugList(fields.superseded_by);
  if (fields.status === 'superseded' && replacements.length === 0) {
    errors.push(`${entry}: superseded with no superseded_by — nothing points at what replaced it`);
  }
  for (const target of replacements) {
    if (!seen.has(target)) {
      errors.push(`${entry}: superseded_by points at \`${target}\`, which does not exist`);
    } else if (seen.get(target).status !== 'current') {
      warnings.push(
        `${entry}: superseded_by points at \`${target}\`, which is itself ${seen.get(target).status}`
      );
    }
  }

  if (fields.indexed === 'false' && !inbound.has(slug)) {
    warnings.push(`${entry}: demoted and no entry links to it — only found by someone already searching`);
  }
}

const bullets = index.split('\n').filter((line) => line.startsWith('- ')).length;
if (bullets > INDEX_BUDGET) {
  warnings.push(`ai/kb/INDEX.md: ${bullets} entries listed, budget is ${INDEX_BUDGET} — demote before adding`);
}

const width = Math.max(...rows.map((row) => row.slug.length), 0);
for (const row of rows) {
  const mark = { ok: '  ok  ', FAIL: ' FAIL ', STALE: 'STALE ', judge: 'judge ', '-': '  --  ' }[row.mark];
  console.log(`${mark} ${row.slug.padEnd(width)}  ${row.note}`);
}

console.log('');
for (const warning of warnings) console.log(`warn:  ${warning}`);
for (const error of errors) console.log(`ERROR: ${error}`);

const checked = rows.filter((row) => row.mark === 'ok' || row.mark === 'FAIL').length;
console.log(
  `\n${files.length} entries, ${checked} mechanically checked, ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`
);

process.exit(errors.length > 0 ? 1 : 0);
