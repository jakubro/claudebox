"""Tests for claudebox.containers.backend — subprocess abstraction."""

import json
import subprocess
from unittest.mock import MagicMock, call, patch

import pytest

from claudebox.containers.backend import ContainerBackend


# --- _exec ---


class TestExec:
    """Test command execution dispatch."""

    @patch("subprocess.run")
    def test_exec_calls_subprocess_run(self, mock_run):
        backend = ContainerBackend("podman")
        backend._exec("ps", check=True)
        mock_run.assert_called_once_with(["podman", "ps"], check=True)

    @patch("os.execvp")
    def test_exec_replace_calls_execvp(self, mock_execvp):
        backend = ContainerBackend("podman")
        backend._exec("run", "--rm", "img", replace=True)
        mock_execvp.assert_called_once_with("podman", ["podman", "run", "--rm", "img"])

    @patch("subprocess.run")
    @patch("claudebox.containers.backend.print_command")
    def test_verbose_prints_command(self, mock_print, mock_run):
        backend = ContainerBackend("podman", verbose=True)
        backend._exec("ps")
        mock_print.assert_called_once_with("podman", "ps")


# --- build_image ---


class TestBuildImage:
    """Test image build command."""

    @patch("subprocess.run")
    def test_build_image(self, mock_run):
        backend = ContainerBackend("podman")
        backend.build_image("--file", "Containerfile", ".")
        mock_run.assert_called_once_with(
            ["podman", "build", "--file", "Containerfile", "."], check=True
        )


# --- run_container ---


class TestRunContainer:
    """Test container run with detach and non-detach modes."""

    @patch("subprocess.run")
    def test_non_detach_runs_with_rm_and_propagates_returncode(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        backend = ContainerBackend("podman")
        result = backend.run_container("--interactive", "img", detach=False)
        assert result == 0
        args = mock_run.call_args[0][0]
        assert "run" in args
        assert "--rm" in args

    @patch("subprocess.run")
    def test_non_detach_propagates_nonzero_returncode(self, mock_run):
        """Non-zero subprocess returncode surfaces through run_container."""

        mock_run.return_value = MagicMock(returncode=42)
        backend = ContainerBackend("podman")
        result = backend.run_container("img", detach=False)
        assert result == 42

    @patch("subprocess.run")
    def test_detach_returns_container_id(self, mock_run):
        mock_run.return_value = MagicMock(
            stdout=b"abc123\n",
            check_returncode=MagicMock(),
        )
        backend = ContainerBackend("podman")
        result = backend.run_container("img", detach=True)
        assert result == "abc123"
        cmd = mock_run.call_args[0][0]
        assert "--detach" in cmd

    @patch("subprocess.run")
    def test_detach_failure_removes_container_and_reraises(self, mock_run):
        proc = MagicMock(stdout=b"abc123\n")
        proc.check_returncode.side_effect = subprocess.CalledProcessError(1, "podman")

        # First call: run --detach. Subsequent calls: logs, rm --force
        mock_run.side_effect = [proc, MagicMock(), MagicMock()]

        backend = ContainerBackend("podman")
        with pytest.raises(subprocess.CalledProcessError):
            backend.run_container("img", detach=True)

        # Verify cleanup: logs then rm --force
        assert mock_run.call_args_list[1] == call(["podman", "logs", "abc123"], check=True)
        assert mock_run.call_args_list[2] == call(["podman", "rm", "--force", "abc123"], check=True)

        # Also verify cleanup commands contain expected subcommands (resilient to ordering changes)
        all_cmds = [str(c) for c in mock_run.call_args_list]
        assert any("logs" in c for c in all_cmds)
        assert any("rm" in c and "--force" in c for c in all_cmds)


# --- stop ---


class TestStop:
    """Graceful stop via ``podman stop --time``."""

    @patch("subprocess.run")
    def test_passes_timeout_to_podman_time(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        backend = ContainerBackend("podman")
        backend.stop("abc123", timeout=30)

        assert mock_run.call_args[0][0] == ["podman", "stop", "--time", "30", "abc123"]


# --- kill ---


class TestKill:
    """Immediate SIGKILL via ``podman kill``."""

    @patch("subprocess.run")
    def test_kill_sends_sigkill(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        backend = ContainerBackend("podman")
        backend.kill("abc123")

        assert mock_run.call_args[0][0] == ["podman", "kill", "--signal", "KILL", "abc123"]


# --- inspect_container ---


class TestInspectContainer:
    """Test container inspection JSON parsing."""

    @patch("subprocess.run")
    def test_inspect_parses_json(self, mock_run):
        data = [{"Id": "abc123", "State": {"Running": True}}]
        mock_run.return_value = MagicMock(stdout=json.dumps(data).encode())
        backend = ContainerBackend("podman")
        result = backend.inspect_container("abc123")
        assert result[0]["Id"] == "abc123"
        cmd = mock_run.call_args[0][0]
        assert "inspect" in cmd


# --- get_host_port ---


class TestGetHostPort:
    """Test host port extraction from inspect data."""

    @patch("subprocess.run")
    def test_get_host_port(self, mock_run):
        data = [{"NetworkSettings": {"Ports": {"8080/tcp": [{"HostIp": "", "HostPort": "32768"}]}}}]
        mock_run.return_value = MagicMock(stdout=json.dumps(data).encode())
        backend = ContainerBackend("podman")
        assert backend.get_host_port("abc", 8080) == 32768

    @patch("subprocess.run")
    def test_get_host_port_missing_raises(self, mock_run):
        data = [{"NetworkSettings": {"Ports": {}}}]
        mock_run.return_value = MagicMock(stdout=json.dumps(data).encode())
        backend = ContainerBackend("podman")
        with pytest.raises(KeyError):
            backend.get_host_port("abc", 9999)


# --- list_containers ---


class TestListContainers:
    """Test container listing with label filters."""

    @patch("subprocess.run")
    def test_list_empty_output(self, mock_run):
        mock_run.return_value = MagicMock(stdout=b"")
        backend = ContainerBackend("podman")
        assert backend.list_containers() == []

    @patch("subprocess.run")
    def test_list_parses_json(self, mock_run):
        data = [{"Id": "abc", "Names": "test"}]
        mock_run.return_value = MagicMock(stdout=json.dumps(data).encode())
        backend = ContainerBackend("podman")
        result = backend.list_containers()
        assert len(result) == 1
        assert result[0]["Id"] == "abc"

    @patch("subprocess.run")
    def test_list_merges_default_labels(self, mock_run):
        mock_run.return_value = MagicMock(stdout=b"[]")
        backend = ContainerBackend("podman")
        backend.list_containers(labels={"custom": "val"})

        args = mock_run.call_args[0][0]
        filter_args = [a for a in args if a.startswith("label=")]
        assert any("app=claudebox" in f for f in filter_args)
        assert any("custom=val" in f for f in filter_args)
