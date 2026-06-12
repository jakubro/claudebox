"""Tests for claudebox.containers.runtime - facade behavior over backend."""

from unittest.mock import MagicMock, patch

from claudebox.config import Config
from claudebox.containers.runtime import ContainerRuntime


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
