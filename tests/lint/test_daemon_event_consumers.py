"""Every event type the daemon broadcasts has a consumer, and every type a consumer branches on is emitted."""

from __future__ import annotations

import ast
import re
from pathlib import Path

from claudebox_cli import cmd_logs


LIB_ROOT = Path(__file__).resolve().parents[2]
DAEMON = LIB_ROOT / "src" / "claudebox_daemon"
DAEMON_STREAM_HOOK = (
    LIB_ROOT / "src" / "claudebox_frontend" / "src" / "hooks" / "useDaemonStream.js"
)

_CONSUMED_RE = re.compile(r"data\.type === '([a-z_]+)'")


def _emitted(root: Path) -> set[str]:
    """String defaults of class-level `type: str = "..."` annotations in every models.py under `root`."""

    types = set()

    for path in root.rglob("models.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ClassDef):
                continue

            for stmt in node.body:
                if (
                    isinstance(stmt, ast.AnnAssign)
                    and isinstance(stmt.target, ast.Name)
                    and stmt.target.id == "type"
                    and isinstance(stmt.value, ast.Constant)
                    and isinstance(stmt.value.value, str)
                ):
                    types.add(stmt.value.value)

    return types


def _consumed() -> set[str]:
    frontend = set(_CONSUMED_RE.findall(DAEMON_STREAM_HOOK.read_text(encoding="utf-8")))

    return frontend | {cmd_logs._CONTAINER_STATUS_EVENT}


def test_every_daemon_event_has_a_consumer():
    assert _emitted(DAEMON) - _consumed() == set()


def test_every_consumed_event_is_emitted():
    assert _consumed() - _emitted(DAEMON) == set()


def test_mutation_an_unconsumed_event_is_caught(tmp_path):
    (tmp_path / "models.py").write_text(
        'class OrphanEvent:\n    type: str = "orphan_event"\n',
        encoding="utf-8",
    )

    assert _emitted(tmp_path) - _consumed() == {"orphan_event"}
