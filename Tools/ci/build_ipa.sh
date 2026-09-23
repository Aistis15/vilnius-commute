#!/usr/bin/env bash
#
# Builds an unsigned .ipa for sideloading.
#
# Usage: build_ipa.sh <variant>
#   default    - no App Group configured
#   appgroups  - App Group configured, for the capability probe
#
# On entitlements and unsigned builds
# -----------------------------------
# `xcodebuild` only embeds entitlements when it signs, and this build never
# signs. So the .ipa carries no entitlements at all, whichever variant is
# built, and Sideloadly is what decides the final entitlement set when it
# re-signs with the free Apple ID.
#
# That is fine for most of what this app needs, because the capabilities are
# driven by Info.plist rather than entitlements:
#   - Live Activities   -> NSSupportsLiveActivities
#   - AlarmKit          -> NSAlarmKitUsageDescription
#   - Background location -> UIBackgroundModes
#   - Microphone        -> NSMicrophoneUsageDescription
# App Groups is the exception: it is a real entitlement, and it is the one a
# free Apple ID is not expected to be able to provision.
#
# So what the `appgroups` variant actually changes is the Info.plist key the
# probe reads, which tells the app which group to test for once Sideloadly has
# been asked to add it. The entitlements file is passed as well so that a
# properly-signed build would carry it too.

set -euo pipefail

variant="${1:-default}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

app_group="group.com.vilniuscommute.app"
derived="${repo_root}/build/dd-${variant}"
output="${repo_root}/artifacts"

# Never leave this array empty. macOS ships bash 3.2, where expanding an empty
# array as "${arr[@]}" is an unbound-variable error under `set -u`. Giving the
# default variant an explicit no-op override keeps it non-empty.
case "${variant}" in
    default)
        extra_args=( "VC_APP_GROUP=" )
        ;;
    appgroups)
        extra_args=(
            "VC_APP_GROUP=${app_group}"
            "CODE_SIGN_ENTITLEMENTS=Config/AppGroups-App.entitlements"
        )
        ;;
    *)
        echo "error: unknown variant '${variant}' (expected default|appgroups)" >&2
        exit 1
        ;;
esac

mkdir -p "${output}"

echo "==> Building variant: ${variant}"
set -o pipefail
xcodebuild build \
    -project VilniusCommute.xcodeproj \
    -scheme VilniusCommute \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "${derived}" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM="" \
    "${extra_args[@]}" \
    | xcbeautify --quieter

app_path="${derived}/Build/Products/Release-iphoneos/VilniusCommute.app"
if [[ ! -d "${app_path}" ]]; then
    echo "error: build finished but ${app_path} is missing" >&2
    exit 1
fi

echo "==> Checking the app bundle is actually complete"
# A widget extension that silently failed to embed is the classic way for a
# "green" build to produce an .ipa with no Live Activity in it.
extension_path="${app_path}/PlugIns/VilniusCommuteWidgets.appex"
if [[ ! -d "${extension_path}" ]]; then
    echo "error: widget extension not embedded at ${extension_path}" >&2
    ls -la "${app_path}" >&2
    exit 1
fi
if [[ ! -d "${app_path}/Frameworks/whisper.framework" ]]; then
    echo "error: whisper.framework not embedded" >&2
    ls -la "${app_path}/Frameworks" >&2 || true
    exit 1
fi

echo "==> Reported capabilities in the built Info.plist"
/usr/libexec/PlistBuddy -c 'Print :NSSupportsLiveActivities' "${app_path}/Info.plist" || true
/usr/libexec/PlistBuddy -c 'Print :VCAppGroupIdentifier' "${app_path}/Info.plist" || true

echo "==> Packaging .ipa"
staging="$(mktemp -d)"
mkdir -p "${staging}/Payload"
cp -R "${app_path}" "${staging}/Payload/"

ipa="${output}/VilniusCommute-${variant}.ipa"
rm -f "${ipa}"
( cd "${staging}" && zip -qry "${ipa}" Payload )
rm -rf "${staging}"

echo "==> ${ipa}"
du -h "${ipa}"
