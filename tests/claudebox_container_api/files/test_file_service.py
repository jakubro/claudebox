"""Tests for claudebox_container_api.files.file_service - orchestrator facade."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from claudebox.workspace import Workspace
from claudebox_container_api.files.file_service import FileService


class TestFileServiceResolvePaths:
    """Test path resolution via the facade."""

    @pytest.mark.anyio
    async def test_resolves_workspace_file(self, tmp_workspace):
        (tmp_workspace / "app.py").write_text("")
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        result = await svc.resolve_paths(["app.py"], temp_dir=None)

        assert result == {"app.py": str(tmp_workspace / "app.py")}

    @pytest.mark.anyio
    async def test_resolves_tmp_path(self, tmp_workspace):
        temp_dir = tmp_workspace / "session_tmp"
        temp_dir.mkdir()
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        result = await svc.resolve_paths(["/tmp/log.txt"], temp_dir=temp_dir)

        assert result == {"/tmp/log.txt": str(temp_dir / "log.txt")}

    @pytest.mark.anyio
    async def test_returns_empty_for_unresolvable(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        result = await svc.resolve_paths(["nonexistent.py"], temp_dir=None)

        assert result == {}


class TestFileServiceExecutorIsolation:
    """Test that resolution runs on the service's own pool, never the shared default."""

    @pytest.mark.anyio
    async def test_resolution_runs_on_the_services_own_executor(self, tmp_workspace, monkeypatch):
        (tmp_workspace / "app.py").write_text("")
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)
        seen: list[str] = []
        original = svc._resolver.resolve

        def _record(candidates, temp_dir):
            seen.append(threading.current_thread().name)

            return original(candidates, temp_dir)

        monkeypatch.setattr(svc._resolver, "resolve", _record)

        try:
            await svc.resolve_paths(["app.py"], temp_dir=None)
        finally:
            svc.close()

        assert len(seen) == 1
        assert seen[0].startswith("path-resolve")

    @pytest.mark.anyio
    async def test_default_executor_is_never_touched(self, tmp_workspace):
        (tmp_workspace / "app.py").write_text("")
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        try:
            await svc.resolve_paths(["app.py"], temp_dir=None)
        finally:
            svc.close()

        # Default executor is created lazily; untouched None proves nothing ran on it.
        # Direct attribute access (not getattr) makes a CPython rename fail loudly.
        assert asyncio.get_running_loop()._default_executor is None  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_single_worker_so_walks_cannot_pile_up(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        try:
            assert isinstance(svc._executor, ThreadPoolExecutor)
            assert svc._executor._max_workers == 1
        finally:
            svc.close()

    @pytest.mark.anyio
    async def test_close_releases_the_executor(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        svc = FileService(ws)

        await svc.resolve_paths(["anything.py"], temp_dir=None)
        svc.close()

        with pytest.raises(RuntimeError):
            svc._executor.submit(lambda: None)
