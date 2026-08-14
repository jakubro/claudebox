"""Cross-cutting Traceback-absence + bare-invocation tests for the implemented verbs.

Parser-level exit-code coverage (--help-exits-zero, unknown-verb-exits-2) lives in
tests/claudebox_cli/test_dispatch.py; this file asserts the real-binary contract: subprocess
failures surface as exit codes, never a Python traceback.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:run
# SPEC: cli:shell
# SPEC: cli:build:failure-propagated
class TestNoPythonTracebackOnFailure:
    """Subprocess failures surface as exit codes; no traceback dumps."""

    @pytest.mark.parametrize("verb", ["run", "build", "shell"])
    def test_verb_failure_no_traceback(self, verb: str, run_claudebox) -> None:
        # PATH override stacks on the wrapper's PATH_PREFIX, so the fake bins still resolve;
        # a verb may exit 0, 1, or other non-zero - the only forbidden outcome is a traceback.
        result = run_claudebox([verb], timeout=60)
        assert "Traceback" not in result.stderr


class TestBareInvocationPrintsHelp:
    """Bare ``claudebox`` prints full top-level help and exits 2."""

    def test_bare_prints_help_body_and_exits_2(self, run_claudebox) -> None:
        result = run_claudebox([])
        combined = result.stdout + result.stderr

        assert result.returncode == 2
        # Full help body - not argparse's terse required-arg error.
        assert "Run AI coding agents in a containerized dev environment." in combined
        assert "<command>" in combined
