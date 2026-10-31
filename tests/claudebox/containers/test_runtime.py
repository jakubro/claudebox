"""Tests for claudebox.containers.runtime - facade behavior over backend."""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from claudebox import temp
from claudebox.config import Config
from claudebox.containers.runtime import ContainerRuntime
from claudebox.temp import TmpRemapBlocked


def _make_config(tmp_path):
    return Config(
        work_dir=tmp_path / "workspace",
        config_dir=tmp_path / ".claudebox",
        agent="claude",
        backend="podman",
        profile=None,
        mounts=None,
        ports=None,
        network_mode=None,
        env=None,
    )


# --- run() exit-code propagation ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunReturnsExitCode:
    """`ContainerRuntime.run()` returns the container's exit code from the backend."""

    def test_returns_zero(self, _touch_file, _touch_dir, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = 0

        assert runtime.run() == 0

    def test_propagates_nonzero(self, _touch_file, _touch_dir, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = 130

        assert runtime.run(("--", "fail")) == 130


# --- run() threads the kind label ---


def _label_args(call_args) -> list[str]:
    backend_args = list(call_args.args)

    return [backend_args[i + 1] for i, a in enumerate(backend_args) if a == "--label"]


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunKindLabel:
    """`ContainerRuntime.run()` threads ``kind`` to the underlying spawn."""

    def test_default_kind_is_agent(self, _touch_file, _touch_dir, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = 0

        runtime.run()

        assert "kind=agent" in _label_args(runtime._backend.run_container.call_args)

    def test_kind_shell(self, _touch_file, _touch_dir, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = 0

        runtime.run(kind="shell")

        assert "kind=shell" in _label_args(runtime._backend.run_container.call_args)


# --- stop_container / kill_container routing ---


class TestStopKillRouting:
    """`ContainerRuntime` routes stop/kill to the appropriate backend method."""

    def test_stop_delegates_to_backend_stop_with_grace(self, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()

        runtime.stop_container("b1", grace_seconds=10)

        runtime._backend.stop.assert_called_once_with("b1", timeout=10)
        runtime._backend.kill.assert_not_called()

    def test_stop_propagates_custom_grace(self, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()

        runtime.stop_container("b1", grace_seconds=5)

        runtime._backend.stop.assert_called_once_with("b1", timeout=5)

    def test_kill_delegates_to_backend_kill(self, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()

        runtime.kill_container("b1")

        runtime._backend.kill.assert_called_once_with("b1")
        runtime._backend.stop.assert_not_called()


# --- run_container per-call config override ---


def _volume_args(call_args) -> list[str]:
    backend_args = list(call_args.args)

    return [backend_args[i + 1] for i, a in enumerate(backend_args) if a == "--volume"]


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerConfigOverride:
    """`ContainerRuntime.run_container(config=...)` builds run args from the override, not self.config."""

    def test_override_config_supplies_volumes(self, _touch_file, _touch_dir, tmp_path):
        runtime = ContainerRuntime(_make_config(tmp_path))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = "b1"

        override = _make_config(tmp_path)
        override.mounts = {tmp_path / "fresh_src": tmp_path / "fresh_dst"}

        runtime.run_container(name="c1", labels={}, env={}, detach=True, config=override)

        volumes = _volume_args(runtime._backend.run_container.call_args)
        assert any("fresh_src" in v for v in volumes)

    def test_without_override_uses_self_config(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        config.mounts = {tmp_path / "snapshot_src": tmp_path / "snapshot_dst"}
        runtime = ContainerRuntime(config)
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = "b1"

        runtime.run_container(name="c1", labels={}, env={}, detach=True)

        volumes = _volume_args(runtime._backend.run_container.call_args)
        assert any("snapshot_src" in v for v in volumes)


# --- run_container() refuses a /tmp conflict ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerRefusesTmpConflicts:
    """A detached daemon spawn refuses what the session would delete; the terminal run does not."""

    def test_a_workspace_under_tmp_never_reaches_the_backend(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        config = _make_config(tmp_path)
        config.work_dir = temp.TMP_PATH / "proj"
        runtime = ContainerRuntime(config)
        runtime._backend = MagicMock()

        with pytest.raises(TmpRemapBlocked) as excinfo:
            runtime.run_container(name="c", labels={}, env={}, detach=True)

        assert excinfo.value.context == {"paths": str(temp.TMP_PATH / "proj"), "reason": "mounted"}
        runtime._backend.run_container.assert_not_called()

    def test_the_terminal_run_is_not_checked(self, _touch_file, _touch_dir, tmp_path):
        config = _make_config(tmp_path)
        config.work_dir = temp.TMP_PATH / "proj"
        runtime = ContainerRuntime(config)
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = 0

        assert runtime.run() == 0


# --- run_container() substitutes held fixed ports under one lock ---


def _ported_config(tmp_path, ports):
    config = _make_config(tmp_path)
    config.ports = ports
    config.env = {"CLAUDEBOX_NO_TMP_REMAP": "1"}

    return config


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestRunContainerFixedPorts:
    def test_run_container_publishes_a_held_port_on_a_free_one(self, _tf, _td, tmp_path):
        runtime = ContainerRuntime(_ported_config(tmp_path, {"8080": 80}))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = "b1"

        with (
            patch("claudebox.containers.run._port_in_use", {8080}.__contains__),
            patch("claudebox.containers.run._free_port", lambda: 41000),
        ):
            runtime.run_container(name="c1", labels={}, env={}, detach=True)

        args = list(runtime._backend.run_container.call_args.args)
        assert "41000:80" in [args[i + 1] for i, a in enumerate(args) if a == "--publish"]

    def test_probe_and_run_are_serialised(self, _tf, _td, tmp_path):
        runtime = ContainerRuntime(_ported_config(tmp_path, {"8080": 80}))
        inside = threading.Semaphore(1)
        overlaps = []

        def slow_run(*_args, **_kwargs):
            if not inside.acquire(blocking=False):
                overlaps.append(True)

            time.sleep(0.05)
            inside.release()

            return "b1"

        runtime._backend = MagicMock()
        runtime._backend.run_container.side_effect = slow_run

        with patch("claudebox.containers.run._port_in_use", lambda _port: False):
            threads = [
                threading.Thread(
                    target=runtime.run_container,
                    kwargs={"name": f"c{n}", "labels": {}, "env": {}, "detach": True},
                )
                for n in range(2)
            ]

            for thread in threads:
                thread.start()

            for thread in threads:
                thread.join()

        assert overlaps == []

    def test_no_fixed_ports_takes_no_lock(self, _tf, _td, tmp_path):
        runtime = ContainerRuntime(_ported_config(tmp_path, None))
        runtime._backend = MagicMock()
        runtime._backend.run_container.return_value = "b1"

        with patch("claudebox.containers.runtime._FIXED_PORT_LOCK", None):
            assert runtime.run_container(name="c1", labels={}, env={}, detach=True) == "b1"
