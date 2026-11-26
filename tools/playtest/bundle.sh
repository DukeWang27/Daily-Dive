#!/usr/bin/env bash
# Builds the private playtest bundle into $1 (default: a temp folder): the game files plus every day, with
# window.PLAYTEST set so it runs with no database. Publish it privately; never deploy it to the public site.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-$(mktemp -d)}"; rm -rf "$out"; mkdir -p "$out/days"
for f in $(grep -o 'src="[a-z]*\.js"' index.html | cut -d'"' -f2); do cp "$f" "$out/"; done
cp favicon.svg apple-touch-icon.png words.json realwords.txt "$out/"; cp days/index.json "$out/days/"; mkdir -p "$out/content/kb"; cp content/kb/occupations.json "$out/content/kb/"; cp review.js "$out/"
sed -e 's|<script src="palette.js"></script>|<script>window.PLAYTEST = true;</script>\n<script src="palette.js"></script>|' -e 's|<title>Deeple|<title>Deeple Playtest|' index.html > "$out/index.html"
grep -q "window.PLAYTEST = true" "$out/index.html"
python3 tools/playtest/build.py "$out" >/dev/null
echo "$out"
