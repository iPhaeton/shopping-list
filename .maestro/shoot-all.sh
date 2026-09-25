#!/usr/bin/env bash
# Screenshots every screen in both themes on the booted iOS simulator, against the local stack.
#
#   .maestro/shoot-all.sh <out-dir> <owner-email> <fresh-email-prefix>
#
# <owner-email> must already own the data tour-signed-in.yaml expects — `node .maestro/seed.mjs`
# makes it, with maya@example.com as the owner and Sam as the member. Each run needs a
# <fresh-email-prefix> the stack has never seen: Set name only appears for a brand-new account.
# Starts from whatever state the app is in; leaves it on Night, signed in as <owner-email>.
set -euo pipefail

OUT=$(cd "$1" && pwd)
OWNER=$2
FRESH=$3
HERE=$(cd "$(dirname "$0")" && pwd)
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk}
MAESTRO=${MAESTRO:-$HOME/.maestro/bin/maestro}

RUNS=$(mktemp -d)
flow() { "$MAESTRO" test --test-output-dir "$RUNS/$1-$RANDOM" "$HERE/flows/$1.yaml" "${@:2}"; }

# Names the account out of the Set name gate, then cold-starts so the restored session picks it up.
name_and_restart() {
  psql "$DB" -qc "update public.users set name = '$2' where id = (select id from auth.users where email = '$1')"
  flow open-app
}

# A known start whatever the last run left behind: Day, signed out.
flow open-app
flow ensure-signed-in -e EMAIL="$OWNER"
flow set-theme -e THEME=Day
flow sign-out

for THEME in day night; do
  Theme=$(tr '[:lower:]' '[:upper:]' <<<"${THEME:0:1}")${THEME:1}
  flow tour-signed-out -e THEME="$THEME" -e EMAIL="$FRESH-$THEME@example.com"
  name_and_restart "$FRESH-$THEME@example.com" "$FRESH $Theme"
  flow sign-out
  flow sign-in -e EMAIL="$OWNER"
  flow tour-signed-in -e THEME="$THEME"
  # Switch for the next pass while still signed in: the choice is per device, so it carries over
  # to the signed-out screens that pass starts on.
  if [ "$THEME" = day ]; then
    flow set-theme -e THEME=Night
    flow sign-out
  fi
done

find "$RUNS" -path '*/takeScreenshot/*.png' -exec cp {} "$OUT/" \;
rm -rf "$RUNS"
