"""Tests for TextEncodingAudit: text opened, read or written in src/ names an encoding."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


LIB_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = LIB_ROOT / "scripts" / "python-guidelines-audit.py"


def _load_audit_module():
    spec = importlib.util.spec_from_file_location("guidelines_audit_encoding", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


TextEncodingAudit = _load_audit_module().TextEncodingAudit


def _violations(tmp_path: Path, body: str, capsys) -> list[str]:
    pkg = tmp_path / "src" / "pkg"
    pkg.mkdir(parents=True)
    (pkg / "mod.py").write_text(
        "import aiofiles\nimport io\nimport os\nfrom pathlib import Path\n\n\n" + body,
        encoding="utf-8",
    )

    count = TextEncodingAudit(tmp_path).run(verbose=False)
    lines = [line for line in capsys.readouterr().out.splitlines() if not line.startswith("---")]
    assert count == len(lines)

    return lines


@pytest.mark.parametrize(
    "body",
    [
        "def f():\n    return open('notes.txt')\n",
        "def f():\n    return open('notes.txt', 'w')\n",
        "def f():\n    return open('notes.txt', mode='a')\n",
        "def f(p):\n    return Path(p).read_text()\n",
        "def f(p, s):\n    p.write_text(s)\n",
        "def f(p):\n    return p.open('a')\n",
        "def f(p):\n    return p.open()\n",
        "def f():\n    return io.open('notes.txt', 'r')\n",
        "async def f(p):\n    async with aiofiles.open(p, 'r') as handle:\n        return await handle.read()\n",
        "async def f(p):\n    return await aiofiles.open(p, 'a')\n",
    ],
)
def test_a_text_call_without_an_encoding_is_named_with_its_line(tmp_path, capsys, body):
    lines = _violations(tmp_path, body, capsys)

    assert len(lines) == 1
    assert lines[0].startswith("src/pkg/mod.py:")
    assert 'encoding="utf-8"' in lines[0]


@pytest.mark.parametrize(
    "body",
    [
        "def f():\n    return open('notes.txt', 'rb')\n",
        "def f():\n    return open('notes.txt', mode='wb')\n",
        "def f(p):\n    return p.open('ab')\n",
        "def f():\n    return open('notes.txt', encoding='utf-8')\n",
        "def f(p):\n    return p.read_text(encoding='utf-8')\n",
        "def f(p, s):\n    p.write_text(s, encoding='utf-8')\n",
        "def f(p):\n    return p.read_bytes()\n",
        "def f(mode):\n    return open('notes.txt', mode)\n",
        "def f():\n    return os.open('notes.txt', os.O_RDONLY)\n",
        "async def f(log):\n    await log.open()\n",
        "def write_text(path, data):\n    pass\n\n\ndef f(p):\n    write_text(p, 'x')\n",
    ],
)
def test_binary_named_or_non_file_calls_pass(tmp_path, capsys, body):
    assert _violations(tmp_path, body, capsys) == []


def test_the_line_named_is_the_calls_own(tmp_path, capsys):
    lines = _violations(tmp_path, "def f(p):\n    x = 1\n    return p.read_text()\n", capsys)

    assert lines[0].startswith("src/pkg/mod.py:9: p.read_text ")
