"""End-to-end behavioral tests for ``claudebox logs``.

Real-binary surfaces: missing-file path, seeded-backfill rendering, FORCE_COLOR colorization,
``logs all`` daemon-unreachable error, and container multiplexing over the daemon's proxy.
"""

import json
import os
import signal
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
from werkzeug.wrappers import Response


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


_DEAD_DAEMON_URL = "http://127.0.0.1:1"

_WS = "ws-test"
_CID = "c85277a585ef4c1d9f0a1b2c3d4e5f60"
_LATE = "4d9cb2350a1b4c2d8e3f5a6b7c8d9e0f"
_CONTAINER_STATUS = "container_status"


def _seed_log(home: Path, records: list[dict]) -> None:
    """Write a daemon-port log file under the hermetic home."""

    log_dir = home / ".claudebox" / "logs"
    log_dir.mkdir(parents=True)
    log_file = log_dir / "daemon-41820.log"
    log_file.write_text("\n".join(json.dumps(r) for r in records) + "\n")


@pytest.fixture
def follow_claudebox(
    claudebox_bin: Path,
    hermetic_home: Path,
    fake_bins_dir: Path,
    record_dir: Path,
    fake_daemon: str,
) -> Callable[..., str]:
    """Run the CLI in follow mode, let it settle, interrupt it, and return its output.

    Follow mode never exits on its own, so ``run_claudebox``'s timeout would discard the output.
    """

    def _run(args: list[str], *, settle: float, env: dict[str, str] | None = None) -> str:
        merged_env = {
            **os.environ,
            "CLAUDEBOX_TEST_HOME": str(hermetic_home),
            "CLAUDEBOX_TEST_PATH_PREFIX": str(fake_bins_dir),
            "CLAUDEBOX_TEST_RECORD_DIR": str(record_dir),
            "CLAUDEBOX_DAEMON_URL": fake_daemon,
            **(env or {}),
        }

        proc = subprocess.Popen(
            [str(claudebox_bin), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=merged_env,
            start_new_session=True,
        )

        def _signal_group(sig: int) -> None:
            """Signal the whole group, the way a terminal delivers Ctrl-C.

            The wrapper execs ``uv``, which runs the interpreter as a child; signalling only
            the direct child orphans it holding the pipes open, so ``communicate`` hangs.
            """

            try:
                os.killpg(os.getpgid(proc.pid), sig)
            except ProcessLookupError:
                return

        try:
            proc.wait(timeout=settle)
        except subprocess.TimeoutExpired:
            _signal_group(signal.SIGINT)

        try:
            out, err = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            _signal_group(signal.SIGKILL)
            out, err = proc.communicate()

        return out + err

    return _run


def _wide_record() -> dict:
    """Build one record whose rendered width comfortably exceeds any plausible console."""

    return {
        "timestamp": 1747222800.0,
        "level": "warning",
        "logger": "claudebox_daemon.domain.containers.proxy",
        "event": "Container connection failed",
        "container": {
            "id": "be9e0432-1b8b-4382-98ce-f566cbbb4edf",
            "port": 45371,
            "status": "stopped",
        },
        "error": {"type": "ConnectError", "message": "All connection attempts failed"},
        "url": "http://localhost:45371/api/files/resolve-paths",
        "padding": "x" * 400,
    }


def _seed_registry(home: Path, workspace_ids: list[str]) -> None:
    """Write ``~/.claudebox/daemon.json`` - the CLI enumerates workspaces from it, not the daemon."""

    config_dir = home / ".claudebox"
    config_dir.mkdir(parents=True, exist_ok=True)
    payload = {"workspaces": [{"id": ws_id} for ws_id in workspace_ids]}
    (config_dir / "daemon.json").write_text(json.dumps(payload))


def _container_sse(*records: dict) -> str:
    """Render a container log stream the way the broadcaster does.

    History sits between the boundary frames, with a keep-alive interleaved - both are wire
    noise the CLI must not print.
    """

    frames = [{"type": "system", "subtype": "replay_started", "count": len(records)}]
    frames.extend(records)

    body = [f"data: {json.dumps(frame)}" for frame in frames]
    body.append(": ping - keep-alive")
    body.append('data: {"type": "system", "subtype": "replay_ended", "count": 0}')

    return "\n\n".join(body) + "\n\n"


# SPEC: cli:logs
class TestLogsMissingFile:
    """Absent daemon log - clear notice + exit 0."""

    def test_missing_log_file_exits_zero(self, run_claudebox, hermetic_home) -> None:
        result = run_claudebox(["logs", "--no-follow"], timeout=15)
        assert result.returncode == 0
        combined = result.stdout + result.stderr
        assert "no daemon logs available" in combined


# SPEC: cli:logs
class TestLogsNoFollowBackfill:
    """``--no-follow`` reads existing log content and exits."""

    def test_seeded_log_backfilled(self, run_claudebox, hermetic_home) -> None:
        _seed_log(
            hermetic_home,
            [
                {"timestamp": 1747222800.0, "level": "info", "logger": "x", "event": "first"},
                {"timestamp": 1747222801.0, "level": "warning", "logger": "x", "event": "middle"},
                {"timestamp": 1747222802.0, "level": "error", "logger": "x", "event": "last"},
            ],
        )
        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=15,
        )
        assert result.returncode == 0
        combined = result.stdout + result.stderr

        for token in ("first", "middle", "last"):
            assert token in combined


# SPEC: cli:logs-colorization
# SPEC: cli:logs:rendering
class TestLogsColorization:
    """warning/error rows emit ANSI escapes under FORCE_COLOR=1."""

    def test_warn_error_emit_color_tokens(self, run_claudebox, hermetic_home) -> None:
        _seed_log(
            hermetic_home,
            [
                {"timestamp": 1747222800.0, "level": "error", "logger": "x", "event": "boom"},
                {"timestamp": 1747222801.0, "level": "warning", "logger": "x", "event": "soft"},
                {"timestamp": 1747222802.0, "level": "info", "logger": "x", "event": "ok"},
            ],
        )
        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"FORCE_COLOR": "1"},
            timeout=15,
        )
        combined = result.stdout + result.stderr
        assert "\x1b[" in combined
        assert "2025" in combined
        assert "1747222800" not in combined


# SPEC: cli:logs-all
# SPEC: cli:logs:multiplex
# SPEC: cli:logs:eof-cause
class TestLogsAll:
    """``logs all`` against an unreachable daemon: clean error + non-zero exit."""

    def test_all_daemon_unreachable_exits_non_zero(self, run_claudebox) -> None:
        result = run_claudebox(
            ["logs", "all", "--no-follow"],
            env={"CLAUDEBOX_DAEMON_URL": _DEAD_DAEMON_URL},
            timeout=15,
        )
        assert result.returncode != 0
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr


# SPEC: cli:logs:rendering
class TestLogsSingleLineRendering:
    """One record occupies exactly one output line, wider than the console or not.

    Captured through a pipe, which is the strict case: the console's fixed fallback width
    applies there, and a wrap would be least visible by eye.
    """

    def test_wide_record_is_single_line(self, run_claudebox, hermetic_home) -> None:
        _seed_log(hermetic_home, [_wide_record()])

        result = run_claudebox(
            ["logs", "--tail", "1", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=15,
        )

        assert result.returncode == 0

        body = [line for line in (result.stdout + result.stderr).splitlines() if line.strip()]

        assert len(body) == 1, f"record split across {len(body)} lines:\n" + "\n".join(body)

        # Nothing fell off the right edge.
        for token in ("Container connection failed", "ConnectError", "resolve-paths"):
            assert token in body[0]

    def test_prefixed_wide_record_is_single_line(
        self,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """``logs all`` keeps the source prefix and still emits one line per record."""

        _seed_log(hermetic_home, [_wide_record()])
        httpserver.expect_request("/api/workspaces").respond_with_json({"workspaces": []})

        result = run_claudebox(
            ["logs", "all", "--tail", "1", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=30,
        )

        assert result.returncode == 0

        body = [line for line in (result.stdout + result.stderr).splitlines() if line.strip()]

        assert len(body) == 1, f"record split across {len(body)} lines:\n" + "\n".join(body)
        assert body[0].startswith("[daemon]")
        assert "resolve-paths" in body[0]


# SPEC: cli:logs-all
# SPEC: cli:logs:multiplex
class TestLogsAllContainerOutput:
    """``logs all`` reaches the container's own ``/api``-prefixed log endpoint and renders it."""

    def test_container_output_reaches_stdout(
        self,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        _seed_log(
            hermetic_home,
            [{"timestamp": 1747222799.0, "level": "info", "logger": "d", "event": "daemon-line"}],
        )
        _seed_registry(hermetic_home, [_WS])
        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_json(
            {"containers": [{"id": _CID, "status": "running"}]},
        )
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222800.0,
                    "level": "INFO",
                    "logger": "container.api",
                    "message": "hello-from-container",
                },
            ),
            content_type="text/event-stream",
        )

        # The container log endpoint is an endless SSE stream; a hang here means --no-follow
        # failed to stop at the replay boundary.
        result = run_claudebox(
            ["logs", "all", "--tail", "10", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=30,
        )

        combined = result.stdout + result.stderr

        assert result.returncode == 0
        assert "hello-from-container" in combined, "container output never reached stdout"
        # Every line carries its source prefix - both halves of the multiplex.
        assert f"[container {_CID[:12]}]" in combined
        assert "[daemon]" in combined
        assert "daemon-line" in combined
        assert "HTTP 404" not in combined
        # SSE framing and keep-alives are wire noise, never output.
        assert "data:" not in combined
        assert "ping" not in combined
        assert "replay_ended" not in combined
        assert "Traceback" not in result.stderr

    def test_backfill_is_bounded_by_tail(self, run_claudebox, hermetic_home, httpserver) -> None:
        """``--tail N`` keeps at most the last N replayed lines per container."""

        _seed_registry(hermetic_home, [_WS])
        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_json(
            {"containers": [{"id": _CID, "status": "running"}]},
        )
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data(
            _container_sse(
                *(
                    {
                        "timestamp": 1747222800.0 + i,
                        "level": "INFO",
                        "logger": "container.api",
                        "message": f"record-{i}",
                    }
                    for i in range(5)
                ),
            ),
            content_type="text/event-stream",
        )

        result = run_claudebox(
            ["logs", "all", "--tail", "2", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=30,
        )

        combined = result.stdout + result.stderr

        assert result.returncode == 0
        assert "record-3" in combined
        assert "record-4" in combined

        for dropped in ("record-0", "record-1", "record-2"):
            assert dropped not in combined, f"{dropped} survived a --tail 2 backfill"

    def test_container_that_cannot_serve_logs_is_skipped_silently(
        self,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """A stopped container yields neither output nor an error line."""

        _seed_registry(hermetic_home, [_WS])
        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_json(
            {"containers": [{"id": _CID, "status": "stopped"}]},
        )

        result = run_claudebox(["logs", "all", "--no-follow"], env={"NO_COLOR": "1"}, timeout=30)

        combined = result.stdout + result.stderr

        assert result.returncode == 0
        assert _CID[:12] not in combined
        assert "stream ended" not in combined
        assert "Traceback" not in result.stderr


# SPEC: cli:logs:eof-cause
class TestLogsAllPartialFailure:
    """A container that fails mid-request is named once, with its cause."""

    def test_failing_container_is_reported_exactly_once(
        self,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        _seed_registry(hermetic_home, [_WS])
        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_json(
            {"containers": [{"id": _CID, "status": "running"}]},
        )
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data("upstream exploded", status=503)

        result = run_claudebox(["logs", "all", "--no-follow"], env={"NO_COLOR": "1"}, timeout=30)

        combined = result.stdout + result.stderr
        naming = [line for line in combined.splitlines() if _CID[:12] in line]

        assert len(naming) == 1, f"container reported {len(naming)} times: {naming}"
        assert "503" in naming[0]
        # The body names the reason; it has to be buffered before the stream context closes.
        assert "upstream exploded" in naming[0]
        assert "Traceback" not in result.stderr

    def test_one_failing_container_does_not_abort_the_others(
        self,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        healthy = "aa11bb22cc33dd44ee55ff6677889900"

        _seed_registry(hermetic_home, [_WS])
        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_json(
            {
                "containers": [
                    {"id": _CID, "status": "running"},
                    {"id": healthy, "status": "running"},
                ],
            },
        )
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data("upstream exploded", status=503)
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{healthy}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222800.0,
                    "level": "INFO",
                    "logger": "container.api",
                    "message": "survivor-speaking",
                },
            ),
            content_type="text/event-stream",
        )

        result = run_claudebox(["logs", "all", "--no-follow"], env={"NO_COLOR": "1"}, timeout=30)

        combined = result.stdout + result.stderr

        assert result.returncode == 0
        assert "survivor-speaking" in combined, "a failing container aborted a healthy one"
        assert f"[container {healthy[:12]}]" in combined
        assert len([line for line in combined.splitlines() if _CID[:12] in line]) == 1


class TestLogsAllLiveDiscovery:
    """``logs all`` keeps watching: containers that appear later are picked up."""

    @staticmethod
    def _serve_feed(httpserver) -> None:
        """Serve one container lifecycle frame, then close - as a daemon restart would."""

        event = {
            "type": _CONTAINER_STATUS,
            "container_id": _LATE,
            "workspace_id": _WS,
            "status": "starting",
        }
        httpserver.expect_request("/api/daemon/stream").respond_with_data(
            f"data: {json.dumps(event)}\n\n",
            content_type="text/event-stream",
        )

    @staticmethod
    def _serve_container_list(httpserver, snapshots: list[list[dict]]) -> None:
        """Answer successive container-list calls from ``snapshots``, repeating the last."""

        calls = {"n": 0}

        def _handler(_request) -> Response:
            index = min(calls["n"], len(snapshots) - 1)
            calls["n"] += 1

            return Response(
                json.dumps({"containers": snapshots[index]}),
                content_type="application/json",
            )

        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_handler(
            _handler,
        )

    # SPEC: cli:logs-live-discovery
    def test_container_started_after_launch_is_followed(
        self,
        follow_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """A container absent at launch streams once it appears, without a restart.

        The feed closes after its single frame, proving the command also survives feed loss
        and resynchronises.
        """

        _seed_registry(hermetic_home, [_WS])
        self._serve_feed(httpserver)
        self._serve_container_list(httpserver, [[], [{"id": _LATE, "status": "running"}]])
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_LATE}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222900.0,
                    "level": "INFO",
                    "logger": "container",
                    "message": "late-container-speaking",
                },
            ),
            content_type="text/event-stream",
        )

        combined = follow_claudebox(["logs", "all", "--tail", "5"], settle=8, env={"NO_COLOR": "1"})

        assert "late-container-speaking" in combined, "late container was never followed"
        assert f"container {_LATE[:12]} started streaming" in combined
        assert f"[container {_LATE[:12]}]" in combined

    # SPEC: cli:logs-live-discovery
    def test_stopped_container_is_reaped_with_one_notice(
        self,
        follow_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """A followed container that disappears yields exactly one stop notice."""

        _seed_registry(hermetic_home, [_WS])
        self._serve_feed(httpserver)
        self._serve_container_list(httpserver, [[{"id": _CID, "status": "running"}], []])
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222800.0,
                    "level": "INFO",
                    "logger": "container",
                    "message": "doomed-container",
                },
            ),
            content_type="text/event-stream",
        )

        combined = follow_claudebox(["logs", "all", "--tail", "5"], settle=8, env={"NO_COLOR": "1"})

        notices = [
            line for line in combined.splitlines() if f"container {_CID[:12]} stopped" in line
        ]

        assert len(notices) == 1, f"expected one stop notice, got {notices}"

    def test_container_announced_repeatedly_is_followed_once(
        self,
        follow_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """Repeated announcements never open a second stream for the same container."""

        _seed_registry(hermetic_home, [_WS])
        self._serve_feed(httpserver)
        self._serve_container_list(httpserver, [[{"id": _CID, "status": "running"}]])
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_CID}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222800.0,
                    "level": "INFO",
                    "logger": "container",
                    "message": "only-once-please",
                },
            ),
            content_type="text/event-stream",
        )

        combined = follow_claudebox(["logs", "all", "--tail", "5"], settle=8, env={"NO_COLOR": "1"})

        # A second follower would reconnect and replay the same history again.
        assert combined.count("only-once-please") == 1, "container was followed more than once"

    def test_broken_stream_is_reattached_without_replaying_history(
        self,
        follow_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """A stream that ends while its container is still listed is re-opened.

        A daemon restart breaks every proxied stream at once; re-attaching must not replay
        the history again.
        """

        _seed_registry(hermetic_home, [_WS])
        self._serve_container_list(httpserver, [[{"id": _CID, "status": "running"}]])
        log_path = f"/api/workspaces/{_WS}/containers/{_CID}/api/logs"
        httpserver.expect_request(log_path).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222800.0,
                    "level": "INFO",
                    "logger": "container",
                    "message": "history-line",
                },
            ),
            content_type="text/event-stream",
        )

        combined = follow_claudebox(
            ["logs", "all", "--tail", "5"],
            settle=14,
            env={"NO_COLOR": "1"},
        )

        attempts = sum(1 for entry in httpserver.log if entry[0].path == log_path)

        assert attempts >= 2, f"stream was never re-opened after it ended (attempts={attempts})"
        assert combined.count("history-line") == 1, "history was replayed on re-attach"

    def test_unparseable_container_list_does_not_kill_discovery(
        self,
        follow_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        """A non-JSON 200 must not leave the command alive but permanently blind."""

        _seed_registry(hermetic_home, [_WS])
        calls = {"n": 0}

        def _list(_request) -> Response:
            calls["n"] += 1

            # Call 1 (startup fetch) must succeed or the command exits before reconcile runs;
            # call 2 is the hiccup the reconcile loop has to survive.
            if calls["n"] == 1:
                return Response(json.dumps({"containers": []}), content_type="application/json")
            elif calls["n"] == 2:
                return Response("<html>proxy error</html>", content_type="text/html")

            return Response(
                json.dumps({"containers": [{"id": _LATE, "status": "running"}]}),
                content_type="application/json",
            )

        httpserver.expect_request(f"/api/workspaces/{_WS}/containers").respond_with_handler(_list)
        httpserver.expect_request(
            f"/api/workspaces/{_WS}/containers/{_LATE}/api/logs",
        ).respond_with_data(
            _container_sse(
                {
                    "timestamp": 1747222900.0,
                    "level": "INFO",
                    "logger": "container",
                    "message": "survived-bad-list",
                },
            ),
            content_type="text/event-stream",
        )

        combined = follow_claudebox(
            ["logs", "all", "--tail", "5"],
            settle=12,
            env={"NO_COLOR": "1"},
        )

        assert "survived-bad-list" in combined, "discovery died on an unparseable list response"
        assert "Traceback" not in combined
