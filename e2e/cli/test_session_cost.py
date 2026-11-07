"""A session's cost end to end: real session, pipeline, projection and Claude runtime, a scripted
agent CLI reporting running totals, a restart and the daemon's real fork."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.workspace import Workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService as DaemonSessions
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from .scripted_cli import ScriptedCli


def _running_total_cli(turn_costs: list[float], *, carries_forward: bool) -> type[ScriptedCli]:
    costs = list(turn_costs)

    class RunningTotalCli(ScriptedCli):
        def __init__(self, options):
            super().__init__(options)
            self._total = self._restored() if carries_forward else 0.0

        async def disconnect(self) -> None:
            if carries_forward:
                with self.transcript.open("a") as f:
                    f.write(json.dumps({"type": "cost-state", "totalCostUSD": self._total}) + "\n")

        def result(self, text: str, *, is_error: bool = False):
            message = super().result(text, is_error=is_error)
            self._total += costs.pop(0)
            message.total_cost_usd = round(self._total, 6)

            return message

        def _restored(self) -> float:
            if not self.transcript.exists():
                return 0.0

            states = [
                json.loads(line)
                for line in self.transcript.read_text().splitlines()
                if '"cost-state"' in line
            ]

            return states[-1]["totalCostUSD"] if states else 0.0

    return RunningTotalCli


def _session_path(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path


def _results(workspace: Path, session_id: str) -> int:
    path = _session_path(workspace, session_id) / "events.jsonl"

    if not path.exists():
        return 0

    return sum(json.loads(line)["type"] == "result" for line in path.read_text().splitlines())


async def _send_and_wait(session, workspace, session_id, prompt) -> None:
    done = _results(workspace, session_id)
    await session.send(prompt)

    async with asyncio.timeout(10):
        while _results(workspace, session_id) <= done:
            await asyncio.sleep(0.05)


def _daemon(workspace: Path) -> DaemonSessions:
    containers = MagicMock()
    containers.create = AsyncMock(return_value=MagicMock(id="c-fork"))
    containers.list_all = MagicMock(return_value=[])
    service = DaemonSessions(
        RegisteredWorkspace(id="ws", path=workspace),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )
    service._wait_for_health = AsyncMock()
    service._start_session_in = AsyncMock()

    return service


def _record(workspace: Path, session_id: str) -> dict:
    return json.loads((_session_path(workspace, session_id) / "session.json").read_text())


# SPEC: panel-session:cost-counted-once
@pytest.mark.anyio
@pytest.mark.parametrize("carries_forward", [False, True], ids=["from-zero", "carried-forward"])
async def test_a_session_and_its_fork_count_each_turn_once(workspace, carries_forward):
    cli = _running_total_cli([0.40, 0.60, 0.30, 0.20], carries_forward=carries_forward)

    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", cli):
        parent = ContainerSession(workspace=workspace, remaps_tmp=False)
        parent_id = await parent.start()

        try:
            await _send_and_wait(parent, workspace, parent_id, "first")
            await _send_and_wait(parent, workspace, parent_id, "second")
            await parent.restart(parent_id)
            await _send_and_wait(parent, workspace, parent_id, "after the restart")
        finally:
            await parent.stop()

        fork = await _daemon(workspace).fork(parent_id)
        child = ContainerSession(workspace=workspace, remaps_tmp=False)
        await child.start(fork.session_id)

        try:
            await _send_and_wait(child, workspace, fork.session_id, "in the fork")
        finally:
            await child.stop()

    parent_record = _record(workspace, parent_id)
    child_record = _record(workspace, fork.session_id)
    usage = sum(
        r["total_cost_usd"] - r["fork_point_cost_usd"] for r in (parent_record, child_record)
    )

    assert parent_record["total_cost_usd"] == pytest.approx(1.30)
    assert child_record["fork_point_cost_usd"] == pytest.approx(1.30)
    assert child_record["total_cost_usd"] == pytest.approx(1.50)
    assert usage == pytest.approx(1.50)
