"""notebook.py @tool tests - notebook_edit."""

import nbformat
import pytest

from claudebox.agent_session.langgraph_tools.notebook import make_notebook_tools


def _notebook_edit(tool_ctx):
    return make_notebook_tools(tool_ctx)[0]


def _fixture_notebook(path, cell_ids: list[str]):
    nb = nbformat.v4.new_notebook()

    for cell_id in cell_ids:
        cell = nbformat.v4.new_code_cell(source=f"# {cell_id}")
        cell["id"] = cell_id
        nb.cells.append(cell)

    nbformat.write(nb, path)


class TestNotebookEdit:
    def test_replace_overwrites_cell_source(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1", "c2"])
        notebook_edit = _notebook_edit(tool_ctx)

        notebook_edit.invoke(
            {"path": str(path), "new_source": "x = 42", "cell_id": "c1", "edit_mode": "replace"}
        )

        nb = nbformat.read(path, as_version=4)
        assert nb.cells[0].source == "x = 42"
        assert nb.cells[1].source == "# c2"

    def test_insert_appends_when_cell_id_none(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1"])
        notebook_edit = _notebook_edit(tool_ctx)

        notebook_edit.invoke({"path": str(path), "new_source": "y = 1", "edit_mode": "insert"})

        nb = nbformat.read(path, as_version=4)
        assert len(nb.cells) == 2
        assert nb.cells[1].source == "y = 1"

    def test_insert_after_specific_cell(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1", "c3"])
        notebook_edit = _notebook_edit(tool_ctx)

        notebook_edit.invoke(
            {"path": str(path), "new_source": "z = 0", "cell_id": "c1", "edit_mode": "insert"}
        )

        nb = nbformat.read(path, as_version=4)
        assert [c.source for c in nb.cells] == ["# c1", "z = 0", "# c3"]

    def test_delete_removes_cell(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1", "c2"])
        notebook_edit = _notebook_edit(tool_ctx)

        notebook_edit.invoke(
            {"path": str(path), "new_source": "", "cell_id": "c1", "edit_mode": "delete"}
        )

        nb = nbformat.read(path, as_version=4)
        assert len(nb.cells) == 1
        assert nb.cells[0].id == "c2"

    def test_replace_without_cell_id_raises(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1"])
        notebook_edit = _notebook_edit(tool_ctx)

        with pytest.raises(ValueError, match="cell_id is required"):
            notebook_edit.invoke({"path": str(path), "new_source": "x", "edit_mode": "replace"})

    def test_unknown_edit_mode_raises(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1"])
        notebook_edit = _notebook_edit(tool_ctx)

        with pytest.raises(ValueError, match="edit_mode"):
            notebook_edit.invoke(
                {"path": str(path), "new_source": "x", "cell_id": "c1", "edit_mode": "bogus"}
            )

    def test_unknown_cell_id_raises(self, tool_ctx, tmp_path):
        path = tmp_path / "nb.ipynb"
        _fixture_notebook(path, ["c1"])
        notebook_edit = _notebook_edit(tool_ctx)

        with pytest.raises(ValueError, match="not found"):
            notebook_edit.invoke(
                {"path": str(path), "new_source": "x", "cell_id": "missing", "edit_mode": "replace"}
            )
