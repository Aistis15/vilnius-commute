#!/usr/bin/env bash
#
# Builds whisper.xcframework (iOS device + simulator) into Vendor/.
#
# Runs on a macOS CI runner. whisper.cpp dropped its Package.swift and ships no
# prebuilt binaries, so the framework has to be compiled from source — there is
# no SPM or release-asset shortcut. Both facts were checked against the repo at
# the pinned tag before this was written.
#
# The result is cached by CI on the pinned tag + the hash of this directory,
# so this full build happens once and is restored in seconds afterwards.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tools_dir="${repo_root}/Tools/whisper"
vendor_dir="${repo_root}/Vendor"
work_dir="${repo_root}/.build/whisper"

tag="$(tr -d '[:space:]' < "${tools_dir}/whisper-version.txt")"
if [[ -z "${tag}" ]]; then
    echo "error: Tools/whisper/whisper-version.txt is empty" >&2
    exit 1
fi

echo "==> whisper.cpp ${tag}"

if [[ -d "${vendor_dir}/whisper.xcframework" ]]; then
    echo "==> Vendor/whisper.xcframework already present, nothing to do."
    exit 0
fi

rm -rf "${work_dir}"
mkdir -p "${work_dir}"

echo "==> Cloning"
git clone --depth 1 --branch "${tag}" \
    https://github.com/ggml-org/whisper.cpp.git "${work_dir}/whisper.cpp"

cd "${work_dir}/whisper.cpp"

echo "==> Restricting the build to iOS"
# Upstream always builds seven platform slices, including visionOS, whose SDK
# is not on the GitHub macOS runner image. The patch script asserts its own
# result and exits non-zero if upstream has been restructured.
python3 "${tools_dir}/ios_only_patch.py" build-xcframework.sh
bash -n build-xcframework.sh

echo "==> Building (this is the slow part)"
chmod +x build-xcframework.sh
./build-xcframework.sh

built="${work_dir}/whisper.cpp/build-apple/whisper.xcframework"
if [[ ! -d "${built}" ]]; then
    echo "error: expected ${built} but it was not produced" >&2
    exit 1
fi

echo "==> Installing into Vendor/"
mkdir -p "${vendor_dir}"
rm -rf "${vendor_dir}/whisper.xcframework"
cp -R "${built}" "${vendor_dir}/whisper.xcframework"

# Fail here rather than deep inside the app link step if the slices are wrong.
echo "==> Verifying slices"
plist="${vendor_dir}/whisper.xcframework/Info.plist"
# Read the identifiers whole. A character-class grep truncates
# `ios-arm64_x86_64-simulator` at the hyphen and makes the simulator slice look
# missing when it is present.
identifiers="$(/usr/libexec/PlistBuddy -c 'Print :AvailableLibraries' "${plist}" \
    | awk '/LibraryIdentifier/ { print $3 }')"
echo "${identifiers}"

if ! grep -qx 'ios-arm64' <<< "${identifiers}"; then
    echo "error: no ios-arm64 device slice in the built xcframework" >&2
    exit 1
fi
if ! grep -q -- '-simulator$' <<< "${identifiers}"; then
    echo "error: no iOS simulator slice in the built xcframework" >&2
    exit 1
fi

echo "==> Done: ${vendor_dir}/whisper.xcframework"
du -sh "${vendor_dir}/whisper.xcframework"
