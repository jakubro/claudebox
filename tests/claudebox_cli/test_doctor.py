"""Tests for claudebox_cli.cmd_doctor - the ``doctor`` verb's environment checks."""

from claudebox_cli.cmd_doctor import _check_profile


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
