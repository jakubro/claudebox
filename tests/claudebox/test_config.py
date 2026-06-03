"""Tests for claudebox.config — configuration loading and merging."""

import pytest

from claudebox.config import Config
from claudebox.constants import CLAUDEBOX_SETTINGS_FILE


class TestLoadConfigFiles:
    """Test hierarchical config file collection and merging."""

    def test_single_config(self, tmp_path):
        settings_path = tmp_path / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('[network]\nmode = "host"\n')

        result = Config._load_config_files(tmp_path)
        assert result.get("network", {}).get("mode") == "host"

    def test_hierarchical_merge(self, tmp_path):
        # Parent config
        parent = tmp_path / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('agent = "claude"\nbackend = "podman"\n')

        # Child config
        child = parent / "child"
        child.mkdir()
        child_settings = child / CLAUDEBOX_SETTINGS_FILE
        child_settings.parent.mkdir(parents=True, exist_ok=True)
        child_settings.write_text('backend = "docker"\n')

        result = Config._load_config_files(child)
        # Child overrides parent for backend
        assert result.get("backend") == "docker"
        # Parent provides agent
        assert result.get("agent") == "claude"

    def test_root_flag_stops_walk(self, tmp_path):
        # Grandparent config
        grandparent = tmp_path / "gp"
        grandparent.mkdir()
        gp_settings = grandparent / CLAUDEBOX_SETTINGS_FILE
        gp_settings.parent.mkdir(parents=True, exist_ok=True)
        gp_settings.write_text('agent = "gp-agent"\n')

        # Parent with root = true
        parent = grandparent / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('root = true\nagent = "parent-agent"\n')

        result = Config._load_config_files(parent)
        # Grandparent should NOT be merged because root=true stops walk
        assert result.get("agent") == "parent-agent"

    def test_no_config_files(self, tmp_path, monkeypatch):
        monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path / "fakehome")
        result = Config._load_config_files(tmp_path)
        assert result == {}


class TestConfigLoad:
    """Test Config.load() with explicit workspace_path."""

    def test_with_workspace_path(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)
        assert config.work_dir == tmp_workspace
        assert config.config_dir == tmp_workspace / ".claudebox"

    def test_defaults(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)
        assert config.agent == "claude"
        assert config.backend == "podman"

    def test_loads_settings(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('[network]\nmode = "host"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.network_mode == "host"

    def test_profile_resolution(self, tmp_workspace):
        profile_dir = tmp_workspace / "my-profile"
        profile_dir.mkdir()
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(f'profile = "{profile_dir}"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.profile == profile_dir.resolve()


class TestConfigLoadErrors:
    """Test Config.load() error paths and malformed input handling."""

    def test_invalid_toml_raises(self, tmp_workspace):
        """Invalid TOML syntax should propagate a TOMLDecodeError."""
        import tomllib

        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text("this is [not valid toml =\n")

        with pytest.raises(tomllib.TOMLDecodeError):
            Config.load(workspace_path=tmp_workspace)

    def test_mounts_wrong_type_raises(self, tmp_workspace):
        """mounts must be a table/dict; a non-dict value should cause an error."""
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('mounts = "not-a-dict"\n')

        with pytest.raises((TypeError, AttributeError)):
            Config.load(workspace_path=tmp_workspace)

    def test_network_mode_wrong_type_returns_none(self, tmp_workspace):
        """network set to a non-table value should fail on .get() access."""
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('network = "bridge"\n')

        with pytest.raises(AttributeError):
            Config.load(workspace_path=tmp_workspace)

    def test_empty_config_file_uses_defaults(self, tmp_workspace):
        """An empty settings file should result in default values."""
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text("")

        config = Config.load(workspace_path=tmp_workspace)
        assert config.agent == "claude"
        assert config.backend == "podman"
        assert config.network_mode is None
        assert config.mounts is None

    def test_whitespace_only_config_uses_defaults(self, tmp_workspace):
        """A whitespace-only settings file should behave like an empty one."""
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text("   \n\n  \t  \n")

        config = Config.load(workspace_path=tmp_workspace)
        assert config.agent == "claude"
        assert config.backend == "podman"

    def test_workspace_path_as_string(self, tmp_workspace):
        """Config.load() should accept workspace_path as a string."""
        config = Config.load(workspace_path=str(tmp_workspace))
        assert config.work_dir == tmp_workspace
