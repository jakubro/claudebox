"""End-to-end behavioral tests for ``claudebox doctor``.

Real-binary surfaces: every check row renders, summary + exit-code coherence,
and probe-command rendering under ``-v`` with fake podman on PATH.
"""

from __future__ import annotations

from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


def _write_profile_setting(workspace: Path, *, profile: str) -> None:
    # Marks workspace as its own root, or walk_up climbs past tmp_path (bwrap is skipped
    # in-container, see tests/conftest.py).
    (workspace / ".workspace").touch()

    settings_dir = workspace / ".claudebox"
    settings_dir.mkdir(parents=True, exist_ok=True)
    (settings_dir / "settings.toml").write_text(f'profile = "{profile}"\n')


_DOCTOR_LABELS = [
    "runtime",
    "runtime info",
    "uv",
    "daemon http",
    "daemon unit",
    "watchdog timer",
    "~/.claudebox/lib",
    "profile",
    "tmp mounts",
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

    def test_help_lists_every_printed_row_in_order(self, run_claudebox) -> None:
        run = run_claudebox(["doctor"], timeout=60).stdout
        help_text = run_claudebox(["doctor", "--help"], timeout=60).stdout

        printed = [line[2:19].strip() for line in run.splitlines() if line[:1] in ("✓", "✗", "○")]
        checks = help_text.split("Checks (in order, one row each):")[1].split("\n\n")[0]
        listed = [item.split(" (")[0] for item in " ".join(checks.split()).split(", ")]

        assert printed == listed

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
        # -v prepends an arrow (a unicode glyph via Rich); the assertion checks only the
        # ASCII probe text.
        assert "podman --version" in result.stdout


# SPEC: cli:doctor:profile
class TestDoctorProfile:
    """The profile row names the configured profile and fails when it cannot be read."""

    def test_configured_profile_passes_and_is_named(self, tmp_path, run_claudebox) -> None:
        profile = tmp_path / "my-profile"
        profile.mkdir()
        _write_profile_setting(tmp_path, profile=str(profile))

        result = run_claudebox(["doctor"], cwd=tmp_path, timeout=60)

        # Rich hard-wraps long paths with no inserted chars; stripping newlines reconstructs
        # the original for matching.
        stdout = result.stdout.replace("\n", "")
        assert f"✓ profile          {profile}" in stdout
        assert "no profile configured" not in stdout

    def test_configured_but_missing_profile_fails_the_run(self, tmp_path, run_claudebox) -> None:
        profile = tmp_path / "gone"
        _write_profile_setting(tmp_path, profile=str(profile))

        result = run_claudebox(["doctor"], cwd=tmp_path, timeout=60)

        stdout = result.stdout.replace("\n", "")
        assert f"✗ profile          {profile} (missing)" in stdout
        assert result.returncode == 1


def _write_settings(workspace: Path, body: str) -> None:
    (workspace / ".workspace").touch()
    settings_dir = workspace / ".claudebox"
    settings_dir.mkdir(parents=True, exist_ok=True)
    (settings_dir / "settings.toml").write_text(body)


# SPEC: cli:doctor:tmp-mounts
class TestDoctorTmpMounts:
    """The /tmp row fails when a session would have to delete something mounted under /tmp."""

    def test_a_mount_under_tmp_fails_naming_it_and_the_opt_out(
        self,
        tmp_path,
        run_claudebox,
    ) -> None:
        _write_settings(tmp_path, '[mounts]\n"/srv/agent" = "/tmp/ssh-agent"\n')

        result = run_claudebox(["doctor"], cwd=tmp_path, timeout=60)

        stdout = result.stdout.replace("\n", "")
        assert "✗ tmp mounts" in stdout
        assert "/tmp/ssh-agent" in stdout
        assert "CLAUDEBOX_NO_TMP_REMAP" in stdout
        assert result.returncode == 1

    def test_the_local_backend_passes(self, tmp_path, run_claudebox) -> None:
        _write_settings(tmp_path, 'backend = "local"\n[mounts]\n"/srv/agent" = "/tmp/ssh-agent"\n')

        result = run_claudebox(["doctor"], cwd=tmp_path, timeout=60)

        assert "✓ tmp mounts" in result.stdout.replace("\n", "")


# SPEC: cli:doctor-local
class TestDoctorLocalBackend:
    """With the local backend the runtime rows pass and no container runtime is probed."""

    def test_runtime_rows_pass_naming_the_local_backend(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        _write_settings(tmp_path, 'backend = "local"\n')

        result = run_claudebox(["doctor"], cwd=tmp_path, timeout=60)

        stdout = result.stdout.replace("\n", "")
        assert "✓ runtime          local backend - no container runtime needed" in stdout
        assert "✓ runtime info     not needed for the local backend" in stdout
        assert "(not found)" not in stdout
        assert not (record_dir / "podman.log").exists()
