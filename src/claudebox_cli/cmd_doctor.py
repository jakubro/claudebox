"""Handler for the ``doctor`` verb - diagnose environment readiness."""

import argparse
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import httpx
from rich.console import Console

from claudebox import Config
from claudebox.constants import (
    DAEMON_PORT,
    WORKSPACE_MARKER,
    daemon_base_url,
    global_config_dir,
    profile_dir,
)


NAME = "doctor"
ORDER = 80
DESCRIPTION = "Diagnose environment"
EPILOG = """\
examples:
  claudebox doctor               run all environment checks
  claudebox -v doctor            show the probe command behind each check

doctor runs these checks in order, printing one row each:
  runtime, runtime info, uv, daemon http, daemon unit, ~/.claudebox/lib,
  profile, workspace (.workspace marker), permissions, disk (/tmp free)

icons:
  ✓ pass    ✗ fail    ○ informational (no profile, no workspace marker)

exit code is 1 if any check failed, 0 otherwise.
"""


_LABEL_WIDTH = 17  # padded to the longest label ('~/.claudebox/lib')
_HTTP_TIMEOUT_SECONDS = 2.0
_SUBPROCESS_TIMEOUT_SECONDS = 5
_DISK_MIN_BYTES = 1 * 1024**3  # 1 GiB threshold for /tmp disk check


# Doctor writes informational output to stdout so `claudebox doctor` is pipeable;
# the framework's shared ``console`` targets stderr (for status output).
_stdout = Console()


@dataclass
class _CheckResult:
    """One check's outcome: icon, label, detail string, and probe command for -v."""

    icon: str
    label: str
    detail: str
    command: str


def handle(args: argparse.Namespace) -> int:
    """Run the 9 ordered environment checks and aggregate exit code."""

    verbose: bool = args.verbose
    backend = Config.load().backend

    results = [
        _check_runtime_version(backend),
        _check_runtime_info(backend),
        _check_uv(),
        _check_daemon_http(),
        _check_daemon_unit(),
        _check_claudebox_lib(),
        _check_profile(),
        _check_workspace_marker(),
        _check_permissions(),
        _check_disk(),
    ]

    for result in results:
        _print_result(result, verbose=verbose)

    failures = sum(1 for r in results if r.icon == "✗")

    if failures:
        _stdout.print(f"{failures} check{'s' if failures != 1 else ''} failed.")

        return 1

    _stdout.print("all checks passed.")

    return 0


def _print_result(result: _CheckResult, *, verbose: bool) -> None:
    """Render one check row plus optional probe-command line under -v."""

    label = f"{result.label:<{_LABEL_WIDTH}}"
    color = {"✓": "green", "✗": "red", "○": "dim"}[result.icon]
    _stdout.print(f"[{color}]{result.icon}[/{color}] {label}{result.detail}")

    if verbose:
        _stdout.print(f"  [dim]-> {result.command}[/dim]")


def _check_runtime_version(backend: str) -> _CheckResult:
    """``<backend> --version`` - surface the version string or mark missing."""

    command = f"{backend} --version"
    output = _run_capture([backend, "--version"])

    if output is None:
        return _CheckResult("✗", "runtime", "(not found)", command)

    # Runtimes print "<backend> version X.Y.Z"; the trailing token is the version.
    parts = output.split()
    version = parts[-1] if parts else "(unknown)"

    return _CheckResult("✓", "runtime", f"{backend} {version}", command)


def _check_runtime_info(backend: str) -> _CheckResult:
    """``<backend> info`` - sanity-check daemon-less inspection works."""

    command = f"{backend} info"
    output = _run_capture([backend, "info"])

    if output is None:
        return _CheckResult("✗", "runtime info", "failed", command)

    return _CheckResult("✓", "runtime info", "ok", command)


def _check_uv() -> _CheckResult:
    """``uv --version`` - required for Python dep management."""

    command = "uv --version"
    output = _run_capture(["uv", "--version"])

    if output is None:
        return _CheckResult("✗", "uv", "(not found)", command)

    parts = output.split()
    version = parts[1] if len(parts) >= 2 else parts[-1]

    return _CheckResult("✓", "uv", version, command)


def _check_daemon_http() -> _CheckResult:
    """HTTPS ping to the daemon through Caddy (verify=False - self-signed)."""

    url = f"{daemon_base_url()}/api/workspaces"
    command = f"GET {url}"

    try:
        response = httpx.get(url, verify=False, timeout=_HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError):
        return _CheckResult("✗", "daemon http", "not reachable", command)

    return _CheckResult("✓", "daemon http", f"reachable (localhost:{DAEMON_PORT})", command)


def _check_daemon_unit() -> _CheckResult:
    """systemd --user unit installed and enabled for the daemon."""

    command = "systemctl --user is-enabled claudebox-daemon.service"
    output = _run_capture(["systemctl", "--user", "is-enabled", "claudebox-daemon.service"])

    if output is None or output.strip() != "enabled":
        return _CheckResult("✗", "daemon unit", "not enabled", command)

    return _CheckResult("✓", "daemon unit", "claudebox-daemon.service enabled", command)


def _check_claudebox_lib() -> _CheckResult:
    """``~/.claudebox/lib`` is a reachable symlink or a git checkout."""

    lib = global_config_dir() / "lib"
    command = f"inspect {lib}"

    if lib.is_symlink():
        target = lib.readlink()

        if lib.resolve().exists():
            return _CheckResult("✓", "~/.claudebox/lib", f"symlink -> {target}", command)

        return _CheckResult("✗", "~/.claudebox/lib", f"broken symlink -> {target}", command)
    elif (lib / ".git").exists():
        return _CheckResult("✓", "~/.claudebox/lib", "git repo", command)
    else:
        return _CheckResult("✗", "~/.claudebox/lib", "missing or invalid", command)


def _check_profile() -> _CheckResult:
    """``~/.claudebox/profile`` is informational (○) when absent, ✓ when readable."""

    profile = profile_dir()
    command = f"inspect {profile}"

    if profile.exists() and os.access(profile, os.R_OK):
        return _CheckResult("✓", "profile", str(profile), command)

    return _CheckResult("○", "profile", "no profile configured", command)


def _check_workspace_marker() -> _CheckResult:
    """``.workspace`` walk-up from cwd - informational (○) when not found."""

    cwd = Path.cwd()
    command = f"walk-up {WORKSPACE_MARKER} from {cwd}"

    for parent in [cwd, *cwd.parents]:
        if (parent / WORKSPACE_MARKER).exists():
            return _CheckResult("✓", "workspace", f"{parent} (.workspace found)", command)

    return _CheckResult("○", "workspace", "no .workspace marker found", command)


def _check_permissions() -> _CheckResult:
    """``~/.claudebox/`` and ``/tmp/`` both writable."""

    claudebox = global_config_dir()
    tmp = Path("/tmp")
    command = f"os.access W_OK on {claudebox} and {tmp}"

    claudebox_ok = os.access(claudebox, os.W_OK)
    tmp_ok = os.access(tmp, os.W_OK)

    parts = [
        f"{claudebox} {'writable' if claudebox_ok else 'NOT writable'}",
        f"{tmp} {'writable' if tmp_ok else 'NOT writable'}",
    ]
    icon = "✓" if claudebox_ok and tmp_ok else "✗"

    return _CheckResult(icon, "permissions", ", ".join(parts), command)


def _check_disk() -> _CheckResult:
    """``/tmp`` free space >= 1 GiB."""

    tmp = Path("/tmp")
    command = f"shutil.disk_usage({tmp})"

    try:
        usage = shutil.disk_usage(tmp)
    except OSError:
        return _CheckResult("✗", "disk", f"{tmp} unreadable", command)

    free_gb = usage.free / (1024**3)
    icon = "✓" if usage.free >= _DISK_MIN_BYTES else "✗"

    return _CheckResult(icon, "disk", f"{tmp} {free_gb:.1f} GB free", command)


def _run_capture(args: list[str]) -> str | None:
    """Run a command and return stripped stdout on success, ``None`` on any failure."""

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=True,
            timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None

    return result.stdout.strip()
