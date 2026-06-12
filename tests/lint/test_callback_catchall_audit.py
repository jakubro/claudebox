"""Tests for CallbackCatchAllAudit - ban a **kwargs catch-all alongside named callbacks.

The audit script has a hyphenated filename (not importable by name), so it is loaded via
importlib. Sample defs are written into tmp files; this test module declares no such pattern.
"""

import importlib.util
from pathlib import Path


LIB_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = LIB_ROOT / "scripts" / "python-guidelines-audit.py"


def _load_audit_module():
    """Load the hyphenated audit script as an importable module."""

    spec = importlib.util.spec_from_file_location("guidelines_audit", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


CallbackCatchAllAudit = _load_audit_module().CallbackCatchAllAudit


def _run_on(tmp_path: Path, source: str) -> int:
    """Write `source` to a tmp src/ tree and return the audit's violation count."""

    pkg = tmp_path / "src" / "pkg"
    pkg.mkdir(parents=True)
    (pkg / "mod.py").write_text(source)

    return CallbackCatchAllAudit(tmp_path).run(verbose=False)


class TestCallbackCatchAllAudit:
    def test_flags_catchall_with_on_callback(self, tmp_path):
        assert _run_on(tmp_path, "def __init__(self, on_start=None, **kwargs):\n    pass\n") == 1

    def test_flags_catchall_with_callback_suffix(self, tmp_path):
        assert _run_on(tmp_path, "def make(done_callback=None, **kw):\n    return None\n") == 1

    def test_underscore_catchall_is_exempt(self, tmp_path):
        assert _run_on(tmp_path, "def managed(on_start=None, **_server_args):\n    pass\n") == 0

    def test_callbacks_without_catchall_clean(self, tmp_path):
        assert (
            _run_on(tmp_path, "def __init__(self, on_start=None, on_stop=None):\n    pass\n") == 0
        )

    def test_catchall_without_callback_clean(self, tmp_path):
        assert _run_on(tmp_path, "def dumps(obj, **kwargs):\n    return obj\n") == 0

    def test_real_src_tree_is_clean(self):
        # Parity guard: no production callable binds named callbacks alongside a catch-all.
        assert CallbackCatchAllAudit(LIB_ROOT).run(verbose=False) == 0
