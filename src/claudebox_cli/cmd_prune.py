"""Handler for the ``prune`` verb - remove stopped containers, dangling images, build leftovers, stale dirs."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from rich.markup import escape

from claudebox import Config, cleanup_stale_dirs, console
from ._term import print_fail, print_info


NAME = "prune"
ORDER = 50
DESCRIPTION = "Remove stopped containers, dangling images, build leftovers, stale dirs"
EPILOG = """\
Examples:
  claudebox prune                summary count only
  claudebox -v prune             list each removed item

Removes:
  stale session directories of every registered workspace, ~/.claudebox and the current one
  what an idle session's /tmp holds, keeping the session
  stale temp directories under /tmp
  dangling claudebox container images
  leftovers of interrupted claudebox image builds (podman; skipped while a build runs)
  stopped claudebox containers (typically none under auto-removal)

Notes:
  Each removal is independent: a failure in one category does not abort the rest.
  A session whose container runs, or that is pinned, is never touched.
  A workspace whose sessions cannot be swept is named; the others are still swept.
  A registered workspace whose directory no longer exists is skipped with a note.
  With the local backend only stale directories are pruned; there is no container runtime.
  The command exits non-zero if any item failed.
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

    dir_count, emptied = _prune_stale_dirs(config, verbose, failures)

    if backend == "local":
        console.print(f"removed {dir_count} stale session/temp dirs")
        console.print(_emptied_line(emptied))
        console.print("containers, images and build leftovers do not apply to the local backend")

        return 1 if failures else 0

    # Before the image prune, so the images a removed leftover held are dangling by then.
    leftover_count = _prune_build_leftovers(backend, verbose, failures)
    image_count = _prune_backend(backend, _PRUNE_OPS[0], verbose, failures)
    container_count = _prune_backend(backend, _PRUNE_OPS[1], verbose, failures)

    _print_summary(verbose, container_count, image_count, leftover_count, dir_count)
    console.print(_emptied_line(emptied))

    return 1 if failures else 0


def _prune_stale_dirs(
    config: Config,
    verbose: bool,
    failures: list[str],
) -> tuple[int, dict[Path, int]]:
    """Remove stale dirs and empty idle tmp/ folders; return the removed count and bytes freed each."""

    report = cleanup_stale_dirs(config)

    for root in report.missing:
        print_info(f"skipped {escape(str(root))}: the registered workspace no longer exists")

    for root, reason in report.failed.items():
        failures.append("stale dirs")
        print_fail(f"stale dirs: {escape(str(root))}: {escape(reason)}")

    if verbose:
        for path in report.removed:
            console.print(f"removed dir {path}", style="dim italic")

        for path, freed in report.emptied.items():
            console.print(f"emptied {path} (freed {_format_bytes(freed)})", style="dim italic")

    return len(report.removed), report.emptied


def _emptied_line(emptied: dict[Path, int]) -> str:
    return (
        f"emptied {len(emptied)} session /tmp folders, freed {_format_bytes(sum(emptied.values()))}"
    )


def _format_bytes(count: int) -> str:
    size = float(count)

    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{count} B" if unit == "B" else f"{size:.1f} {unit}"

        size /= 1024

    return f"{size:.1f} TB"


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
        print_fail(f"{label}: {_describe_failure(exc)}")

        return 0

    removed_lines = _parse_prune_output(result.stdout)

    if verbose:
        for line in removed_lines:
            console.print(f"removed {label.rstrip('s')} {line}", style="dim italic")

    return len(removed_lines)


def _prune_build_leftovers(backend_name: str, verbose: bool, failures: list[str]) -> int | None:
    """Remove what interrupted claudebox builds left behind; ``None`` while a build holds the lock.

    Podman cannot tell a running build's working container from an orphan, so the lock spans the sweep.
    """

    from claudebox import no_build_running

    if backend_name != "podman":
        return 0

    label = "build leftovers"

    with no_build_running() as free:
        if not free:
            return None

        try:
            listing = _run([backend_name, "ps", "--all", "--external", "--format", "json"])
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            failures.append(label)
            print_fail(f"{label}: {_describe_failure(exc)}")

            return 0

        builds = [c for c in json.loads(listing) if c["Command"] == ["buildah"]]
        ours = {
            image
            for image in {c["ImageID"] for c in builds}
            if _is_claudebox_image(backend_name, image)
        }
        removed = 0

        for container in builds:
            if container["ImageID"] not in ours:
                continue

            try:
                _run([backend_name, "rm", "--force", container["Id"]])
            except subprocess.CalledProcessError as exc:
                failures.append(label)
                print_fail(f"build leftover {container['Id']}: {_describe_failure(exc)}")

                continue

            removed += 1

            if verbose:
                console.print(f"removed build leftover {container['Id']}", style="dim italic")

    return removed


def _is_claudebox_image(backend_name: str, image_id: str) -> bool:
    """Whether the image carries the claudebox label; an image that no longer exists does not."""

    try:
        app = _run(
            [backend_name, "image", "inspect", image_id, "--format", '{{index .Labels "app"}}'],
        )
    except subprocess.CalledProcessError:
        return False

    return app.strip() == "claudebox"


def _run(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def _describe_failure(exc: subprocess.CalledProcessError | FileNotFoundError) -> str:
    """Render a runtime failure with the runtime's own words, not just Python's.

    Bare Python text ("exit status 125") cannot tell a still-referenced image from a bad filter.
    Escaped: print_fail interpolates into Rich markup, so a bracket reads as a style tag or raises MarkupError.
    """

    if isinstance(exc, FileNotFoundError):
        return escape(str(exc))

    stderr = escape((exc.stderr or "").strip())

    if not stderr:
        return f"exit status {exc.returncode}"

    return f"exit status {exc.returncode}: {stderr}"


def _parse_prune_output(stdout: str) -> list[str]:
    """Extract removed-item identifiers from runtime prune stdout."""

    skipped_prefixes = ("Deleted Images:", "Total reclaimed", "Deleted Containers:")

    return [
        line.strip()
        for line in stdout.splitlines()
        if line.strip() and not line.startswith(skipped_prefixes)
    ]


def _print_summary(
    verbose: bool,
    container_count: int,
    image_count: int,
    leftover_count: int | None,
    dir_count: int,
) -> None:
    """Print summary line(s) for the prune run; a ``None`` leftover count reads as skipped."""

    if leftover_count is None:
        leftovers = "build leftovers skipped (a claudebox build is running)"
    else:
        leftovers = f"{leftover_count} build leftovers"

    if verbose:
        console.print(
            f"removed {container_count} stopped containers, "
            f"{image_count} dangling images, "
            f"{leftovers}, "
            f"{dir_count} stale dirs",
        )

        return

    console.print(f"removed {container_count} stopped containers")
    console.print(f"removed {image_count} dangling images")
    console.print(leftovers if leftover_count is None else f"removed {leftovers}")
    console.print(f"removed {dir_count} stale session/temp dirs")
