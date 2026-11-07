"""Tests for claudebox.config - configuration loading and merging."""

from __future__ import annotations

from pathlib import Path

import pytest

from claudebox.config import Config
from claudebox.constants import CLAUDEBOX_SETTINGS_FILE, profile_dir
from claudebox.core.ports import PortMapping
from ..conftest import bounded_walk_up


class TestLoadConfigFiles:
    """Test hierarchical config file collection and merging."""

    def test_single_config(self, tmp_path):
        settings_path = tmp_path / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('[network]\nmode = "host"\n')

        result = Config._load_config_files(tmp_path)
        assert result.get("network", {}).get("mode") == "host"

    def test_hierarchical_merge(self, tmp_path):
        parent = tmp_path / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('agent = "claude"\nbackend = "podman"\n')

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
        grandparent = tmp_path / "gp"
        grandparent.mkdir()
        gp_settings = grandparent / CLAUDEBOX_SETTINGS_FILE
        gp_settings.parent.mkdir(parents=True, exist_ok=True)
        gp_settings.write_text('agent = "gp-agent"\n')

        parent = grandparent / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('root = true\nagent = "parent-agent"\n')

        result = Config._load_config_files(parent)
        # Grandparent should NOT be merged because root=true stops walk
        assert result.get("agent") == "parent-agent"

    def test_no_config_files(self, bounded_config_root, monkeypatch):
        monkeypatch.setattr("pathlib.Path.home", lambda: bounded_config_root / "fakehome")
        result = Config._load_config_files(bounded_config_root)
        assert result == {}

    def test_ancestor_settings_above_start_dir_not_leaked(self, tmp_path_factory, monkeypatch):
        """The walk runs start_dir -> Path.home(), so an ancestor's settings.toml must not leak."""
        isolated_root = tmp_path_factory.mktemp("ancestor-leak")
        start_dir = isolated_root / "workspace"
        start_dir.mkdir()

        ancestor_settings = isolated_root / CLAUDEBOX_SETTINGS_FILE
        ancestor_settings.parent.mkdir(parents=True, exist_ok=True)
        ancestor_settings.write_text('[editor]\nurl_template = "should-not-leak"\n')

        monkeypatch.setattr("pathlib.Path.home", lambda: isolated_root / "fakehome")
        monkeypatch.setattr("claudebox.config.walk_up", bounded_walk_up(start_dir))

        result = Config._load_config_files(start_dir)

        assert result == {}


class TestSettingsFileTrust:
    """A settings file not owned by the running user is skipped, not merged."""

    def test_untrusted_ancestor_is_skipped_with_stderr_notice(self, tmp_path, monkeypatch, capsys):
        ancestor = tmp_path / "ancestor"
        ancestor.mkdir()
        ancestor_settings = ancestor / CLAUDEBOX_SETTINGS_FILE
        ancestor_settings.parent.mkdir(parents=True, exist_ok=True)
        ancestor_settings.write_text('agent = "untrusted-agent"\n')

        workspace = ancestor / "workspace"
        workspace.mkdir()
        workspace_settings = workspace / CLAUDEBOX_SETTINGS_FILE
        workspace_settings.parent.mkdir(parents=True, exist_ok=True)
        workspace_settings.write_text('[network]\nmode = "host"\n')

        monkeypatch.setattr(
            "claudebox.config._is_trusted_settings_file",
            lambda path: path != ancestor_settings,
        )

        result = Config._load_config_files(workspace)

        assert result.get("agent") is None
        assert result.get("network", {}).get("mode") == "host"
        assert str(ancestor_settings) in capsys.readouterr().err

    def test_trusted_files_are_unaffected(self, tmp_path, monkeypatch):
        """A file the running user owns (the ordinary case) still merges - no false positives."""

        settings_path = tmp_path / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('agent = "trusted-agent"\n')

        result = Config._load_config_files(tmp_path)

        assert result.get("agent") == "trusted-agent"

    def test_root_process_trusts_the_workspace_file_regardless_of_owner(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        """The in-container load runs as root, where a rootless/rootful backend maps the workspace
        file's owner away from root - root must still trust it, docker backend included."""

        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('backend = "docker"\n')

        monkeypatch.setattr("claudebox.config.os.getuid", lambda: 0)

        config = Config.load(workspace_path=tmp_workspace)

        assert config.backend == "docker"


class TestBackendValidation:
    """`backend` is validated against the accepted runtime set at load time."""

    @pytest.mark.parametrize("backend", ["podman", "docker", "local"])
    def test_accepted_values_load(self, tmp_workspace, backend):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(f'backend = "{backend}"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.backend == backend

    def test_unknown_backend_raises_naming_file_and_value(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('backend = "containerd"\n')

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert str(settings_path) in str(excinfo.value)
        assert "containerd" in str(excinfo.value)

    def test_arbitrary_path_backend_is_refused_not_executed(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('backend = "/path/to/anything"\n')

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert "/path/to/anything" in str(excinfo.value)


class TestPruneLifetimes:
    """`[prune]` lifetimes: a year and two weeks by default, a workspace's value over the home one.

    Anything but a positive whole number of days is refused, naming its file.
    """

    def _write(self, root: Path, content: str) -> Path:
        settings_path = root / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(content)

        return settings_path

    def test_defaults(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)

        assert (config.prune_session_days, config.prune_tmp_days) == (365, 14)

    def test_the_home_value_reaches_a_workspace_without_its_own(self, tmp_workspace):
        self._write(tmp_workspace / "_home", "[prune]\ntmp_days = 10\n")

        config = Config.load(workspace_path=tmp_workspace)

        assert (config.prune_session_days, config.prune_tmp_days) == (365, 10)

    def test_a_workspace_value_wins_over_the_home_one(self, tmp_workspace):
        self._write(tmp_workspace / "_home", "[prune]\ntmp_days = 10\nsession_days = 90\n")
        self._write(tmp_workspace, "[prune]\ntmp_days = 3\n")

        config = Config.load(workspace_path=tmp_workspace)

        assert (config.prune_session_days, config.prune_tmp_days) == (90, 3)

    @pytest.mark.parametrize("value", ["0", "-3", "true", "1.5", '"7"'])
    @pytest.mark.parametrize("key", ["session_days", "tmp_days"])
    def test_anything_but_a_positive_whole_number_is_refused(self, tmp_workspace, key, value):
        settings_path = self._write(tmp_workspace, f"[prune]\n{key} = {value}\n")

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert str(settings_path) in str(excinfo.value)
        assert key in str(excinfo.value)

    def test_a_refused_home_value_names_the_home_file(self, tmp_workspace):
        home_settings = self._write(tmp_workspace / "_home", "[prune]\nsession_days = 0\n")

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert str(home_settings) in str(excinfo.value)


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

    def test_loads_containers_nested(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text("[containers]\nnested = true\n")

        config = Config.load(workspace_path=tmp_workspace)
        assert config.containers_nested is True

    def test_containers_nested_defaults_false(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)
        assert config.containers_nested is False

    def test_profile_resolution(self, tmp_workspace):
        profile_dir = tmp_workspace / "my-profile"
        profile_dir.mkdir()
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(f'profile = "{profile_dir}"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.profile == profile_dir.resolve()

    def test_profile_falls_back_to_installed_profile_dir(self, tmp_workspace):
        profile_dir().mkdir(parents=True)

        config = Config.load(workspace_path=tmp_workspace)
        assert config.profile == profile_dir()

    def test_profile_none_when_installed_profile_dir_absent(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)
        assert config.profile is None

    def test_explicit_profile_key_wins_over_installed_dir(self, tmp_workspace):
        profile_dir().mkdir(parents=True)
        explicit = tmp_workspace / "my-profile"
        explicit.mkdir()
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(f'profile = "{explicit}"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.profile == explicit.resolve()


class TestConfigEditorTemplate:
    """Test [editor] url_template parsing and hierarchy inheritance/override."""

    def test_absent_by_default(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)
        assert config.editor_url_template is None

    def test_parsed_from_workspace_settings(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('[editor]\nurl_template = "vscode://file/{path}:{line}"\n')

        config = Config.load(workspace_path=tmp_workspace)
        assert config.editor_url_template == "vscode://file/{path}:{line}"

    def test_inherited_from_parent_directory(self, tmp_path):
        parent = tmp_path / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('[editor]\nurl_template = "vscode://file/{path}:{line}"\n')

        workspace = parent / "workspace"
        workspace.mkdir()

        config = Config.load(workspace_path=workspace)
        assert config.editor_url_template == "vscode://file/{path}:{line}"

    def test_workspace_overrides_parent(self, tmp_path):
        parent = tmp_path / "parent"
        parent.mkdir()
        parent_settings = parent / CLAUDEBOX_SETTINGS_FILE
        parent_settings.parent.mkdir(parents=True, exist_ok=True)
        parent_settings.write_text('[editor]\nurl_template = "vscode://file/{path}:{line}"\n')

        workspace = parent / "workspace"
        workspace.mkdir()
        workspace_settings = workspace / CLAUDEBOX_SETTINGS_FILE
        workspace_settings.parent.mkdir(parents=True, exist_ok=True)
        workspace_settings.write_text(
            '[editor]\nurl_template = "jetbrains://idea/navigate/reference?path={path}"\n',
        )

        config = Config.load(workspace_path=workspace)
        assert config.editor_url_template == "jetbrains://idea/navigate/reference?path={path}"


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


class TestConfigLangGraphProviderKwargs:
    """Test [langgraph.<provider>] -> langgraph_provider_kwargs parsing."""

    def test_no_langgraph_section_yields_empty_dicts(self, tmp_workspace):
        config = Config.load(workspace_path=tmp_workspace)

        assert config.langgraph_provider_kwargs == {}
        assert config.langgraph_cost_overrides == {}

    def test_anthropic_subtable_becomes_provider_kwargs(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            "[langgraph]\n"
            'model = "anthropic:claude-sonnet-5"\n'
            "[langgraph.anthropic]\n"
            "temperature = 0.5\n",
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.langgraph_model == "anthropic:claude-sonnet-5"
        assert config.langgraph_provider_kwargs == {"anthropic": {"temperature": 0.5}}

    def test_multiple_provider_subtables_captured_per_name(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            "[langgraph]\n"
            'model = "openai:gpt-4o"\n'
            "[langgraph.openai]\n"
            'base_url = "http://x:8000/v1"\n'
            "[langgraph.ollama]\n"
            'base_url = "http://host.containers.internal:11434"\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.langgraph_provider_kwargs == {
            "openai": {"base_url": "http://x:8000/v1"},
            "ollama": {"base_url": "http://host.containers.internal:11434"},
        }

    def test_reserved_subtables_excluded_from_provider_kwargs(self, tmp_workspace):
        """[langgraph.web_search], [langgraph.mcp.*], [langgraph.cost] map to typed fields, not provider_kwargs."""

        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            "[langgraph]\n"
            'model = "ollama:llama3.2:3b"\n'
            "[langgraph.web_search]\n"
            'provider = "tavily"\n'
            "[langgraph.mcp.context7]\n"
            'transport = "stdio"\n'
            "[langgraph.cost]\n"
            '"my-model" = { input = 1.0, output = 5.0 }\n'
            "[langgraph.ollama]\n"
            'base_url = "http://x:11434"\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        # Reserved sub-tables routed to typed fields:
        assert config.langgraph_web_search_provider == "tavily"
        assert config.langgraph_mcp_servers == {"context7": {"transport": "stdio"}}
        assert config.langgraph_cost_overrides == {"my-model": {"input": 1.0, "output": 5.0}}

        # Only `ollama` lands in provider_kwargs - web_search/mcp/cost are excluded.
        assert config.langgraph_provider_kwargs == {"ollama": {"base_url": "http://x:11434"}}

    def test_scalar_langgraph_keys_not_treated_as_provider_subtables(self, tmp_workspace):
        """Top-level `model`, `max_tokens_override` are scalars, not sub-tables."""

        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            '[langgraph]\nmodel = "ollama:llama3.2:3b"\nmax_tokens_override = 65536\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.langgraph_model == "ollama:llama3.2:3b"
        assert config.langgraph_max_tokens_override == 65536
        # No provider sub-tables - provider_kwargs stays empty.
        assert config.langgraph_provider_kwargs == {}

    def test_cost_overrides_parsed_into_cost_overrides_field(self, tmp_workspace):
        settings_path = tmp_workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            "[langgraph.cost]\n"
            '"claude-sonnet-5" = { input = 3.0, output = 15.0 }\n'
            '"my-custom-model:7b" = { input = 0.5, output = 1.5 }\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.langgraph_cost_overrides == {
            "claude-sonnet-5": {"input": 3.0, "output": 15.0},
            "my-custom-model:7b": {"input": 0.5, "output": 1.5},
        }


class TestBundles:
    """[bundles.<name>] parses on every load and resolves by name as one more merge layer."""

    @staticmethod
    def _write(workspace, text):
        settings_path = workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(text)

        return settings_path

    def test_no_bundles_declared(self, tmp_workspace):
        self._write(tmp_workspace, '[env]\nA = "1"\n')

        config = Config.load(workspace_path=tmp_workspace)

        assert config.bundles is None
        assert config.bundle is None
        assert config.env == {"A": "1"}

    def test_declared_bundle_parses_without_touching_the_workspace_values(self, tmp_workspace):
        self._write(
            tmp_workspace,
            '[env]\nA = "1"\n'
            '[mounts]\n"/srv/a" = "/a"\n'
            "[ports]\n8080 = 80\n"
            '[bundles.research]\nmodel = "claude-opus-5-5"\n'
            '[bundles.research.env]\nA = "2"\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.bundles == {"research": {"model": "claude-opus-5-5", "env": {"A": "2"}}}
        assert config.env == {"A": "1"}
        assert config.mounts == {Path("/srv/a"): Path("/a")}
        assert config.ports == {8080: PortMapping(container=80)}

    def test_a_bundle_port_entry_inherits_the_workspaces_bind(self, tmp_workspace):
        self._write(
            tmp_workspace,
            '[ports]\n8080 = { container = 80, bind = "0.0.0.0" }\n9000 = 90\n'
            "[bundles.research.ports]\n8080 = { container = 81 }\n",
        )

        config = Config.resolve_bundle(tmp_workspace, "research")

        assert config.ports == {
            8080: PortMapping(container=81, bind="0.0.0.0"),
            9000: PortMapping(container=90),
        }

    def test_resolution_merges_the_bundle_over_the_workspace(self, tmp_workspace):
        self._write(
            tmp_workspace,
            '[env]\nA = "1"\nB = "2"\n'
            '[network]\nmode = "host"\n'
            '[bundles.research]\nmodel = "claude-opus-5-5"\nmessages = ["hello"]\n'
            '[bundles.research.env]\nB = "3"\nC = "4"\n'
            '[bundles.research.network]\nmode = "none"\n'
            '[bundles.research.mounts]\n"/srv/extra" = "/extra"\n',
        )

        config = Config.resolve_bundle(tmp_workspace, "research")

        assert config.bundle == "research"
        assert config.env == {"A": "1", "B": "3", "C": "4"}
        assert config.network_mode == "none"
        assert config.mounts == {Path("/srv/extra"): Path("/extra")}
        assert config.bundles == {
            "research": {
                "model": "claude-opus-5-5",
                "messages": ["hello"],
                "env": {"B": "3", "C": "4"},
                "network": {"mode": "none"},
                "mounts": {"/srv/extra": "/extra"},
            },
        }

    def test_bundle_mounts_resolve_like_the_workspace_ones(self, tmp_workspace):
        self._write(tmp_workspace, '[bundles.data.mounts]\n"/srv/x/../datasets" = "/datasets"\n')

        config = Config.resolve_bundle(tmp_workspace, "data")

        assert config.mounts == {Path("/srv/datasets"): Path("/datasets")}

    def test_unknown_name_raises_naming_it_and_the_settings_file(self, tmp_workspace):
        settings_path = self._write(tmp_workspace, "[bundles.research]\n")

        with pytest.raises(ValueError) as excinfo:
            Config.resolve_bundle(tmp_workspace, "typo")

        assert "'typo'" in str(excinfo.value)
        assert str(settings_path) in str(excinfo.value)
        assert "research" in str(excinfo.value)

    @pytest.mark.parametrize(
        "body",
        [
            'backend = "docker"',
            'profile = "/srv/profile"',
            'agent = "langgraph"',
            "root = true",
            'moddel = "claude-opus-5-5"',
            '[bundles.research.editor]\nurl_template = "x"',
            '[bundles.research.network]\nmode = "host"\ndns = "1.1.1.1"',
        ],
    )
    def test_a_key_outside_the_allowlist_raises_on_a_plain_load(self, tmp_workspace, body):
        settings_path = self._write(tmp_workspace, f"[bundles.research]\n{body}\n")

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert "'research'" in str(excinfo.value)
        assert str(settings_path) in str(excinfo.value)

    def test_the_refused_key_is_named(self, tmp_workspace):
        self._write(tmp_workspace, '[bundles.research]\nbackend = "docker"\n')

        with pytest.raises(ValueError, match="'backend'"):
            Config.load(workspace_path=tmp_workspace)

    @pytest.mark.parametrize("name", ["../x", "a/b", "a.b", "-lead", "with space"])
    def test_a_name_unfit_for_a_filename_raises(self, tmp_workspace, name):
        self._write(tmp_workspace, f'[bundles."{name}"]\nmodel = "m"\n')

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert repr(name) in str(excinfo.value)

    def test_bundles_layer_across_files_the_workspace_winning(self, tmp_workspace):
        home_settings = tmp_workspace / "_home" / CLAUDEBOX_SETTINGS_FILE
        home_settings.parent.mkdir(parents=True)
        home_settings.write_text('[bundles.research]\nmodel = "a"\neffort_level = "high"\n')
        self._write(tmp_workspace, '[bundles.research]\nmodel = "b"\n')

        config = Config.resolve_bundle(tmp_workspace, "research")

        assert config.bundles == {"research": {"model": "b", "effort_level": "high"}}

    def test_a_refused_key_in_home_names_the_home_file(self, tmp_workspace):
        home_settings = tmp_workspace / "_home" / CLAUDEBOX_SETTINGS_FILE
        home_settings.parent.mkdir(parents=True)
        home_settings.write_text('[bundles.research]\nbackend = "docker"\n')
        self._write(tmp_workspace, '[bundles.research]\nmodel = "b"\n')

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert str(home_settings) in str(excinfo.value)


class TestPorts:
    """[ports] loads in every accepted form and refuses anything else, naming the file."""

    @staticmethod
    def _write(workspace, text):
        settings_path = workspace / CLAUDEBOX_SETTINGS_FILE
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(text)

        return settings_path

    def test_the_three_forms_load(self, tmp_workspace):
        self._write(
            tmp_workspace,
            '[ports]\n8080 = 80\n8081 = "81/udp"\n9000 = { container = 90, bind = "0.0.0.0" }\n',
        )

        config = Config.load(workspace_path=tmp_workspace)

        assert config.ports == {
            8080: PortMapping(container=80),
            8081: PortMapping(container=81, protocol="udp"),
            9000: PortMapping(container=90, bind="0.0.0.0"),
        }

    def test_a_bad_entry_fails_the_load_naming_the_file(self, tmp_workspace):
        settings_path = self._write(
            tmp_workspace,
            '[ports]\n8080 = { container = 80, bind = "localhost" }\n',
        )

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert str(settings_path) in str(excinfo.value)
        assert "'8080'" in str(excinfo.value)

    def test_a_bad_entry_in_the_home_file_names_the_home_file(self, tmp_workspace):
        self._write(tmp_workspace, "[ports]\n8080 = 80\n")
        home_settings = self._write(
            tmp_workspace / "_home",
            '[ports]\n9000 = { container = 90, bind = "localhost" }\n',
        )

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert f"[ports] in {home_settings}: entry '9000'" in str(excinfo.value)

    def test_a_bad_entry_in_the_nearer_file_names_the_nearer_file(self, tmp_workspace):
        settings_path = self._write(
            tmp_workspace,
            '[ports]\n9000 = { container = 90, bind = "localhost" }\n',
        )
        self._write(tmp_workspace / "_home", "[ports]\n8080 = 80\n")

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert f"[ports] in {settings_path}: entry '9000'" in str(excinfo.value)

    def test_a_key_both_files_set_is_named_against_the_nearer_one(self, tmp_workspace):
        settings_path = self._write(
            tmp_workspace,
            '[ports]\n9000 = { container = 90, bind = "localhost" }\n',
        )
        self._write(tmp_workspace / "_home", "[ports]\n9000 = 90\n")

        with pytest.raises(ValueError) as excinfo:
            Config.load(workspace_path=tmp_workspace)

        assert f"[ports] in {settings_path}: entry '9000'" in str(excinfo.value)

    @pytest.mark.parametrize("declared_in", [".", "_home"])
    def test_a_bad_bundle_entry_names_the_bundle_table_and_its_file(
        self,
        tmp_workspace,
        declared_in,
    ):
        self._write(tmp_workspace, "[ports]\n8080 = 80\n")
        bundle_settings = self._write(
            tmp_workspace / declared_in,
            '[bundles.research.ports]\n7000 = { container = 70, bind = "example" }\n',
        )

        with pytest.raises(ValueError) as excinfo:
            Config.resolve_bundle(tmp_workspace, "research")

        assert f"[bundles.research.ports] in {bundle_settings}: entry '7000'" in str(excinfo.value)

    def test_a_bundle_part_that_breaks_a_workspace_entry_names_the_bundle_table(
        self,
        tmp_workspace,
    ):
        settings_path = self._write(
            tmp_workspace,
            "[ports]\n8080 = { container = 80 }\n"
            '[bundles.research.ports]\n8080 = { bind = "example" }\n',
        )

        with pytest.raises(ValueError) as excinfo:
            Config.resolve_bundle(tmp_workspace, "research")

        assert f"[bundles.research.ports] in {settings_path}: entry '8080'" in str(excinfo.value)
