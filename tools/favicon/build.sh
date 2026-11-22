#!/bin/sh
# Renders tools/favicon/icon.html with headless Chrome and writes every icon
# size the site links to into public/. macOS only (uses sips).
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1024,1024 --virtual-time-budget=8000 \
  --screenshot="$TMP/icon-1024.png" "file://$PWD/icon.html" >/dev/null 2>&1
for s in 32 48 96 180 192; do
  sips -z $s $s "$TMP/icon-1024.png" --out "$TMP/icon-$s.png" >/dev/null
done
cp "$TMP/icon-96.png"  ../../public/favicon-96.png
cp "$TMP/icon-180.png" ../../public/apple-touch-icon.png
cp "$TMP/icon-192.png" ../../public/icon-192.png
# favicon.ico: an ICO container holding the 32 and 48px PNGs as they are.
python3 - "$TMP" ../../public/favicon.ico <<'PY'
import struct, sys
tmp, out = sys.argv[1], sys.argv[2]
imgs = [(s, open(f"{tmp}/icon-{s}.png", "rb").read()) for s in (32, 48)]
head = struct.pack("<HHH", 0, 1, len(imgs))
off = 6 + 16 * len(imgs)
entries = body = b""
for s, data in imgs:
    entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(data), off)
    off += len(data); body += data
open(out, "wb").write(head + entries + body)
PY
rm -rf "$TMP"
