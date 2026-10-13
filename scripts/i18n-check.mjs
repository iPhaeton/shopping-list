#!/usr/bin/env node
/**
 * Fails when `npm run i18n:extract` or `npm run i18n:compile` would change a file under
 * src/locales/ — a message added, edited or removed in the code but not extracted, or a `.po` edited
 * but not compiled. Every task step that touches a message runs it as part of its verification.
 *
 * The PO side is Lingui's own `lingui check sync --clean`, which compares without writing. Lingui
 * has no equivalent for compiled catalogs, so this compiles in place and compares with what was
 * there, then puts the old files back on any difference: a failed check leaves the tree as it found
 * it. Compiling is deterministic (keys sorted, no timestamps), so equal input gives equal bytes.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = path.join(ROOT, 'src/locales');
const LINGUI = path.join(ROOT, 'node_modules/.bin/lingui');

function run(args) {
  try {
    execFileSync(LINGUI, args, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/** Every compiled catalog on disk, by path relative to the repo, with its contents. */
function compiledCatalogs() {
  const found = new Map();
  if (!existsSync(LOCALES_DIR)) return found;
  for (const locale of readdirSync(LOCALES_DIR)) {
    const file = path.join(LOCALES_DIR, locale, 'messages.ts');
    if (existsSync(file)) found.set(path.relative(ROOT, file), readFileSync(file, 'utf8'));
  }
  return found;
}

if (!run(['check', 'sync', '--clean'])) {
  console.error('\nThe .po catalogs are out of date: run `npm run i18n:extract`.');
  process.exit(1);
}

const before = compiledCatalogs();
if (!run(['compile', '--typescript'])) {
  console.error('\nCompiling failed.');
  process.exit(1);
}
const after = compiledCatalogs();

const stale = [...new Set([...before.keys(), ...after.keys()])]
  .filter((file) => before.get(file) !== after.get(file))
  .sort();

if (stale.length === 0) {
  console.log('PASS compiled: every messages.ts matches its .po');
  process.exit(0);
}

for (const file of after.keys()) {
  if (!before.has(file)) rmSync(path.join(ROOT, file));
}
for (const [file, contents] of before) writeFileSync(path.join(ROOT, file), contents);

console.error('FAIL compiled: these would change — run `npm run i18n:compile`:');
for (const file of stale) console.error(`  ${file}`);
process.exit(1);
