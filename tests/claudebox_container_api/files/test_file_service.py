"""Tests for claudebox_container_api.files.file_service - orchestrator facade."""

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
