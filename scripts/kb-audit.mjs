#!/usr/bin/env node
/**
 * Checks that every entry in ai/kb/ still holds.
 *
 * Each entry may carry a `verify:` line — a shell command run from the repo root where exit 0
 * means the fact is still true. Entries without one (judgment facts: rationale, scope) are
 * checked for age instead. See ai/kb/CHARTER.md.
 *
 * Deliberately dependency-free: frontmatter is read as "key: rest of the line, raw", so a
 * verify command containing #, |, or quotes needs no escaping.
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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

function daysSince(date) {
  return Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
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
  const fields = parseFrontmatter(readFileSync(path.join(ENTRIES_DIR, file), 'utf8'), relative);
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

  if (fields.status !== 'current') {
    rows.push({ slug, mark: '-', note: fields.status ?? 'unknown status' });
    continue;
  }

  if (fields.verify) {
    const result = runVerify(fields.verify);
    if (result.ok) {
      rows.push({ slug, mark: 'ok', note: '' });
    } else {
      rows.push({ slug, mark: 'FAIL', note: result.detail || 'verify command exited non-zero' });
      errors.push(`${relative}: verify failed — \`${fields.verify}\``);
    }
    continue;
  }

  const age = fields.last_verified ? daysSince(fields.last_verified) : null;
  if (age !== null && age > STALE_AFTER_DAYS) {
    rows.push({ slug, mark: 'STALE', note: `unchecked for ${age} days` });
    warnings.push(`${relative}: judgment fact unverified for ${age} days — re-read and bump last_verified`);
  } else {
    rows.push({ slug, mark: 'judge', note: age === null ? '' : `reviewed ${age}d ago` });
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
for (const [slug, fields] of seen) {
  const indexed = linked.has(slug);
  if (fields.status === 'current' && !indexed && fields.indexed !== 'false') {
    errors.push(`ai/kb/entries/${slug}.md: current but missing from INDEX.md`);
  }
  if (fields.status !== 'current' && indexed) {
    warnings.push(`ai/kb/INDEX.md: still lists \`${slug}\`, which is ${fields.status}`);
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
