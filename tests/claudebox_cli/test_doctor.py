"""Tests for claudebox_cli.cmd_doctor - the ``doctor`` verb's environment checks."""

from __future__ import annotations

from claudebox import Config, temp
from claudebox_cli.cmd_doctor import _check_profile, _check_tmp_mounts


class TestCheckProfile:
    """``_check_profile`` validates the profile passed to it by the caller."""

    def test_configured_elsewhere(self, tmp_path):
        profile = tmp_path / "my-profile"
        profile.mkdir()

        result = _check_profile(profile)

        assert result.icon == "✓"
        assert result.detail == str(profile)

    def test_configured_but_missing(self, tmp_path):
        profile = tmp_path / "gone"

        result = _check_profile(profile)

        assert result.icon == "✗"
        assert result.detail == f"{profile} (missing)"

    def test_configured_but_unreadable(self, tmp_path, monkeypatch):
        # Root bypasses permission bits (os.access is always True), so this mocks os.access instead of chmod.
        profile = tmp_path / "locked"
        profile.mkdir()
        monkeypatch.setattr("claudebox_cli.cmd_doctor.os.access", lambda path, mode: False)

        result = _check_profile(profile)

        assert result.icon == "✗"
        assert result.detail == f"{profile} (not readable)"

    def test_unconfigured(self):
        result = _check_profile(None)

        assert result.icon == "○"
        assert result.detail == "no profile configured"

    def test_stale_directory_at_old_location_ignored(self, tmp_path, monkeypatch):
        fake_home = tmp_path / "_home"
        fake_home.mkdir(exist_ok=True)
        monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: fake_home))
        (fake_home / ".claudebox" / "profile").mkdir(parents=True)

        configured = tmp_path / "actual-profile"
        configured.mkdir()

        result = _check_profile(configured)

        assert result.icon == "✓"
        assert result.detail == str(configured)

    def test_file_not_directory(self, tmp_path):
        profile = tmp_path / "not-a-dir"
        profile.write_text("")

        result = _check_profile(profile)

        assert result.icon == "✗"
        assert result.detail == f"{profile} (not a directory)"


class TestCheckTmpMounts:
    """``_check_tmp_mounts`` reports a workspace or mount the session would delete."""

    @staticmethod
    def _config(tmp_path, **overrides):
        values = {"work_dir": tmp_path / "ws", "config_dir": tmp_path / ".claudebox"}
        values.update(overrides)

        return Config(**values)

    def test_a_mount_under_tmp_fails_naming_it_and_the_opt_out(self, tmp_path):
        target = temp.TMP_PATH / "ssh-agent"
        config = self._config(tmp_path, mounts={tmp_path / "agent": target})

        result = _check_tmp_mounts(config)

        assert result.icon == "✗"
        assert str(target) in result.detail
        assert "CLAUDEBOX_NO_TMP_REMAP" in result.detail

    def test_nothing_under_tmp_passes(self, tmp_path):
        assert _check_tmp_mounts(self._config(tmp_path)).icon == "✓"

    def test_the_local_backend_passes(self, tmp_path):
        config = self._config(tmp_path, backend="local", work_dir=temp.TMP_PATH / "ws")

        assert _check_tmp_mounts(config).icon == "✓"

    def test_the_opt_out_passes(self, tmp_path):
        config = self._config(
            tmp_path,
            work_dir=temp.TMP_PATH / "ws",
            env={"CLAUDEBOX_NO_TMP_REMAP": "1"},
        )

        assert _check_tmp_mounts(config).icon == "✓"
