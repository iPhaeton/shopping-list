#!/bin/zsh
# Renders mockup scenes at 390×844 pt @3x, day and night, with Chrome's headless shell.
#
#   ai/ux/source/render.sh <out-dir> <scene>...
#
# Each scene lands as <out-dir>/<scene>-quiet-horizon.png and <scene>-quiet-horizon-moonlit.png, and
# its fit report (sort-button faces that would clip) is printed. Scenes are the keys of SCENES in mock.js.
# Env: W H INSET (390 844 47), PORT (8765), CHROME (default: Playwright's newest headless shell).
set -e
HERE=${0:A:h}
ROOT=${HERE:h:h:h}
out=${1:?usage: render.sh <out-dir> <scene>...}; shift
mkdir -p $out
W=${W:-390}; H=${H:-844}; INSET=${INSET:-47}; PORT=${PORT:-8765}
CHROME=${CHROME:-$(ls -d ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell(N) | tail -1)}
if [[ ! -x $CHROME ]]; then
  echo "No chrome-headless-shell. Run 'npx playwright install chromium-headless-shell', or set CHROME." >&2
  exit 1
fi

node --no-warnings $HERE/tokens.mjs
python3 -m http.server $PORT --bind 127.0.0.1 --directory $ROOT >/dev/null 2>&1 &
server=$!
trap "kill $server 2>/dev/null" EXIT
until curl -s -o /dev/null http://127.0.0.1:$PORT/ai/ux/source/mock.html; do sleep 0.1; done

base="http://127.0.0.1:$PORT/ai/ux/source/mock.html?w=$W&h=$H&inset=$INSET"
for scene in "$@"; do
  for theme in day night; do
    [[ $theme == night ]] && file=$out/$scene-quiet-horizon-moonlit.png || file=$out/$scene-quiet-horizon.png
    # One process per shot: the shell exits after it. Desktop Chrome's --headless=new hangs here.
    $CHROME --disable-gpu --hide-scrollbars --force-device-scale-factor=3 --window-size=$W,$H \
      --virtual-time-budget=4000 --screenshot=$file "$base&scene=$scene&theme=$theme" >/dev/null 2>&1
    echo $file
  done
  report=$($CHROME --disable-gpu --virtual-time-budget=4000 --window-size=$W,$H --dump-dom \
    "$base&scene=$scene&theme=day" 2>/dev/null | grep -o '"clipped":\[[^]]*\]')
  echo "  $scene $report"
done
