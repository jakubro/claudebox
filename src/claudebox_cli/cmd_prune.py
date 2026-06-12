"""Handler for the ``prune`` verb - remove stopped containers, dangling images, stale dirs."""

import argparse
import subprocess

from claudebox import Config, cleanup_stale_dirs, console
from ._term import print_fail


NAME = "prune"
ORDER = 50
DESCRIPTION = "Remove stopped containers, dangling images, stale dirs"
EPILOG = """\
examples:
  claudebox prune                summary count only
  claudebox -v prune             list each removed item

prune removes:
  - stale session and temp directories under ~/.claudebox and /tmp
  - dangling claudebox container images
  - stopped claudebox containers (typically none under auto-removal)

partial failure: each removal is independent; a failure in one category does
not abort the rest. Command exits non-zero if any item failed.
"""


# Backend prune invocations: (label, runtime subcommand list).
_PRUNE_OPS: list[tuple[str, list[str]]] = [
    ("dangling images", ["image", "prune", "-f", "--filter", "label=app=claudebox"]),
    ("stopped containers", ["container", "prune", "-f", "--filter", "label=app=claudebox"]),
]


def handle(args: argparse.Namespace) -> int:
    """Run prune, reporting per-category counts. Partial failure -> exit 1."""

    verbose: bool = args.verbose
    config = Config.load()
    backend = config.backend

    failures: list[str] = []

    dir_count = _prune_stale_dirs(config, verbose, failures)
    image_count = _prune_backend(backend, _PRUNE_OPS[0], verbose, failures)
    container_count = _prune_backend(backend, _PRUNE_OPS[1], verbose, failures)

    _print_summary(verbose, container_count, image_count, dir_count)

    return 1 if failures else 0


def _prune_stale_dirs(config: Config, verbose: bool, failures: list[str]) -> int:
    """Remove stale session/temp dirs; return count removed."""

    try:
        removed = cleanup_stale_dirs(config)
    except OSError as exc:
        failures.append("stale dirs")
        print_fail(f"stale dirs: {exc}")

        return 0

    if verbose:
        for path in removed:
            console.print(f"removed dir {path}", style="dim italic")

    return len(removed)


def _prune_backend(
    backend_name: str,
    op: tuple[str, list[str]],
    verbose: bool,
    failures: list[str],
) -> int:
    """Run a single runtime prune subcommand; return count of removed items."""

    label, subcommand_args = op

    try:
        result = subprocess.run(
            [backend_name, *subcommand_args],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        failures.append(label)
        print_fail(f"{label}: {exc}")

        return 0

    removed_lines = _parse_prune_output(result.stdout)

    if verbose:
        for line in removed_lines:
            console.print(f"removed {label.rstrip('s')} {line}", style="dim italic")

    return len(removed_lines)


def _parse_prune_output(stdout: str) -> list[str]:
    """Extract removed-item identifiers from runtime prune stdout."""

    skipped_prefixes = ("Deleted Images:", "Total reclaimed", "Deleted Containers:")

    return [
        line.strip()
        for line in stdout.splitlines()
        if line.strip() and not line.startswith(skipped_prefixes)
    ]


def _print_summary(verbose: bool, container_count: int, image_count: int, dir_count: int) -> None:
    """Print summary line(s) for the prune run."""

    if verbose:
        console.print(
            f"removed {container_count} stopped containers, "
            f"{image_count} dangling images, "
            f"{dir_count} stale dirs"
        )

        return

    console.print(f"removed {container_count} stopped containers")
    console.print(f"removed {image_count} dangling images")
    console.print(f"removed {dir_count} stale session/temp dirs")
