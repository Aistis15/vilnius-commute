#!/bin/bash
# Vilnius Commute demo on a Mac, in one go: the server in demo mode with
# Whisper (voice on the iPhone), then Expo through a tunnel for Expo Go.
#   bash prototype/paleisti-mac.sh          the real clock
#   bash prototype/paleisti-mac.sh 13:00    the clock from 13:00 today
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "Nėra python3. Įdiek: xcode-select --install"; exit 1; }
command -v node >/dev/null || { echo "Nėra Node.js. Įdiek LTS iš https://nodejs.org"; exit 1; }

if ! python3 -c "import faster_whisper" 2>/dev/null; then
  echo "Diegiamas Whisper (balsui telefone)..."
  python3 -m pip install --user faster-whisper \
    || python3 -m pip install --user --break-system-packages faster-whisper \
    || echo "Whisper įdiegti nepavyko: viskas veiks, išskyrus balsą."
fi

# An old server on the port would answer instead of this one.
lsof -ti tcp:8765 | xargs kill 2>/dev/null
sleep 1

LOG=/tmp/vilnius-commute-server.log
python3 -u server.py --demo "$@" > "$LOG" 2>&1 &
SERVER=$!
tail -n +1 -f "$LOG" | grep --line-buffered -E "Demo:|Speech:|Ready|Heard|Error|rror:" &
TAIL=$!
trap 'kill $SERVER $TAIL 2>/dev/null' EXIT

echo "Laukiama serverio..."
for _ in $(seq 1 90); do
  curl -s localhost:8765/api/status | grep -q '"ready": true' && break
  sleep 1
done

cd expo
[ -d node_modules/expo-audio ] || npm install --no-audit --no-fund
npx expo whoami >/dev/null 2>&1 || npx expo login

echo
echo " iPhone: Expo Go -> ta pati paskyra -> nuskenuok QR kamera -> leisk vietą ir mikrofoną."
echo " Užrakto ekrane: mikrofonas -> \"Man reikia į OZĄ iki antros\"."
echo " Čia matysi \"Heard: ...\" - ką Whisper išgirdo. Sustabdyti: Ctrl+C."
echo
npx expo start --tunnel
