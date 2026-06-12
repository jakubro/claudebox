"""Filesystem utilities."""

import contextlib
import shutil
import tempfile
from collections.abc import Iterable, Iterator
from pathlib import Path

from pathspec import PathSpec


def walk_up(start_dir: str | Path | None = None) -> Iterable[Path]:
    """Yield directories from start_dir (default cwd) up to filesystem root."""

    directory: Path = Path(start_dir) if start_dir else Path.cwd()

    while True:
        directory = directory.resolve()
        yield directory

        if directory == directory.parent:
            break
        else:
            directory = directory.parent


def touch_dir(path: str | Path) -> Path:
    """Create directory and parents if needed, return Path."""

    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)

    return path


def touch_file(path: str | Path) -> Path:
    """Create file and parent directories if needed, return Path."""

    path = Path(path)
    touch_dir(path.parent)
    path.touch()

    return path


def resolve_path(path: str | Path) -> Path:
    """Expand user (~) and resolve to absolute path."""

    return Path(path).expanduser().resolve()


def remove_path(path: str | Path) -> None:
    """Remove file, symlink (unlinked), or directory (recursive)."""

    path = Path(path)

    try:
        if path.is_symlink() or path.is_file():
            path.unlink()
        else:
            shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


@contextlib.contextmanager
def make_temp_dir(**kwargs) -> Iterator[Path]:
    """Create a temporary directory that auto-cleans on exit.

    If 'dir' is provided, it is created if it doesn't exist.
    Additional kwargs are forwarded to tempfile.TemporaryDirectory.
    """

    parent = kwargs.get("dir")

    if parent:
        touch_dir(parent)

    with tempfile.TemporaryDirectory(**kwargs) as temp:
        yield Path(temp)


# Gitignore-aware walking
# ------------------------------------------------------------------------------------------


def find_files(path: str | Path, filename: str, **kwargs) -> Iterator[Path]:
    """Find files by name in a gitignore-aware walk."""

    for path in walk_filtered(path, **kwargs):
        if path.name == filename:
            yield path


def walk_filtered(
    path: str | Path,
    *,
    ignore_filenames: list[str] | None = None,
    ignore_patterns: list[str] | None = None,
    follow_symlinks: bool = False,
) -> Iterator[Path]:
    """Walk directory tree, pruning paths matched by ignore files.

    Reads ignore files (default: `.gitignore`) at each directory level and
    compiles their patterns into PathSpec matchers. Directories matched by any
    spec are never descended into. Each spec matches paths relative to its own
    directory, mirroring how git and ripgrep handle nested ignore files.
    """

    path = Path(path).resolve()
    ignore_filenames = ignore_filenames or [".gitignore"]

    ignore_patterns = ignore_patterns or []
    ignore_patterns += [".git/"]

    specs = _collect_ignore_specs(path, ignore_filenames)
    specs += [(path, PathSpec.from_lines("gitignore", ignore_patterns))]

    yield from _walk_filtered(
        path,
        specs=specs,
        ignore_filenames=ignore_filenames,
        follow_symlinks=follow_symlinks,
    )


def _walk_filtered(
    cwd: Path,
    *,
    specs: list[tuple[Path, PathSpec]],
    ignore_filenames: list[str],
    follow_symlinks: bool,
) -> Iterator[Path]:
    """Recursively walk, collecting ignore specs per level."""

    # Build specs for this level: parent specs + any new ignore files here
    specs = specs + _collect_ignore_specs(cwd, ignore_filenames=ignore_filenames)

    try:
        entries = sorted(cwd.iterdir())
    except PermissionError:
        return

    for entry in entries:
        if _is_ignored(entry, specs):
            continue

        yield entry

        if not entry.is_dir():
            continue

        if not follow_symlinks and entry.is_symlink():
            continue

        yield from _walk_filtered(
            entry,
            specs=specs,
            ignore_filenames=ignore_filenames,
            follow_symlinks=follow_symlinks,
        )


def _collect_ignore_specs(path: Path, ignore_filenames: list[str]) -> list[tuple[Path, PathSpec]]:
    """Read ignore files in directory and compile into specs."""

    rv = []

    for name in ignore_filenames:
        file = path / name

        if not file.is_file():
            continue

        lines = file.read_text().splitlines()
        spec = PathSpec.from_lines("gitignore", lines)

        rv.append((path, spec))

    return rv


def _is_ignored(path: Path, specs: list[tuple[Path, PathSpec]]) -> bool:
    """Check if path matches any ignore spec."""

    is_dir = path.is_dir()

    for spec_dir, spec in specs:
        try:
            rel = str(path.relative_to(spec_dir))
        except ValueError:
            continue

        # Append / so directory-only patterns (e.g. `dir/`) match correctly
        if is_dir:
            rel = rel.rstrip("/") + "/"

        if spec.match_file(rel):
            return True

    return False
