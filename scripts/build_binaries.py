from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    command = ["node", str(PROJECT_ROOT / "scripts" / "build-server-binary.mjs"), *sys.argv[1:]]
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


if __name__ == "__main__":
    main()
