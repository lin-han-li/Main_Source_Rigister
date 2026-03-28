from __future__ import annotations

import os
import platform
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class AppConfig:
    id: str
    display_name: str
    binary_name: str
    package_name: str
    entry_script: str
    spec_file: str
    windows_installer_script: str
    windows_launcher: str
    state_dir_name: str


@dataclass(frozen=True)
class ReleaseConfig:
    version: str
    publisher: str
    author_name: str
    author_email: str
    tag_prefix: str
    product_name: str
    linux_maintainer: str
    bundle_files: tuple[str, ...]
    release_guard: tuple[str, ...]
    apps: tuple[AppConfig, ...]


def load_release_config(project_root: Path | None = None) -> ReleaseConfig:
    root = project_root or PROJECT_ROOT
    with (root / "pyproject.toml").open("rb") as handle:
        data = tomllib.load(handle)

    project = data["project"]
    release = data["tool"]["codex_release"]
    author = project["authors"][0]
    apps = tuple(
        AppConfig(
            id=item["id"],
            display_name=item["display_name"],
            binary_name=item["binary_name"],
            package_name=item["package_name"],
            entry_script=item["entry_script"],
            spec_file=item["spec_file"],
            windows_installer_script=item["windows_installer_script"],
            windows_launcher=item["windows_launcher"],
            state_dir_name=item["state_dir_name"],
        )
        for item in release["apps"]
    )
    return ReleaseConfig(
        version=project["version"],
        publisher=release["publisher"],
        author_name=author["name"],
        author_email=author["email"],
        tag_prefix=release["tag_prefix"],
        product_name=release["product_name"],
        linux_maintainer=release["linux_maintainer"],
        bundle_files=tuple(release["bundle_files"]),
        release_guard=tuple(release["release_guard"]),
        apps=apps,
    )


def get_host_platform() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    raise RuntimeError(f"Unsupported host platform: {sys.platform}")


def ensure_host_platform(expected: str) -> None:
    actual = get_host_platform()
    if actual != expected:
        raise RuntimeError(
            f"Refusing to build {expected} packages on {actual}. "
            "Use a native build host or GitHub Actions."
        )


def resolve_python() -> str:
    return os.environ.get("PYTHON_BIN", sys.executable)


def run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    print(f"[run] {' '.join(command)}")
    subprocess.run(command, cwd=cwd or PROJECT_ROOT, env=merged_env, check=True)


def get_architecture() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x64"
    if machine in {"aarch64", "arm64"}:
        return "arm64"
    return machine


def get_binary_suffix(target_platform: str) -> str:
    return ".exe" if target_platform == "windows" else ""


def out_dir(*parts: str) -> Path:
    path = PROJECT_ROOT / "out"
    for part in parts:
        path /= part
    path.mkdir(parents=True, exist_ok=True)
    return path


def stage_dir(*parts: str) -> Path:
    path = PROJECT_ROOT / "out" / "staging"
    for part in parts:
        path /= part
    path.mkdir(parents=True, exist_ok=True)
    return path


def clean_dir(path: Path) -> None:
    if path.exists():
        for child in sorted(path.iterdir(), reverse=True):
            if child.is_dir():
                clean_dir(child)
                child.rmdir()
            else:
                child.unlink()
    else:
        path.mkdir(parents=True, exist_ok=True)


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(source.read_bytes())


def command_output(command: list[str], cwd: Path | None = None) -> str:
    return subprocess.check_output(command, cwd=cwd or PROJECT_ROOT, text=True).strip()


def to_jsonable(config: ReleaseConfig) -> dict[str, Any]:
    return {
        "version": config.version,
        "publisher": config.publisher,
        "author_name": config.author_name,
        "author_email": config.author_email,
        "tag_prefix": config.tag_prefix,
        "product_name": config.product_name,
        "linux_maintainer": config.linux_maintainer,
        "bundle_files": list(config.bundle_files),
        "release_guard": list(config.release_guard),
        "apps": [app.__dict__ for app in config.apps],
    }
