#!/usr/bin/env bash
#
# Builds the Mac kit: an Xcode project that a free Apple ID signs on a
# borrowed Mac, so the app AND its widget extension get their own profiles
# (Sideloadly could not sign the extension, D12 in docs/decisions.md).
#
# Usage: build_mac_kit.sh <simulator destination>
#
# Output: artifacts/VilniusCommute-Mac.zip, holding
#   VilniusCommute-Mac/
#     VilniusCommute.xcodeproj    generated from Tools/ci/mac-kit/project-kit.yml
#     App/ Core/ Widgets/ Shared/ Tests/ Config/   every folder it references
#     Vendor/whisper.xcframework
#     project.yml project-kit.yml (to regenerate it with XcodeGen)
#     KAIP-ĮDIEGTI.txt            the steps, in Lithuanian
#
# The kit's project is then built for the simulator with signing off, so a
# kit that would not even compile fails CI instead of failing on the Mac.

set -euo pipefail

destination="${1:?usage: build_mac_kit.sh <simulator destination>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

staging_root="${repo_root}/build/mac-kit"
kit="${staging_root}/VilniusCommute-Mac"
output="${repo_root}/artifacts"
zip_path="${output}/VilniusCommute-Mac.zip"

if [[ ! -d Vendor/whisper.xcframework ]]; then
    echo "error: Vendor/whisper.xcframework is missing; build it first" >&2
    exit 1
fi

rm -rf "${staging_root}"
mkdir -p "${kit}/Vendor" "${output}"

echo "==> Copying sources"
for folder in App Core Widgets Shared Tests Config; do
    cp -R "${folder}" "${kit}/${folder}"
done
cp -R Vendor/whisper.xcframework "${kit}/Vendor/"
cp project.yml "${kit}/project.yml"
cp Tools/ci/mac-kit/project-kit.yml "${kit}/project-kit.yml"
cp "Tools/ci/mac-kit/KAIP-ĮDIEGTI.txt" "${kit}/KAIP-ĮDIEGTI.txt"
# Files XcodeGen wrote for the CI build: the kit writes its own.
rm -f "${kit}/App/Supporting/Info.plist" "${kit}/App/Supporting/VilniusCommute.entitlements" \
      "${kit}/Widgets/Supporting/Info.plist" "${kit}/Widgets/Supporting/VilniusCommuteWidgets.entitlements"

echo "==> Generating the kit's project"
( cd "${kit}" && xcodegen generate --spec project-kit.yml )

# An entitlements file the project names must exist, even an empty one.
for entitlements in App/Supporting/VilniusCommute.entitlements \
                    Widgets/Supporting/VilniusCommuteWidgets.entitlements; do
    if [[ ! -f "${kit}/${entitlements}" ]]; then
        echo "    writing empty ${entitlements}"
        cat > "${kit}/${entitlements}" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
    fi
done

echo "==> What the kit will sign with"
settings="$(xcodebuild -showBuildSettings -project "${kit}/VilniusCommute.xcodeproj" \
              -scheme VilniusCommute -configuration Debug 2>/dev/null || true)"
grep -E '^\s*(CODE_SIGN_STYLE|CODE_SIGNING_ALLOWED|CODE_SIGN_IDENTITY|PRODUCT_BUNDLE_IDENTIFIER|CODE_SIGN_ENTITLEMENTS) =' \
    <<< "${settings}" | sort -u || true

echo "==> Entitlements in the kit (no time-sensitive allowed)"
for entitlements in App/Supporting/VilniusCommute.entitlements \
                    Widgets/Supporting/VilniusCommuteWidgets.entitlements; do
    echo "--- ${entitlements}"
    cat "${kit}/${entitlements}"
    if grep -q 'time-sensitive' "${kit}/${entitlements}"; then
        echo "error: ${entitlements} asks for Time Sensitive Notifications, which a free account cannot have" >&2
        exit 1
    fi
done

if ! grep -qE 'whisper\.xcframework in Embed Frameworks.*CodeSignOnCopy'         "${kit}/VilniusCommute.xcodeproj/project.pbxproj"; then
    echo "error: whisper.framework is not signed on copy in the kit's project" >&2
    exit 1
fi

echo "==> Building the kit for the simulator (signing off)"
set -o pipefail
xcodebuild build \
    -project "${kit}/VilniusCommute.xcodeproj" \
    -scheme VilniusCommute \
    -configuration Debug \
    -destination "${destination}" \
    -derivedDataPath "${repo_root}/build/dd-mac-kit" \
    CODE_SIGNING_ALLOWED=NO \
    | xcbeautify --quieter

echo "==> Packaging"
rm -f "${zip_path}"
( cd "${staging_root}" && zip -qry "${zip_path}" VilniusCommute-Mac -x '*.DS_Store' )
du -h "${zip_path}"
unzip -l "${zip_path}" | tail -n 1
