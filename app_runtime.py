from __future__ import annotations

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
BUNDLE_DIR_ENV = "OPENAI_REGISTER_BUNDLE_DIR"
RUNTIME_DIR_ENV = "OPENAI_REGISTER_RUNTIME_DIR"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def get_bundle_dir() -> Path:
    bundle_override = os.environ.get(BUNDLE_DIR_ENV, "").strip()
    if bundle_override:
        return Path(bundle_override).expanduser().resolve()
    if is_frozen():
        bundle_dir = getattr(sys, "_MEIPASS", None)
        if bundle_dir:
            return Path(bundle_dir).resolve()
        return Path(sys.executable).resolve().parent
    return PROJECT_ROOT


def get_runtime_dir() -> Path:
    runtime_override = os.environ.get(RUNTIME_DIR_ENV, "").strip()
    if runtime_override:
        resolved = Path(runtime_override).expanduser().resolve()
        resolved.mkdir(parents=True, exist_ok=True)
        return resolved
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return PROJECT_ROOT


def get_state_dir(app_name: str) -> Path:
    runtime_dir = get_runtime_dir()
    if not is_frozen() or sys.platform == "win32":
        return runtime_dir

    override = os.environ.get("OPENAI_REGISTER_STATE_DIR")
    if override:
        return Path(override).expanduser().resolve()

    if sys.platform == "darwin":
        return (Path.home() / "Library" / "Application Support" / app_name).resolve()

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return (Path(xdg_data_home).expanduser() / app_name).resolve()
    return (Path.home() / ".local" / "share" / app_name).resolve()


def resolve_input_path(path: str, app_name: str) -> Path:
    raw_value = str(path or "").strip()
    if not raw_value:
        return get_state_dir(app_name)
    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate

    for base_dir in (get_runtime_dir(), get_bundle_dir(), get_state_dir(app_name)):
        resolved = base_dir / candidate
        if resolved.exists():
            return resolved
    return get_state_dir(app_name) / candidate


def resolve_output_path(path: str, app_name: str) -> Path:
    raw_value = str(path or "").strip()
    base_dir = get_state_dir(app_name)
    if not raw_value:
        return base_dir
    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate
    return base_dir / candidate


def ensure_parent_dir(path: str | Path) -> None:
    Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
