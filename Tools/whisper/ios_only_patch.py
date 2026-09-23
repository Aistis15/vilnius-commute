#!/usr/bin/env python3
"""Reduce whisper.cpp's build-xcframework.sh to the iOS slices only.

Why this exists
---------------
Upstream's script unconditionally builds seven platform slices: iOS device,
iOS simulator, macOS, visionOS, visionOS simulator, tvOS and tvOS simulator.
There is no flag to narrow that down.

Two problems follow. The GitHub Actions macOS 26 runner image ships iOS, macOS,
tvOS and watchOS SDKs but *not* visionOS, so the unmodified script fails
outright. And even if it did not, building five slices this app will never load
would multiply an already slow build.

So the script is rewritten before it runs, deterministically, by dropping every
non-iOS block. The transformation is asserted at the end: if upstream ever
restructures the script such that these markers no longer match, this exits
non-zero instead of silently producing a half-patched script.

Usage:  python3 ios_only_patch.py build-xcframework.sh
Edits the file in place.
"""

from __future__ import annotations

import re
import sys

KEEP = ("build-ios-sim", "build-ios-device")
DROP_BUILDS = (
    "build-macos",
    "build-visionos",
    "build-visionos-sim",
    "build-tvos-sim",
    "build-tvos-device",
)


def patch(text: str) -> str:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]

        # 1. Whole cmake block for a platform we do not ship.
        #    Starts at `echo "Building for <platform>..."` and ends at the
        #    matching `cmake --build <dir> ...` line.
        match = re.match(r'\s*echo "Building for ([^"]+)\.\.\."', line)
        if match and not _is_ios(match.group(1)):
            index = _skip_to_end_of_build_block(lines, index)
            continue

        # 2. Per-platform helper calls.
        if re.match(r"\s*(setup_framework_structure|combine_static_libraries)\s", line):
            if any(d in line for d in DROP_BUILDS):
                index += 1
                continue

        # 3. -framework / -debug-symbols continuation lines inside
        #    `xcodebuild -create-xcframework`.
        if re.match(r"\s*-(framework|debug-symbols)\s", line):
            if any(d in line for d in DROP_BUILDS):
                index += 1
                continue

        # 4. Up-front `rm -rf build-<platform>` cleanup for directories that
        #    are now never created. Harmless to leave, but dropping them lets
        #    the verification below stay strict.
        if re.match(r"\s*rm -rf\s", line):
            if any(re.search(rf"{re.escape(d)}\b", line) for d in DROP_BUILDS):
                index += 1
                continue

        out.append(line)
        index += 1

    result = "".join(out)
    _verify(result)
    return result


def _is_ios(platform_label: str) -> bool:
    """True for 'iOS simulator' / 'iOS devices', false for visionOS/tvOS/macOS.

    Checked as a word so that 'visionOS' does not match on the 'OS' suffix.
    """
    lowered = platform_label.lower()
    return lowered.startswith("ios")


def _skip_to_end_of_build_block(lines: list[str], start: int) -> int:
    """Index just past this block's `cmake --build <dir>` line."""
    index = start + 1
    while index < len(lines):
        if re.match(r"\s*cmake --build\s", lines[index]):
            return index + 1
        # Do not run past the start of the next block: if the expected
        # terminator is missing, stopping early is safer than eating the file.
        if re.match(r'\s*echo "Building for ', lines[index]):
            return index
        index += 1
    return index


def _verify(result: str) -> None:
    """Fail loudly rather than emit a half-patched script."""
    problems = []

    for dropped in DROP_BUILDS:
        # `build-ios-sim` contains no dropped name, but `build-visionos-sim`
        # contains `build-visionos`, so compare on word boundaries.
        if re.search(rf"{re.escape(dropped)}\b", result):
            problems.append(f"still references {dropped}")

    for kept in KEEP:
        if kept not in result:
            problems.append(f"lost {kept}")

    if "-create-xcframework" not in result:
        problems.append("lost the -create-xcframework invocation")

    if problems:
        raise SystemExit(
            "ios_only_patch.py: upstream script no longer matches expectations:\n  - "
            + "\n  - ".join(problems)
            + "\nInspect build-xcframework.sh at the pinned tag and update this patch."
        )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: ios_only_patch.py <path-to-build-xcframework.sh>")

    path = sys.argv[1]
    with open(path, encoding="utf-8") as handle:
        original = handle.read()

    patched = patch(original)

    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(patched)

    removed = len(original.splitlines()) - len(patched.splitlines())
    print(f"ios_only_patch.py: removed {removed} lines; iOS device + simulator only.")


if __name__ == "__main__":
    main()
