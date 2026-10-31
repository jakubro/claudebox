"""End-to-end behavioral tests for ``claudebox run``.

Real-binary surface: no ``.workspace`` marker is written, and the agent config is parseable JSON.
"""

from __future__ import annotations

import json
import socket

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:run:workspace-fallback
# SPEC: cli:run:no-auto-register
class TestRunWorkspaceFallback:
    """``claudebox run`` in an unregistered cwd falls back silently - no marker file."""

    def test_run_in_unregistered_cwd_falls_back(self, tmp_path, run_claudebox) -> None:
        # No .workspace marker exists or gets created; the backend is fake podman, so launch
        # outcome is irrelevant - the only contract under test is the marker file's absence.
        result = run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)
        assert not (tmp_path / ".workspace").exists()
        assert result.returncode is not None


# SPEC: cli:run:args-passthrough
class TestRunArgsPassthrough:
    """Everything after ``--`` reaches the agent unchanged and in order."""

    def test_args_after_double_dash_follow_the_image(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        (tmp_path / ".workspace").touch()

        run_claudebox(["run", "--", "-p", "two words", "--verbose"], cwd=tmp_path, timeout=60)

        (run,) = [
            line
            for line in (record_dir / "podman.log").read_text().splitlines()
            if line.startswith("run ")
        ]
        assert run.endswith(" claudebox -p two words --verbose")


# SPEC: cli:run:fresh-workspace
class TestRunFreshWorkspace:
    """The first run in a workspace mounts an agent config file the agent can parse."""

    @pytest.mark.parametrize("left_empty_by_an_earlier_run", [False, True])
    def test_agent_config_is_an_empty_object(
        self,
        tmp_path,
        run_claudebox,
        left_empty_by_an_earlier_run,
    ) -> None:
        (tmp_path / ".workspace").touch()
        agent_config = tmp_path / ".claudebox" / "fs" / "root" / ".claude.json"

        if left_empty_by_an_earlier_run:
            agent_config.parent.mkdir(parents=True)
            agent_config.touch()

        run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)

        assert json.loads(agent_config.read_text()) == {}


# SPEC: cli:run:port-in-use
class TestRunPortInUse:
    """A fixed host port the settings publish that is already held is published on a free one."""

    def test_a_held_port_is_published_on_a_free_one_and_named(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            held = listener.getsockname()[1]
            (tmp_path / ".workspace").touch()
            (tmp_path / ".claudebox").mkdir()
            (tmp_path / ".claudebox" / "settings.toml").write_text(f"[ports]\n{held} = 80\n")

            result = run_claudebox(["run", "--", "-p", "x"], cwd=tmp_path, timeout=60)

        assert f"host port {held} is in use" in result.stderr
        (run,) = [
            line
            for line in (record_dir / "podman.log").read_text().splitlines()
            if line.startswith("run ")
        ]
        published = run.split("--publish ")[1].split(" ")[0]
        assert published.endswith(":80")
        assert published != f"{held}:80"
