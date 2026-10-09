#!/bin/bash
# Vilnius Commute on the iPhone from a Mac, no app to install: the server in
# demo mode with Whisper (voice), reached over https through a Cloudflare
# quick tunnel (the microphone needs https). The QR code opens it in Safari;
# "Pridėti prie pradžios ekrano" makes it full screen like an app.
#   bash prototype/paleisti-mac.sh          the real clock
#   bash prototype/paleisti-mac.sh 13:00    the clock from 13:00 today
# (Expo Go instead: paleisti-mac-expo.sh)
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "Nėra python3. Įdiek: xcode-select --install"; exit 1; }

if ! python3 -c "import faster_whisper" 2>/dev/null; then
  echo "Diegiamas Whisper (balsui telefone)..."
  python3 -m pip install --user faster-whisper \
    || python3 -m pip install --user --break-system-packages faster-whisper \
    || echo "Whisper įdiegti nepavyko: viskas veiks, išskyrus balsą."
fi

# cloudflared, beside this script (server.py finds it there).
if ! command -v cloudflared >/dev/null && [ ! -x ./cloudflared ]; then
  echo "Atsisiunčiamas cloudflared (https adresui)..."
  ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo amd64)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar xz \
    || { echo "cloudflared atsisiųsti nepavyko. Bandyk: brew install cloudflared"; exit 1; }
  chmod +x ./cloudflared
  xattr -d com.apple.quarantine ./cloudflared 2>/dev/null
fi

# An old server on the port would answer instead of this one.
lsof -ti tcp:8765 | xargs kill 2>/dev/null
sleep 1

LOG=/tmp/vilnius-commute-server.log
python3 -u server.py --demo "$@" --tunnel > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; pkill -f "cloudflared tunnel --no-autoupdate" 2>/dev/null' EXIT

echo "Laukiama serverio ir https adreso (iki minutės)..."
URL=""
for _ in $(seq 1 90); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1)
  READY=$(curl -s localhost:8765/api/status | grep -c '"ready": true')
  [ -n "$URL" ] && [ "$READY" = "1" ] && break
  sleep 1
done
grep -E "Demo:|Speech:" "$LOG"

if [ -z "$URL" ]; then
  echo
  echo "https adreso gauti nepavyko (tinklas blokuoja Cloudflare?). Žurnalas: $LOG"
  echo "Bandyk kitą tinklą, pvz. telefono asmeninį prieigos tašką (Hotspot)."
  exit 1
fi

PAGE="$URL/?shell=expo"
echo
echo "=============================================================="
echo " iPhone: nuskenuok šį QR kodą kamera (arba Safari įvesk adresą):"
echo " $PAGE"
echo "=============================================================="
python3 -c "import qrcode" 2>/dev/null || python3 -m pip install --user -q qrcode 2>/dev/null \
  || python3 -m pip install --user --break-system-packages -q qrcode 2>/dev/null
python3 - "$PAGE" <<'PY' || echo "(QR kodas atidarytas naršyklėje)"
import sys, qrcode
q = qrcode.QRCode(border=2)
q.add_data(sys.argv[1])
q.print_ascii(invert=True)
PY
# The same code, bigger, in the Mac's browser.
open "http://localhost:8765/connect" 2>/dev/null

echo
echo " 1. Atsidarys Safari. Spausk Bendrinti (kvadratas su rodykle) -> Pridėti prie pradžios ekrano."
echo " 2. Atidaryk \"Vilnius\" nuo pradžios ekrano. Leisk vietą ir mikrofoną."
echo " 3. Užrakto ekrane: mikrofonas -> \"Man reikia į OZĄ iki antros\"."
echo " Žemiau matysi \"Heard: ...\" - ką Whisper išgirdo. Sustabdyti: Ctrl+C."
echo
tail -n 0 -f "$LOG" | grep --line-buffered -E "Heard|Error|rror:"
