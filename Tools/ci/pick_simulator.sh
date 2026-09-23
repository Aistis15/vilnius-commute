#!/usr/bin/env bash
#
# Prints an xcodebuild -destination string for an available iOS simulator.
#
# Why this is not pinned in the workflow
# --------------------------------------
# The workflow used to hardcode `name=iPhone 17,OS=26.5`. That stopped
# resolving the moment the GitHub runner image rolled, and the build failed
# with "Unable to find a device matching the provided destination specifier" —
# nothing to do with the code. Worse, the image does not always ship
# pre-created devices at all, so even matching on name alone is not safe.
#
# So: pick the newest iOS runtime with an available iPhone and address it by
# UDID, which cannot drift. If the image has no devices, create one.
#
# Usage:  SIMULATOR="$(Tools/ci/pick_simulator.sh)"
# Diagnostics go to stderr so stdout stays clean for the destination string.

set -euo pipefail

log() { echo "$@" >&2; }

log "--- installed runtimes ---"
xcrun simctl list runtimes >&2 || true

newest_available_iphone() {
    xcrun simctl list devices available --json | python3 -c '
import json, re, sys

devices = json.load(sys.stdin)["devices"]

def version(runtime_key):
    match = re.search(r"iOS-(\d+)-(\d+)", runtime_key)
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)

best = None
for runtime, entries in devices.items():
    if "iOS" not in runtime:
        continue
    for device in entries:
        if not device.get("isAvailable"):
            continue
        if "iPhone" not in device.get("name", ""):
            continue
        candidate = (version(runtime), device["name"], device["udid"])
        if best is None or candidate[0] > best[0]:
            best = candidate

print(best[2] if best else "")
'
}

newest_ios_runtime() {
    xcrun simctl list runtimes --json | python3 -c '
import json, sys

runtimes = [
    r for r in json.load(sys.stdin)["runtimes"]
    if r.get("isAvailable") and "iOS" in r.get("identifier", "")
]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".") if p.isdigit()])
print(runtimes[-1]["identifier"] if runtimes else "")
'
}

newest_iphone_devicetype() {
    xcrun simctl list devicetypes --json | python3 -c '
import json, sys

types = [
    d for d in json.load(sys.stdin)["devicetypes"]
    if "iPhone" in d.get("name", "")
]
print(types[-1]["identifier"] if types else "")
'
}

udid="$(newest_available_iphone)"

if [[ -z "${udid}" ]]; then
    log "No iPhone simulator on this image; creating one."
    runtime="$(newest_ios_runtime)"
    devicetype="$(newest_iphone_devicetype)"

    if [[ -z "${runtime}" || -z "${devicetype}" ]]; then
        log "error: no usable iOS runtime or iPhone device type on this image"
        log "--- device types ---"
        xcrun simctl list devicetypes >&2 || true
        exit 1
    fi

    log "Creating ${devicetype} on ${runtime}"
    udid="$(xcrun simctl create ci-iphone "${devicetype}" "${runtime}")"
fi

log "Using simulator ${udid}"
# Booting is not strictly required for `xcodebuild test`, but a warm simulator
# avoids a cold-boot timeout on the first test run.
xcrun simctl boot "${udid}" >/dev/null 2>&1 || true

echo "platform=iOS Simulator,id=${udid}"
