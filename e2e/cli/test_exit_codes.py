"""Cross-cutting exit-code propagation tests for the implemented verbs.

Subset of the master CLI restructure's exit-code coverage — ``update`` is
deferred to its own fill-in. Implemented verbs (run/build/shell/prune) must
propagate the subprocess returncode cleanly without a Python traceback.
"""

import shutil

import pytest


_IMPLEMENTED_VERBS = ["run", "build", "shell", "prune"]


# SPEC: cli:shell
# SPEC: cli:prune
class TestVerbHelpExitsZero:
    """Every implemented verb's --help is a working surface."""

    @pytest.mark.parametrize("verb", _IMPLEMENTED_VERBS)
    def test_help_exits_zero(self, verb: str, run_claudebox) -> None:
        result = run_claudebox([verb, "--help"])
        assert result.returncode == 0


class TestUnknownVerbExits2:
    """Unknown verbs and legacy invocations are uniform argparse errors."""

    @pytest.mark.parametrize(
        "args",
        [
            ["foo"],
            ["-b"],
            ["bash"],
            ["python", "script.py"],
            [],  # bare claudebox
        ],
    )
    def test_legacy_form_exits_2(self, args: list[str], run_claudebox) -> None:
        result = run_claudebox(args)
        assert result.returncode == 2


# SPEC: cli:run
# SPEC: cli:build:failure-propagated
class TestNoPythonTracebackOnFailure:
    """Subprocess failures surface as exit codes; no traceback dumps."""

    @pytest.mark.skipif(
        shutil.which("podman") is None,
        reason="podman not available — backend invocations skipped",
    )
    @pytest.mark.parametrize("verb", ["run", "build", "shell"])
    def test_verb_failure_no_traceback(self, verb: str, run_claudebox) -> None:
        # Run with a sabotaged PATH so the backend invocation fails.
        result = run_claudebox(
            [verb],
            env={"PATH": "/nonexistent"},
            timeout=60,
        )
        assert "Traceback" not in result.stderr


class TestBareInvocationPrintsHelp:
    """Bare ``claudebox`` prints full top-level help and exits 2."""

    def test_bare_prints_help_body_and_exits_2(self, run_claudebox) -> None:
        result = run_claudebox([])
        combined = result.stdout + result.stderr

        assert result.returncode == 2
        # Full help body — not argparse's terse required-arg error.
        assert "Run Claude Code in a containerized dev environment." in combined
        assert "<command>" in combined

    def test_help_flag_exits_zero(self, run_claudebox) -> None:
        assert run_claudebox(["--help"]).returncode == 0
