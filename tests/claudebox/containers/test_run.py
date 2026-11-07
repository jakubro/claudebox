"""Tests for claudebox.containers.run - container CLI argument generation."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from claudebox.config import Config
from claudebox.constants import (
    CLAUDEBOX_SETTINGS_FILE,
    CONFIG_DIR_NAME,
    CONTAINER_IMAGE_NAME,
    CONTAINER_LIB_MOUNT,
    CONTAINER_PROFILE_MOUNT,
    CONTAINER_SESSIONS_MOUNT,
    DEFAULT_LABELS,
    LIB_RUN_DIR,
    WEB_CONTAINER_PORT,
)
from claudebox.containers.backend import ContainerBackend
from claudebox.containers.run import (
    _port_in_use,
    get_container_run_args,
    network_mode_publishes,
    prepare_volume,
    run_container,
    substitute_held_ports,
    tmp_mount_conflicts,
)
from claudebox.core.ports import PortMapping
from ...fake_podman import FakePodman, on_fake_podman, publishes


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
        "containers_nested": False,
    }
    defaults.update(overrides)

    return Config(**defaults)  # ty: ignore[invalid-argument-type]


def _make_workspace_config(tmp_path, **overrides):
    """Create a Config whose config dir sits inside the workspace, as a `.workspace` marker does."""

    work_dir = tmp_path / "workspace"

    return _make_config(
        tmp_path,
        work_dir=work_dir,
        config_dir=work_dir / CONFIG_DIR_NAME,
        **overrides,
    )


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

    def test_bundle_name_reaches_the_container(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, bundle="research")
        args = list(get_container_run_args(config))

        env_args = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        assert "CLAUDEBOX_BUNDLE=research" in env_args

    def test_unbundled_container_carries_no_bundle_variable(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))

        assert not any(str(a).startswith("CLAUDEBOX_BUNDLE=") for a in args)

    def test_publish_all(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, publish_all=True))
        assert "--publish-all" not in args
        publish_args = [args[i + 1] for i, a in enumerate(args) if a == "--publish"]
        assert publish_args == ["127.0.0.1::8080", "127.0.0.1::8081"]

    def test_explicit_ports(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, ports={8080: 80})
        args = list(get_container_run_args(config))

        publish_args = [args[i + 1] for i, a in enumerate(args) if a == "--publish"]
        assert "127.0.0.1:8080:80" in publish_args

    def test_publish_all_and_config_ports_are_emitted_together(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        config = _make_config(tmp_path, ports={8080: 80, 9000: 90})
        args = list(get_container_run_args(config, publish_all=True))

        publish_args = [args[i + 1] for i, a in enumerate(args) if a == "--publish"]
        assert publish_args == [
            f"127.0.0.1::{WEB_CONTAINER_PORT}",
            "127.0.0.1::8081",
            "127.0.0.1:8080:80",
            "127.0.0.1:9000:90",
        ]

    @pytest.mark.parametrize(
        ("entry", "spec"),
        [
            ({"container": 90, "bind": "0.0.0.0"}, "0.0.0.0:9000:90"),
            ({"container": 90, "bind": "::"}, "[::]:9000:90"),
        ],
        ids=["every-interface", "ipv6"],
    )
    def test_an_entry_naming_a_bind_publishes_there(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
        entry,
        spec,
    ):
        config = _make_config(tmp_path, ports={"9000": entry})
        args = list(get_container_run_args(config))

        assert [args[i + 1] for i, a in enumerate(args) if a == "--publish"] == [spec]

    def test_a_free_host_port_publishes_on_loopback_with_no_host_port(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        config = _make_config(tmp_path, ports={0: 3000})
        args = list(get_container_run_args(config))

        assert [args[i + 1] for i, a in enumerate(args) if a == "--publish"] == ["127.0.0.1::3000"]

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

    def test_config_network_overrides_param(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, network_mode="host")
        args = list(get_container_run_args(config, network="custom"))

        network_args = [args[i + 1] for i, a in enumerate(args) if a == "--network"]
        assert network_args == ["host"]

    def test_param_network_applies_when_config_names_none(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config, network="custom"))

        network_args = [args[i + 1] for i, a in enumerate(args) if a == "--network"]
        assert network_args == ["custom"]

    def test_no_network(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert "--network" not in args

    def test_no_nested_device_by_default(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert "--device" not in args

    def test_nested_device_when_enabled(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, containers_nested=True)
        args = list(get_container_run_args(config))

        idx = args.index("--device")
        assert args[idx + 1] == "/dev/fuse"

    def test_nested_tmpfs_graphroot_when_enabled(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, containers_nested=True)
        args = list(get_container_run_args(config))

        idx = args.index("--tmpfs")
        assert args[idx + 1].startswith("/var/lib/containers-storage:size=")

    def test_no_nested_tmpfs_by_default(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))
        assert "--tmpfs" not in args

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
            ),
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
            ),
        )
        vol_args = [args[i + 1] for i, a in enumerate(args) if a == "--volume"]
        assert f"{host_file.resolve()}:/root/.mcp.json:ro" in vol_args
        _touch_file.assert_called()

    def test_volume_mounts_create_paths(self, mock_touch_file, mock_touch_dir, tmp_path):
        config = _make_config(tmp_path)
        list(get_container_run_args(config))

        assert mock_touch_dir.called, "touch_dir should be called to create mount directories"
        assert mock_touch_file.called, "touch_file should be called to create mount files"


# --- mount modes ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestMountModes:
    """Which mounts a container may write, and which it may only read."""

    @staticmethod
    def _mode(args, container_path):
        """Report 'ro', 'rw' or None for the mount whose destination is container_path."""

        for i, arg in enumerate(args):
            if arg != "--volume":
                continue

            parts = args[i + 1].split(":")

            if parts[1] == str(container_path):
                return parts[2] if len(parts) > 2 else "rw"

        return None

    def test_the_library_is_read_only(self, _touch_file, _touch_dir, tmp_path):
        args = list(get_container_run_args(_make_config(tmp_path)))

        assert self._mode(args, CONTAINER_LIB_MOUNT) == "ro"

    def test_the_runtime_overlay_is_read_only(self, _touch_file, _touch_dir, tmp_path):
        args = list(get_container_run_args(_make_config(tmp_path)))
        overlay_root = LIB_RUN_DIR / "fs"
        overlay = [
            Path("/") / f.relative_to(overlay_root)
            for f in overlay_root.glob("**/*")
            if f.is_file()
        ]

        assert overlay, "the runtime overlay ships no files"
        assert [self._mode(args, dst) for dst in overlay] == ["ro"] * len(overlay)

    def test_the_profile_is_read_only(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path, profile=tmp_path / "profile")
        args = list(get_container_run_args(config))

        assert self._mode(args, CONTAINER_PROFILE_MOUNT) == "ro"

    def test_the_workspace_stays_writable(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))

        assert self._mode(args, config.work_dir) == "rw"

    def test_the_sessions_tree_stays_writable(self, _touch_file, _touch_dir, tmp_path):
        args = list(get_container_run_args(_make_config(tmp_path)))

        assert self._mode(args, CONTAINER_SESSIONS_MOUNT) == "rw"

    def test_the_workspace_settings_file_is_read_only(self, _touch_file, _touch_dir, tmp_path):
        config = _make_workspace_config(tmp_path)
        args = list(get_container_run_args(config))

        assert self._mode(args, config.work_dir / CLAUDEBOX_SETTINGS_FILE) == "ro"

    def test_the_workspace_config_dir_is_mounted_and_stays_writable(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        """Being a mount point is the point - it cannot be renamed around the read-only file."""

        config = _make_workspace_config(tmp_path)
        args = list(get_container_run_args(config))

        assert self._mode(args, config.config_dir) == "rw"

    def test_a_config_dir_outside_the_workspace_is_left_alone(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        """With no workspace marker the config dir is under home, out of the container's reach."""

        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))

        assert self._mode(args, config.config_dir) is None

    def test_an_unregistered_directorys_own_settings_file_is_read_only(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        """No marker: config_dir sits under home, but the loader reads work_dir/.claudebox -
        that is the file that must be protected, regardless of where config_dir points."""

        config = _make_config(tmp_path)
        args = list(get_container_run_args(config))

        assert self._mode(args, config.work_dir / CLAUDEBOX_SETTINGS_FILE) == "ro"
        assert self._mode(args, (config.work_dir / CLAUDEBOX_SETTINGS_FILE).parent) == "rw"
        assert self._mode(args, config.config_dir / "settings.toml") is None


# Unmocked touch_file is the point here, so the overlay glob is pointed away from the real repo
# files it would otherwise touch - the test sandbox mounts the tree read-only and touch() raises.
@patch("claudebox.containers.run.LIB_RUN_DIR", Path("/nonexistent"))
def test_the_settings_file_is_created_when_the_workspace_has_none(tmp_path):
    """An absent file cannot be mounted, and an unmounted one is what the next spawn would read."""

    config = _make_workspace_config(tmp_path)

    list(get_container_run_args(config))

    assert (config.work_dir / CLAUDEBOX_SETTINGS_FILE).is_file()


@patch("claudebox.containers.run.LIB_RUN_DIR", Path("/nonexistent"))
class TestAgentConfigFile:
    """The agent refuses to start on a config file that is not JSON, and an empty file is not."""

    @staticmethod
    def _agent_config(config):
        return config.config_dir / "fs" / "root" / ".claude.json"

    def test_a_fresh_config_dir_gets_an_empty_object(self, tmp_path):
        config = _make_workspace_config(tmp_path)

        list(get_container_run_args(config))

        assert json.loads(self._agent_config(config).read_text()) == {}

    def test_an_empty_file_gets_an_empty_object(self, tmp_path):
        config = _make_workspace_config(tmp_path)
        self._agent_config(config).parent.mkdir(parents=True)
        self._agent_config(config).touch()

        list(get_container_run_args(config))

        assert json.loads(self._agent_config(config).read_text()) == {}

    def test_a_file_with_content_is_left_alone(self, tmp_path):
        config = _make_workspace_config(tmp_path)
        signed_in = b'{"oauthAccount": {"emailAddress": "user@example.com"}}'
        self._agent_config(config).parent.mkdir(parents=True)
        self._agent_config(config).write_bytes(signed_in)

        list(get_container_run_args(config))

        assert self._agent_config(config).read_bytes() == signed_in

    def test_another_runtime_gets_no_file(self, tmp_path):
        config = _make_workspace_config(tmp_path, agent="langgraph")

        list(get_container_run_args(config))

        assert not self._agent_config(config).exists()


# --- prepare_volume ---


class TestMapVolume:
    """Test volume mount path resolution."""

    def test_creates_directory(self, tmp_path):
        src, _dst = prepare_volume(tmp_path / "new_dir", "/container/path")
        assert src.exists()
        assert src.is_dir()

    def test_creates_file(self, tmp_path):
        src, _dst = prepare_volume(tmp_path / "new_file", "/container/path", is_dir=False)
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


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerRunId:
    """Each `run_container` labels its container with a fresh run id and hands the agent the same id."""

    def _run_id(self, tmp_path) -> tuple[str, str]:
        backend = MagicMock()
        backend.run_container.return_value = 0

        run_container((), config=_make_config(tmp_path), backend=backend)

        args = list(backend.run_container.call_args.args)
        env = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
        label = next(
            v
            for v in _label_args(backend.run_container.call_args)
            if v.startswith("claudebox-run=")
        )
        variable = next(v for v in env if v.startswith("CLAUDEBOX_RUN_ID="))

        return label.split("=", 1)[1], variable.split("=", 1)[1]

    def test_the_label_and_the_variable_carry_one_id(self, _touch_file, _touch_dir, tmp_path):
        label, variable = self._run_id(tmp_path)

        assert label
        assert label == variable

    def test_every_run_gets_its_own_id(self, _touch_file, _touch_dir, tmp_path):
        assert self._run_id(tmp_path)[0] != self._run_id(tmp_path)[0]


class TestTmpMountConflicts:
    """What a daemon spawn would have to delete to remap /tmp."""

    @pytest.fixture(autouse=True)
    def _real_tmp(self, monkeypatch):
        monkeypatch.setattr("claudebox.temp.TMP_PATH", Path("/tmp"))

    def test_a_workspace_under_tmp(self, tmp_path):
        config = _make_config(tmp_path, work_dir=Path("/tmp/proj"))

        assert tmp_mount_conflicts(config) == [Path("/tmp/proj")]

    def test_tmp_itself(self, tmp_path):
        config = _make_config(tmp_path, work_dir=Path("/tmp"))

        assert tmp_mount_conflicts(config) == [Path("/tmp")]

    def test_a_mount_target_under_tmp(self, tmp_path):
        config = _make_config(
            tmp_path,
            work_dir=Path("/srv/proj"),
            mounts={Path("/home/u/.ssh-agent"): Path("/tmp/ssh-agent")},
        )

        assert tmp_mount_conflicts(config) == [Path("/tmp/ssh-agent")]

    def test_a_sibling_sharing_the_prefix(self, tmp_path):
        config = _make_config(tmp_path, work_dir=Path("/tmpfoo"))

        assert tmp_mount_conflicts(config) == []

    def test_the_opt_out(self, tmp_path):
        config = _make_config(
            tmp_path,
            work_dir=Path("/tmp/proj"),
            env={"CLAUDEBOX_NO_TMP_REMAP": "1"},
        )

        assert tmp_mount_conflicts(config) == []


# --- Fixed host ports and network modes ---


@pytest.mark.parametrize(
    ("mode", "publishes_ports"),
    [
        (None, True),
        ("mynet", True),
        ("bridge", True),
        ("pasta", True),
        ("slirp4netns:allow_host_loopback=true", True),
        ("host", False),
        ("none", False),
        ("container:abc", False),
        ("ns:/run/netns/x", False),
    ],
)
def test_network_mode_publishes(mode, publishes_ports):
    assert network_mode_publishes(mode) is publishes_ports


@pytest.mark.allow_hosts(["127.0.0.1"])
def test_port_in_use_sees_a_loopback_listener():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]

    assert _port_in_use(port, PortMapping(container=80)) is True
    listener.close()
    assert _port_in_use(port, PortMapping(container=80)) is False


@pytest.mark.allow_hosts(["127.0.0.1", "::1"])
@pytest.mark.parametrize(
    ("family", "kind", "address", "entry"),
    [
        (socket.AF_INET6, socket.SOCK_STREAM, "::1", {"container": 80, "bind": "::1"}),
        (socket.AF_INET6, socket.SOCK_STREAM, "::", {"container": 80, "bind": "::"}),
        (socket.AF_INET, socket.SOCK_DGRAM, "127.0.0.1", "53/udp"),
        (socket.AF_INET, socket.SOCK_STREAM, "127.0.0.1", 80),
    ],
    ids=["ipv6-loopback-tcp", "ipv6-wildcard-tcp", "ipv4-udp", "ipv4-tcp"],
)
def test_a_held_port_on_the_entrys_family_and_protocol_is_swapped(family, kind, address, entry):
    with socket.socket(family, kind) as holder:
        if family == socket.AF_INET6:
            holder.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)

        holder.bind((address, 0))

        if kind == socket.SOCK_STREAM:
            holder.listen()

        port = holder.getsockname()[1]
        swapped = substitute_held_ports({str(port): entry})

    assert port in swapped
    assert swapped[port] != port


@pytest.mark.allow_hosts(["127.0.0.1", "::1"])
@pytest.mark.parametrize(
    ("family", "kind", "address", "entry"),
    [
        (socket.AF_INET6, socket.SOCK_STREAM, "::1", {"container": 80, "bind": "127.0.0.1"}),
        (socket.AF_INET, socket.SOCK_DGRAM, "127.0.0.1", 80),
        (socket.AF_INET, socket.SOCK_STREAM, "127.0.0.1", "53/udp"),
    ],
    ids=["ipv6-holder-ipv4-entry", "udp-holder-tcp-entry", "tcp-holder-udp-entry"],
)
def test_a_holder_of_another_family_or_protocol_leaves_the_entry_alone(
    family,
    kind,
    address,
    entry,
):
    with socket.socket(family, kind) as holder:
        holder.bind((address, 0))

        if kind == socket.SOCK_STREAM:
            holder.listen()

        port = holder.getsockname()[1]

        assert substitute_held_ports({str(port): entry}) == {}


@pytest.mark.allow_hosts(["127.0.0.1"])
def test_an_sctp_entry_on_a_host_without_sctp_keeps_the_tcp_probe():
    with (
        patch.object(socket, "IPPROTO_SCTP", 253),
        socket.socket(socket.AF_INET, socket.SOCK_STREAM) as holder,
    ):
        holder.bind(("127.0.0.1", 0))
        holder.listen()
        port = holder.getsockname()[1]

        assert port in substitute_held_ports({str(port): "132/sctp"})


def test_substitute_held_ports():
    with (
        patch("claudebox.containers.run._port_in_use", lambda port, _mapping: port == 8080),
        patch("claudebox.containers.run._free_port", lambda _mapping: 41000),
    ):
        # TOML table keys arrive as strings.
        ports = {"8080": 80, "9000": 90, "0": 70}
        assert substitute_held_ports(ports) == {8080: 41000}


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
def test_port_substitutes_reshape_only_the_named_entry(_tf, _td, tmp_path):
    config = _make_config(tmp_path, ports={"8080": 80, "9000": 90})

    args = list(get_container_run_args(config, publish_all=True, port_substitutes={8080: 41000}))

    assert [args[i + 1] for i, a in enumerate(args) if a == "--publish"] == [
        f"127.0.0.1::{WEB_CONTAINER_PORT}",
        "127.0.0.1::8081",
        "127.0.0.1:41000:80",
        "127.0.0.1:9000:90",
    ]


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
def test_cli_substitutes_a_held_port_and_prints_it(_tf, _td, tmp_path, capsys):
    podman = FakePodman()
    podman.held.add(8080)
    config = _make_config(tmp_path, ports={"8080": 80}, env={"CLAUDEBOX_NO_TMP_REMAP": "1"})

    with on_fake_podman(podman):
        run_container(("bash",), config=config, backend=ContainerBackend("podman"), kind="shell")

    assert publishes(podman.runs[0]) == ["127.0.0.1:40001:80"]
    assert capsys.readouterr().err == (
        "claudebox: host port 8080 is in use; container port 80 is published on host port 40001 instead\n"
    )


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
def test_cli_probes_nothing_under_host_network(_tf, _td, tmp_path):
    backend = MagicMock()
    backend.run_container.return_value = 0
    config = _make_config(tmp_path, ports={"8080": 80}, network_mode="host")

    def _never(_port, _mapping):
        raise AssertionError("probed a port under host networking")

    with patch("claudebox.containers.run._port_in_use", _never):
        assert run_container((), config=config, backend=backend) == 0
