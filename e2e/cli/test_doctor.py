"""End-to-end behavioral tests for ``claudebox doctor``.

Real-binary surfaces: every check row renders, summary + exit-code coherence,
and probe-command rendering under ``-v`` with fake podman on PATH.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


_DOCTOR_LABELS = [
    "runtime",
    "runtime info",
    "uv",
    "daemon http",
    "daemon unit",
    "~/.claudebox/lib",
    "profile",
    "workspace",
    "permissions",
    "disk",
]


# SPEC: cli:doctor
class TestDoctorOutput:
    """``claudebox doctor`` prints one row per check and aggregates exit code."""

    def test_doctor_prints_all_labels(self, run_claudebox) -> None:
        result = run_claudebox(["doctor"], timeout=60)

        for label in _DOCTOR_LABELS:
            assert label in result.stdout, f"missing doctor row: {label!r}"

    def test_doctor_emits_summary_line(self, run_claudebox) -> None:
        result = run_claudebox(["doctor"], timeout=60)
        # Either "all checks passed." or "<N> check(s) failed.".
        assert (
            "checks passed." in result.stdout
            or "check" in result.stdout
            and "failed." in result.stdout
        )

    def test_doctor_failure_exit_code_matches_summary(self, run_claudebox) -> None:
        result = run_claudebox(["doctor"], timeout=60)

        if "checks passed." in result.stdout:
            assert result.returncode == 0
        else:
            assert result.returncode == 1

    def test_doctor_verbose_shows_probe_commands(self, run_claudebox) -> None:
        result = run_claudebox(["-v", "doctor"], timeout=60)
        # -v mode prepends `->` followed by the probe command under each row.
        # Rich renders the arrow as a unicode glyph; the probe command itself is ASCII.
        assert "podman --version" in result.stdout
