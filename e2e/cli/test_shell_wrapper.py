"""Static-shape tests for ``lib/bin/claudebox_cli.sh``.

The wrapper is the production entrypoint resolved from $PATH. End-to-end behavior
tests in this directory invoke ``claudebox-test``, which in turn execs the
production wrapper — so the wrapper's shape (shebang, strict mode, VIRTUAL_ENV
scrubbing, uv-run invocation, realpath resolution, executable bit) is never
asserted directly. These file-read tests lock those invariants.
"""

import os
from pathlib import Path

import pytest


WRAPPER = Path(__file__).parent.parent.parent / "bin" / "claudebox_cli.sh"


@pytest.fixture(scope="module")
def wrapper_text() -> str:
    assert WRAPPER.is_file(), f"missing: {WRAPPER}"

    return WRAPPER.read_text()


def test_wrapper_is_executable() -> None:
    assert os.access(WRAPPER, os.X_OK), f"not executable: {WRAPPER}"


def test_wrapper_shebang_is_bash(wrapper_text: str) -> None:
    first_line = wrapper_text.splitlines()[0]
    assert first_line == "#!/bin/bash", f"unexpected shebang: {first_line!r}"


def test_wrapper_uses_strict_mode(wrapper_text: str) -> None:
    assert "set -euo pipefail" in wrapper_text, "strict mode missing"


def test_wrapper_unsets_virtual_env(wrapper_text: str) -> None:
    assert "unset VIRTUAL_ENV" in wrapper_text, "VIRTUAL_ENV not scrubbed"


def test_wrapper_execs_uv_run(wrapper_text: str) -> None:
    # The exact line: `uv run --project "$ROOT_DIR" "$ROOT_DIR"/src/host_cli.py "$@"`
    assert "uv run" in wrapper_text
    assert "--project" in wrapper_text
    assert "src/host_cli.py" in wrapper_text
    assert '"$@"' in wrapper_text


def test_wrapper_resolves_root_via_realpath(wrapper_text: str) -> None:
    # SCRIPT_DIR + ROOT_DIR are derived via realpath so the wrapper works
    # when invoked through a symlink (the production install path).
    assert "realpath" in wrapper_text
