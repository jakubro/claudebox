"""Tests for claudebox.containers.local - LocalRuntime subprocess spawn."""

from __future__ import annotations

import threading
from unittest.mock import MagicMock, patch

from claudebox.containers.local import LocalRuntime, _Process


class TestRunContainerHostBinding:
    """The spawned container_api_server.py is told to bind loopback, not all interfaces."""

    @patch("claudebox.containers.local.LocalRuntime._find_free_port", return_value=9000)
    @patch("subprocess.Popen")
    def test_spawns_with_loopback_host_flag(self, mock_popen, _mock_port):
        mock_popen.return_value = MagicMock(pid=1234)
        runtime = LocalRuntime()

        runtime.run_container(name="test", labels={}, env={})

        argv = mock_popen.call_args.args[0]
        assert "--host" in argv
        assert argv[argv.index("--host") + 1] == "127.0.0.1"


class TestFindFreePort:
    """The free-port probe binds loopback, not all interfaces."""

    @patch("socket.socket")
    def test_binds_to_loopback(self, mock_socket_cls):
        mock_socket = MagicMock()
        mock_socket.getsockname.return_value = ("127.0.0.1", 54321)
        mock_socket_cls.return_value.__enter__.return_value = mock_socket

        port = LocalRuntime._find_free_port()

        mock_socket.bind.assert_called_once_with(("127.0.0.1", 0))
        assert port == 54321


class TestIdentifyContainerFromPid:
    """Test peer-pid-to-container resolution via process group membership - a local 'container'
    has no cgroup boundary, so the podman mechanism doesn't apply here."""

    @patch("os.getpgid")
    def test_matches_the_candidate_whose_pid_is_the_process_group_leader(self, mock_getpgid):
        runtime = LocalRuntime()
        runtime._registry["abc"] = _Process(process=MagicMock(pid=500), port=1)
        runtime._registry["xyz"] = _Process(process=MagicMock(pid=600), port=1)
        mock_getpgid.return_value = 500

        result = runtime.identify_container_from_pid(9999, ["xyz", "abc"])

        assert result == "abc"
        mock_getpgid.assert_called_once_with(9999)

    @patch("os.getpgid")
    def test_returns_none_when_no_candidate_matches(self, mock_getpgid):
        runtime = LocalRuntime()
        runtime._registry["abc"] = _Process(process=MagicMock(pid=500), port=1)
        mock_getpgid.return_value = 999

        assert runtime.identify_container_from_pid(9999, ["abc"]) is None

    @patch("os.getpgid", side_effect=ProcessLookupError)
    def test_returns_none_when_the_pid_is_already_gone(self, _mock_getpgid):
        runtime = LocalRuntime()

        assert runtime.identify_container_from_pid(9999, []) is None


class _BlockingProcess:
    """A process whose poll reports the listing started, then waits for another thread's change."""

    def __init__(self, started: threading.Event, changed: threading.Event):
        self._started = started
        self._changed = changed
        self.pid = 4242

    def poll(self):
        self._started.set()
        self._changed.wait(timeout=5)


class _ExitedProcess:
    pid = 4343

    def poll(self):
        return 0


def _tracked(process, name: str) -> _Process:
    return _Process(process=process, port=0, name=name)


class TestListingUnderConcurrentChanges:
    """A listing on one pool thread survives a spawn or removal on another."""

    @staticmethod
    def _runtime_with(entries: dict) -> LocalRuntime:
        runtime = LocalRuntime()
        runtime._registry.update(entries)

        return runtime

    @patch("claudebox.containers.local.LocalRuntime._find_free_port", return_value=9000)
    @patch("subprocess.Popen")
    def test_a_spawn_during_a_listing(self, _mock_popen, _mock_port):
        started, changed = threading.Event(), threading.Event()
        runtime = self._runtime_with(
            {"a": _tracked(_BlockingProcess(started, changed), "a")},
        )

        def spawn():
            started.wait(timeout=5)
            runtime.run_container(name="b", labels={}, env={}, detach=True)
            changed.set()

        thread = threading.Thread(target=spawn)
        thread.start()
        listed = runtime.list_containers()
        thread.join()

        assert [entry["Id"] for entry in listed] == ["a"]

    def test_a_removal_during_a_listing(self):
        started, changed = threading.Event(), threading.Event()
        runtime = self._runtime_with(
            {
                "a": _tracked(_BlockingProcess(started, changed), "a"),
                "b": _tracked(_ExitedProcess(), "b"),
            },
        )

        def remove():
            started.wait(timeout=5)
            runtime.remove_container("b")
            changed.set()

        thread = threading.Thread(target=remove)
        thread.start()
        listed = runtime.list_containers()
        thread.join()

        assert [entry["Id"] for entry in listed] == ["a"]
