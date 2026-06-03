#!/usr/bin/env python3
"""Audit Python source against project conventions.

Runs every class in AUDITS; exits 0 if all clean, 1 on any violation.

Usage: python-guidelines-audit.py [--verbose]
"""

import argparse
import ast
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class CrossPackageImportAudit:
    """Cross-package imports must use the package root; deeper paths forbidden.

    Exemptions: `claudebox.constants`, `claudebox.extensions.<subpackage>`.
    Intra-package imports unrestricted. Only `src/` is walked — tests/e2e are exempt.
    """

    FIRST_PARTY = frozenset(
        {"claudebox", "claudebox_cli", "claudebox_container_api", "claudebox_daemon"}
    )
    EXCLUDED_DIR_PARTS = frozenset(
        {".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules"}
    )

    def __init__(self, root: Path):
        self._root = root
        self._src = root / "src"

    def run(self, *, verbose: bool) -> int:
        """Print violations to stdout; return total count."""

        total = 0
        files_checked = 0

        for path in sorted(self._iter_files()):
            files_checked += 1
            for line, text in self._audit_file(path):
                total += 1
                rel = path.relative_to(self._root)
                print(f"{rel}:{line}: {text}")

        if verbose or total:
            print(f"--- {files_checked} files checked, {total} cross-package submodule import(s)")

        return total

    def _owning_package(self, file_path: Path) -> str | None:
        """Return the first-party package owning this file (None for entrypoint scripts in src/)."""

        rel = file_path.relative_to(self._src)
        head = rel.parts[0]
        return head if head in self.FIRST_PARTY else None

    def _is_exempt(self, parts: list[str]) -> bool:
        """Whether this module path is an allowed cross-package deep import."""

        # claudebox.constants — shared canonical constants
        if parts[:2] == ["claudebox", "constants"]:
            return True

        # claudebox.extensions.<subpackage> — each extension is its own root surface
        if len(parts) == 3 and parts[:2] == ["claudebox", "extensions"]:
            return True

        return False

    def _is_violation(self, module: str, source_pkg: str | None) -> bool:
        """Whether `from module import …` from source_pkg violates the boundary rule."""

        parts = module.split(".")
        head = parts[0]

        if head not in self.FIRST_PARTY:
            return False

        if head == source_pkg:
            return False

        if len(parts) == 1:
            return False

        if self._is_exempt(parts):
            return False

        return True

    def _audit_file(self, path: Path) -> list[tuple[int, str]]:
        """Return (line, import_text) tuples for every violation in this file."""

        source_pkg = self._owning_package(path)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found: list[tuple[int, str]] = []

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.level > 0:
                    continue
                module = node.module or ""
                if self._is_violation(module, source_pkg):
                    names = ", ".join(a.name for a in node.names)
                    found.append((node.lineno, f"from {module} import {names}"))
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if self._is_violation(alias.name, source_pkg):
                        found.append((node.lineno, f"import {alias.name}"))

        return found

    def _iter_files(self) -> list[Path]:
        """Yield every .py file under src/, skipping venvs and caches."""

        return [
            path
            for path in self._src.rglob("*.py")
            if not any(part in self.EXCLUDED_DIR_PARTS for part in path.parts)
        ]


AUDITS = [CrossPackageImportAudit]


def main() -> int:
    """Parse args, run every audit in AUDITS, return shell exit code."""

    parser = argparse.ArgumentParser(
        description="Audit Python source against project conventions.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print file/violation counts even when no violations are found.",
    )
    args = parser.parse_args()

    total_violations = 0

    for audit_class in AUDITS:
        audit = audit_class(ROOT)
        total_violations += audit.run(verbose=args.verbose)

    return 1 if total_violations else 0


if __name__ == "__main__":
    sys.exit(main())
