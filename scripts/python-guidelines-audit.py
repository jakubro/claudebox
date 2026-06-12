#!/usr/bin/env python3
"""Audit Python source against project conventions.

Runs every class in AUDITS; exits 0 if all clean, 1 on any violation.

Usage: python-guidelines-audit.py [--verbose]
"""

import argparse
import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _glob_to_regex(glob: str) -> re.Pattern[str]:
    """Compile a POSIX glob to an anchored regex; `**` matches any number of path segments."""

    out = ["^"]
    i, n = 0, len(glob)

    while i < n:
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1

    out.append("$")

    return re.compile("".join(out))


class CrossPackageImportAudit:
    """Cross-package imports must use the package root; deeper paths forbidden.

    Exemptions: `claudebox.constants`, `claudebox.extensions.<subpackage>`.
    Intra-package imports unrestricted. Only `src/` is walked - tests/e2e are exempt.
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

        # claudebox.constants - shared canonical constants
        if parts[:2] == ["claudebox", "constants"]:
            return True

        # claudebox.extensions.<subpackage> - each extension is its own root surface
        elif len(parts) == 3 and parts[:2] == ["claudebox", "extensions"]:
            return True
        else:
            return False

    def _is_violation(self, module: str, source_pkg: str | None) -> bool:
        """Whether `from module import …` from source_pkg violates the boundary rule."""

        parts = module.split(".")
        head = parts[0]

        if head not in self.FIRST_PARTY:
            return False
        elif head == source_pkg:
            return False
        elif len(parts) == 1:
            return False
        elif self._is_exempt(parts):
            return False
        else:
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


class WhitespaceControlFlowAudit:
    """Paragraph separation and dispatch shape per GUIDELINES Whitespace & Control Flow.

    Flags two things: a control block (if/for/while/with/try/match) or a return/raise
    that is not the first statement in its block and is not separated from the
    preceding statement by a blank line; and mutually-exclusive return dispatch
    written as a run of sequential `if cond: ... return` blocks closed by a
    fallthrough return instead of `if`/`elif`/`else`. def/class blank-line spacing
    is ruff's concern and is not checked here. Walks every linted Python root.
    """

    COMPOUND = (
        ast.If,
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.With,
        ast.AsyncWith,
        ast.Try,
        ast.TryStar,
        ast.Match,
    )
    TERM = (ast.Return, ast.Raise)
    DEF = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    SUBDIRS = ("src", "tests", "e2e/cli", "scripts")
    EXCLUDED_DIR_PARTS = frozenset(
        {".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules"}
    )

    def __init__(self, root: Path):
        self._root = root

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
            print(f"--- {files_checked} files checked, {total} whitespace/control-flow issue(s)")

        return total

    def _audit_file(self, path: Path) -> list[tuple[int, str]]:
        """Return (line, message) tuples for every violation in this file."""

        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        lines = source.splitlines()
        found: list[tuple[int, str]] = []
        self._check_body(tree.body, lines, found)

        return found

    def _check_body(
        self, body: list[ast.stmt], lines: list[str], found: list[tuple[int, str]]
    ) -> None:
        """Flag missing paragraph blanks and if-return dispatch runs in one block; recurse."""

        self._check_dispatch(body, found)

        for i, stmt in enumerate(body):
            if i > 0 and not isinstance(stmt, self.DEF):
                prev = body[i - 1]
                paragraphed = (
                    isinstance(prev, self.COMPOUND)
                    or isinstance(stmt, self.COMPOUND)
                    or isinstance(stmt, self.TERM)
                )

                if paragraphed and self._missing_blank(lines, stmt.lineno, stmt.col_offset):
                    found.append(
                        (
                            stmt.lineno,
                            f"missing blank line before `{self._kind(stmt)}` (paragraph separation)",
                        )
                    )

            for sub in self._subbodies(stmt):
                self._check_body(sub, lines, found)

    def _check_dispatch(self, body: list[ast.stmt], found: list[tuple[int, str]]) -> None:
        """Flag a run of >=2 sibling `if cond: ... return` blocks closed by a fallthrough return."""

        n = len(body)
        i = 0

        while i < n:
            stmt = body[i]

            if isinstance(stmt, ast.If) and not stmt.orelse and self._ends_in_return(stmt.body):
                j = i

                while j < n and self._is_return_if(body[j]):
                    j += 1

                if j - i >= 2 and j < n and isinstance(body[j], ast.Return):
                    found.append(
                        (stmt.lineno, "use if/elif/else for mutually-exclusive return dispatch")
                    )

                i = j
            else:
                i += 1

    @staticmethod
    def _ends_in_return(body: list[ast.stmt]) -> bool:
        return bool(body) and isinstance(body[-1], ast.Return)

    @classmethod
    def _is_return_if(cls, node: ast.stmt) -> bool:
        """Whether node is a plain `if` (no elif/else) whose body ends in a return."""

        return isinstance(node, ast.If) and not node.orelse and cls._ends_in_return(node.body)

    @staticmethod
    def _kind(stmt: ast.stmt) -> str:
        """Human label for the offending statement."""

        if isinstance(stmt, ast.Return):
            return "return"
        elif isinstance(stmt, ast.Raise):
            return "raise"
        else:
            return type(stmt).__name__.lower()

    @staticmethod
    def _missing_blank(lines: list[str], lineno: int, col: int) -> bool:
        """Whether the statement at lineno lacks a blank separating it from preceding code."""

        j = lineno - 2

        while (
            j >= 0
            and lines[j].strip().startswith("#")
            and (len(lines[j]) - len(lines[j].lstrip())) == col
        ):
            j -= 1

        if j < 0:
            return False
        elif not lines[j].strip():
            return False
        elif lines[j].rstrip().endswith(":"):
            return False
        else:
            return True

    @staticmethod
    def _subbodies(node: ast.stmt) -> list[list[ast.stmt]]:
        """Every child statement block of a compound node (body / orelse / handlers / cases / finally)."""

        out: list[list[ast.stmt]] = []

        for attr in ("body", "orelse", "finalbody"):
            block = getattr(node, attr, None)

            if isinstance(block, list) and block and isinstance(block[0], ast.stmt):
                out.append(block)

        for handler in getattr(node, "handlers", []) or []:
            if handler.body:
                out.append(handler.body)

        for case in getattr(node, "cases", []) or []:
            if case.body:
                out.append(case.body)

        return out

    def _iter_files(self) -> list[Path]:
        """Yield every .py file under the linted roots, skipping venvs and caches."""

        files: list[Path] = []

        for sub in self.SUBDIRS:
            base = self._root / sub

            if not base.exists():
                continue

            files.extend(
                path
                for path in base.rglob("*.py")
                if not any(part in self.EXCLUDED_DIR_PARTS for part in path.parts)
            )

        return files


class SdkContainmentAudit:
    """External SDK families may only be imported from their adapter files.

    Folds the former ast-grep import-ban rules (banned-claude-sdk-imports,
    banned-langchain-langgraph-imports) into one AST pass. Prefix-pattern matching
    auto-bans every future langchain/langgraph provider package without per-package
    list maintenance. See GUIDELINES.md SDK Containment. Walks src/ and tests/.
    """

    @dataclass(frozen=True)
    class ContainmentRule:
        """One import-containment rule: ban a package family outside an allowlist."""

        name: str
        package_re: re.Pattern[str]
        allowlist: tuple[re.Pattern[str], ...]
        message: str

    SUBDIRS = ("src", "tests")
    EXCLUDED_DIR_PARTS = frozenset(
        {".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules"}
    )

    RULES = (
        ContainmentRule(
            name="claude_agent_sdk",
            package_re=re.compile(r"^claude_agent_sdk($|\.)"),
            allowlist=tuple(
                _glob_to_regex(g)
                for g in (
                    "src/claudebox/agent_session/runtime_claude.py",
                    "tests/claudebox/agent_session/test_runtime_claude.py",
                    "tests/claudebox/agent_session/test_event_translation.py",
                    "tests/claudebox/agent_session/orchestration/test_pipeline.py",
                )
            ),
            message=(
                "Import claude_agent_sdk only from "
                "claudebox/agent_session/runtime_claude.py - see GUIDELINES.md SDK Containment"
            ),
        ),
        ContainmentRule(
            name="langchain/langgraph",
            package_re=re.compile(r"^(langchain|langgraph)($|_|\.)"),
            allowlist=tuple(
                _glob_to_regex(g)
                for g in (
                    "src/claudebox/agent_session/runtime_langgraph.py",
                    "src/claudebox/agent_session/langgraph_tools/**/*.py",
                    "tests/claudebox/agent_session/test_runtime_langgraph_*.py",
                    "tests/claudebox/agent_session/test_runtime_langgraph_tool_binding.py",
                    "tests/claudebox/agent_session/langgraph_tools/**/*.py",
                    "tests/claudebox/agent_session/test_event_translation.py",
                    "tests/claudebox/agent_session/orchestration/test_pipeline.py",
                )
            ),
            message=(
                "Import langchain*/langgraph* only from "
                "claudebox/agent_session/runtime_langgraph.py or "
                "claudebox/agent_session/langgraph_tools/ - see GUIDELINES.md SDK Containment"
            ),
        ),
    )

    def __init__(self, root: Path):
        self._root = root

    def run(self, *, verbose: bool) -> int:
        """Print violations to stdout; return total count."""

        total = 0
        files_checked = 0

        for path in sorted(self._iter_files()):
            files_checked += 1
            rel = path.relative_to(self._root).as_posix()

            for line, text in self._audit_file(path, rel):
                total += 1
                print(f"{rel}:{line}: {text}")

        if verbose or total:
            print(f"--- {files_checked} files checked, {total} SDK-containment violation(s)")

        return total

    def _violated_rule(self, module: str, rel: str) -> ContainmentRule | None:
        """Return the rule `module` violates from file `rel`, or None if clean/allowlisted."""

        for rule in self.RULES:
            if rule.package_re.match(module) and not any(p.match(rel) for p in rule.allowlist):
                return rule

        return None

    def _audit_file(self, path: Path, rel: str) -> list[tuple[int, str]]:
        """Return (line, message) for every banned import in this file."""

        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found: list[tuple[int, str]] = []

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self._record(alias.name, f"import {alias.name}", node.lineno, rel, found)
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                module = node.module or ""
                names = ", ".join(a.name for a in node.names)
                self._record(module, f"from {module} import {names}", node.lineno, rel, found)

        return found

    def _record(
        self, module: str, text: str, lineno: int, rel: str, found: list[tuple[int, str]]
    ) -> None:
        """Append a violation when `module` matches a rule and `rel` is not allowlisted."""

        rule = self._violated_rule(module, rel)

        if rule is not None:
            found.append((lineno, f"{text}  -- {rule.message}"))

    def _iter_files(self) -> list[Path]:
        """Yield every .py file under src/ and tests/, skipping venvs and caches."""

        files: list[Path] = []

        for sub in self.SUBDIRS:
            base = self._root / sub

            if not base.exists():
                continue

            files.extend(
                path
                for path in base.rglob("*.py")
                if not any(part in self.EXCLUDED_DIR_PARTS for part in path.parts)
            )

        return files


class CallbackCatchAllAudit:
    """A `**kwargs` catch-all on a callable that also declares named callbacks is banned.

    The footgun: a caller wiring a misnamed callback (`on_session_start` vs `on_start`) has it
    silently swallowed by the catch-all instead of failing loud. Flags any
    def with a non-underscore `**kwargs` parameter that also declares a callback parameter
    (name starting `on_` or ending `_callback` / `_cb`). Underscore-prefixed catch-alls
    (`**_server_args`) are intentional ignores and exempt. Walks src/.
    """

    SUBDIRS = ("src",)
    EXCLUDED_DIR_PARTS = frozenset(
        {".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules"}
    )

    def __init__(self, root: Path):
        self._root = root

    def run(self, *, verbose: bool) -> int:
        """Print violations to stdout; return total count."""

        total = 0
        files_checked = 0

        for path in sorted(self._iter_files()):
            files_checked += 1
            rel = path.relative_to(self._root).as_posix()

            for line, text in self._audit_file(path):
                total += 1
                print(f"{rel}:{line}: {text}")

        if verbose or total:
            print(f"--- {files_checked} files checked, {total} callback catch-all(s)")

        return total

    def _audit_file(self, path: Path) -> list[tuple[int, str]]:
        """Return (line, message) for every callback-binding def with a catch-all."""

        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found: list[tuple[int, str]] = []

        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue

            kwarg = node.args.kwarg

            if (
                kwarg is not None
                and not kwarg.arg.startswith("_")
                and self._binds_callback(node.args)
            ):
                found.append(
                    (
                        node.lineno,
                        f"def {node.name}(...) has a `**{kwarg.arg}` catch-all alongside a named "
                        "callback parameter - drop the catch-all so a misnamed callback fails loud",
                    )
                )

        return found

    @staticmethod
    def _binds_callback(args: ast.arguments) -> bool:
        """Whether any declared parameter is named like a callback."""

        names = [a.arg for a in (*args.posonlyargs, *args.args, *args.kwonlyargs)]

        return any(n.startswith("on_") or n.endswith(("_callback", "_cb")) for n in names)

    def _iter_files(self) -> list[Path]:
        """Yield every .py file under src/, skipping venvs and caches."""

        files: list[Path] = []

        for sub in self.SUBDIRS:
            base = self._root / sub

            if not base.exists():
                continue

            files.extend(
                path
                for path in base.rglob("*.py")
                if not any(part in self.EXCLUDED_DIR_PARTS for part in path.parts)
            )

        return files


AUDITS = [
    CrossPackageImportAudit,
    WhitespaceControlFlowAudit,
    SdkContainmentAudit,
    CallbackCatchAllAudit,
]


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
