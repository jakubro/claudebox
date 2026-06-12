"""Tests for claudebox.containers.run - container CLI argument generation."""

from pathlib import Path
from unittest.mock import MagicMock, patch

from claudebox.config import Config
from claudebox.constants import CONTAINER_IMAGE_NAME, DEFAULT_LABELS
from claudebox.containers.run import get_container_run_args, prepare_volume, run_container


# --- Helpers ---


def _make_config(tmp_path, **overrides):
    """Create a Config with sensible defaults for testing."""

    defaults = {
        "work_dir": tmp_path / "workspace",
        "config_dir": tmp_path / ".claudebox",
        "agent": "claude",
        "backend": "podman",
        "profile": None,
        "mounts": None,
        "ports": None,
        "network_mode": None,
        "env": None,
    }
    defaults.update(overrides)

    return Config(**defaults)  # ty: ignore[invalid-argument-type]


# --- get_run_args ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestGetContainerArgs:
    """Test container argument generation from config."""

    def test_interactive_flags(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, interactive=True))
        assert "--interactive" in args
        assert "--tty" in args

    def test_non_interactive_omits_flags(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, interactive=False))
        assert "--interactive" not in args
        assert "--tty" not in args

    def test_default_labels_included(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))

        label_args = [args[i + 1] for i, a in enumerate(args) if a == "--label"]

        for key, val in DEFAULT_LABELS.items():
            assert f"{key}={val}" in label_args

    def test_caller_labels_merged(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, labels={"custom": "val"}))

        label_args = [args[i + 1] for i, a in enumerate(args) if a == "--label"]
        assert "custom=val" in label_args

    def test_agent_env(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, agent="my-agent")
        args = list(get_container_run_args(config))

        env_args = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        assert "CLAUDEBOX_AGENT=my-agent" in env_args

    def test_verbose_env(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, verbose=True))

        env_args = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        assert "CLAUDEBOX_VERBOSE=1" in env_args

    def test_config_env_passed(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, env={"MY_VAR": "my_val"})
        args = list(get_container_run_args(config))

        env_args = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        assert "MY_VAR=my_val" in env_args

    def test_caller_env_passed(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, env={"CALLER": "yes"}))

        env_args = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        assert "CALLER=yes" in env_args

    def test_publish_all(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, publish_all=True))
        assert "--publish-all" in args

    def test_explicit_ports(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, ports={8080: 80})
        args = list(get_container_run_args(config))

        publish_args = [args[i + 1] for i, a in enumerate(args) if a == "--publish"]
        assert "8080:80" in publish_args

    def test_no_ports(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert "--publish" not in args
        assert "--publish-all" not in args

    def test_network_from_param(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, network="my-net"))

        idx = args.index("--network")
        assert args[idx + 1] == "my-net"

    def test_network_from_config(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, network_mode="host")
        args = list(get_container_run_args(config))

        idx = args.index("--network")
        assert args[idx + 1] == "host"

    def test_network_param_overrides_config(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, network_mode="host")
        args = list(get_container_run_args(config, network="custom"))

        idx = args.index("--network")
        assert args[idx + 1] == "custom"

    def test_no_network(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert "--network" not in args

    def test_image_name_present(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert CONTAINER_IMAGE_NAME in args

    def test_cmd_args_after_image(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, cmd_args=["bash", "-c", "echo hi"]))
        assert args[-3:] == ["bash", "-c", "echo hi"]

    def test_name_before_image(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, name="my-container"))
        name_idx = args.index("--name")
        image_idx = args.index(CONTAINER_IMAGE_NAME)
        assert args[name_idx + 1] == "my-container"
        assert name_idx < image_idx

    def test_run_args_before_image(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, run_args=["--cap-add", "SYS_PTRACE"]))
        image_idx = args.index(CONTAINER_IMAGE_NAME)
        cap_idx = args.index("--cap-add")
        assert cap_idx < image_idx

    def test_extra_volumes_before_image(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        host_dir = tmp_path / "extra"
        args = list(
            get_container_run_args(
                config,
                extra_volumes=[(host_dir, "/container/path:ro", True)],
            )
        )
        image_idx = args.index(CONTAINER_IMAGE_NAME)
        vol_args = [args[i + 1] for i, a in enumerate(args) if a == "--volume"]
        assert f"{host_dir.resolve()}:/container/path:ro" in vol_args

        # All --volume flags should be before image
        for i, a in enumerate(args):
            if a == "--volume":
                assert i < image_idx

    def test_extra_volumes_file(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        host_file = tmp_path / "config.json"
        args = list(
            get_container_run_args(
                config,
                extra_volumes=[(host_file, "/root/.mcp.json:ro", False)],
            )
        )
        vol_args = [args[i + 1] for i, a in enumerate(args) if a == "--volume"]
        assert f"{host_file.resolve()}:/root/.mcp.json:ro" in vol_args
        _touch_file.assert_called()

    def test_volume_mounts_create_paths(self, mock_touch_file, mock_touch_dir, tmp_path):
        config = _make_config(tmp_path)
        list(get_container_run_args(config))

        assert mock_touch_dir.called, "touch_dir should be called to create mount directories"
        assert mock_touch_file.called, "touch_file should be called to create mount files"


# --- prepare_volume ---


class TestMapVolume:
    """Test volume mount path resolution."""

    def test_creates_directory(self, tmp_path):
        src, dst = prepare_volume(tmp_path / "new_dir", "/container/path")
        assert src.exists()
        assert src.is_dir()

    def test_creates_file(self, tmp_path):
        src, dst = prepare_volume(tmp_path / "new_file", "/container/path", is_dir=False)
        assert src.exists()
        assert src.is_file()

    def test_returns_resolved_paths(self, tmp_path):
        src, dst = prepare_volume(tmp_path / "vol", "/dst")
        assert src == (tmp_path / "vol").resolve()
        assert dst == Path("/dst").resolve()


# --- run_container exit-code propagation ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerPropagation:
    """`run_container` returns the backend's container exit code."""

    def test_returns_zero_on_success(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        backend = MagicMock()
        backend.run_container.return_value = 0

        result = run_container((), config=config, backend=backend)

        assert result == 0
        backend.run_container.assert_called_once()
        assert backend.run_container.call_args.kwargs == {}

    def test_propagates_nonzero(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        backend = MagicMock()
        backend.run_container.return_value = 17

        result = run_container((), config=config, backend=backend)

        assert result == 17


# --- run_container kind label ---


def _label_args(call_args) -> list[str]:
    """Extract values immediately following --label flags in a backend call."""

    backend_args = list(call_args.args)

    return [backend_args[i + 1] for i, a in enumerate(backend_args) if a == "--label"]


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerKindLabel:
    """`run_container` stamps a ``kind`` label on every spawned container."""

    def test_default_kind_is_agent(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        backend = MagicMock()
        backend.run_container.return_value = 0

        run_container((), config=config, backend=backend)

        assert "kind=agent" in _label_args(backend.run_container.call_args)

    def test_kind_shell_for_shell_invocation(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        backend = MagicMock()
        backend.run_container.return_value = 0

        run_container((), config=config, backend=backend, kind="shell")

        labels = _label_args(backend.run_container.call_args)
        assert "kind=shell" in labels
        assert "kind=agent" not in labels
