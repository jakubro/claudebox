"""End-to-end behavioral tests for ``claudebox doctor``.

Exercises the SPEC ``cli:doctor`` claim through the real binary via subprocess.
The sandbox environment lacks runtime/daemon — doctor will surface failures
there. Tests assert on the surface (rows present, exit code reflects failures),
not on specific check outcomes.
"""


# SPEC: cli:doctor
class TestDoctorHelp:
    """``claudebox doctor --help`` exits 0 and documents the check set."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["doctor", "--help"])
        assert result.returncode == 0

    def test_help_mentions_checks(self, run_claudebox) -> None:
        result = run_claudebox(["doctor", "--help"])
        # Must enumerate the broad shape of what doctor probes.
        for token in ("runtime", "uv", "daemon", "workspace", "permissions", "disk"):
            assert token in result.stdout


# SPEC: cli:doctor
class TestDoctorOutput:
    """``claudebox doctor`` prints one row per check and aggregates exit."""

    def test_doctor_prints_all_labels(self, run_claudebox) -> None:
        result = run_claudebox(["doctor"], timeout=60)
        # Every check's label MUST appear regardless of pass/fail.
        labels = [
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
        for label in labels:
            assert label in result.stdout, f"missing doctor row: {label!r}"

    def test_doctor_emits_summary_line(self, run_claudebox) -> None:
        result = run_claudebox(["doctor"], timeout=60)
        # Either "all checks passed." or "N check(s) failed.".
        assert (
            "checks passed." in result.stdout
            or "check" in result.stdout
            and "failed." in result.stdout
        )

    def test_doctor_failure_exit_code_matches_summary(self, run_claudebox) -> None:
        # In any realistic CI / sandbox env at least one check (runtime or daemon)
        # will fail — exit code MUST be 1 when summary reports failure.
        result = run_claudebox(["doctor"], timeout=60)
        if "checks passed." in result.stdout:
            assert result.returncode == 0
        else:
            assert result.returncode == 1

    def test_doctor_verbose_shows_probe_commands(self, run_claudebox) -> None:
        result = run_claudebox(["-v", "doctor"], timeout=60)
        # -v mode prepends `→` followed by the probe command under each row.
        assert "→" in result.stdout
        # Specifically, `<backend> --version` is the first probe. The default
        # backend is podman per claudebox/constants.py:DEFAULT_BACKEND.
        assert "podman --version" in result.stdout
