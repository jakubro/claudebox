"""Test for ``lib/bin/claudebox_cli.sh``.

The wrapper is the production entrypoint resolved from $PATH.
Every other e2e test here execs it via ``claudebox-test``, exercising its shebang, strict mode, env
scrubbing, uv-run, and realpath resolution already.
A regression there breaks the CLI outright, not just this file. The executable bit is the one
property invocation alone would not surface cleanly.
"""

import os
from pathlib import Path


WRAPPER = Path(__file__).parent.parent.parent / "bin" / "claudebox_cli.sh"


def test_wrapper_is_executable() -> None:
    assert os.access(WRAPPER, os.X_OK), f"not executable: {WRAPPER}"
