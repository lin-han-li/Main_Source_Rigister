from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PLATFORM_MAP = {
    "windows": "win",
    "linux": "linux",
    "macos": "mac",
}


def normalize_args(argv: list[str]) -> list[str]:
    normalized: list[str] = []
    index = 0

    while index < len(argv):
        token = argv[index]
        if token == "--platform" and index + 1 < len(argv):
            value = argv[index + 1].strip().lower()
            normalized.extend(["--target", PLATFORM_MAP.get(value, value)])
            index += 2
            continue

        normalized.append(token)
        index += 1

    return normalized


def main() -> None:
    forwarded_args = normalize_args(sys.argv[1:])
    command = ["node", str(PROJECT_ROOT / "scripts" / "build-desktop.mjs"), *forwarded_args]
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


if __name__ == "__main__":
    main()
