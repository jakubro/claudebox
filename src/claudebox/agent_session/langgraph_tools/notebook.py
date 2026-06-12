"""Notebook tool - notebook_edit.

Uses nbformat. edit_mode in {replace, insert, delete}. cell_id=None requires
edit_mode="insert" (append at end).
"""

from pathlib import Path

import nbformat
from langchain_core.tools import BaseTool, tool

from ._context import ToolContext


def make_notebook_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind notebook_edit tool."""

    @tool
    def notebook_edit(
        path: str,
        new_source: str,
        cell_id: str | None = None,
        edit_mode: str = "replace",
    ) -> str:
        """Edit a Jupyter notebook cell.

        `edit_mode`: "replace" (default - replace cell `cell_id`'s source),
        "insert" (insert a new code cell after `cell_id`, or append at end if
        `cell_id` is None), or "delete" (remove cell `cell_id`). Returns a
        short status string.
        """

        if edit_mode not in {"replace", "insert", "delete"}:
            raise ValueError(
                f"notebook_edit: edit_mode must be 'replace', 'insert', or 'delete'; got {edit_mode!r}"
            )

        if cell_id is None and edit_mode != "insert":
            raise ValueError("notebook_edit: cell_id is required for edit_mode != 'insert'")

        resolved = Path(path).resolve()
        nb = nbformat.read(resolved, as_version=4)

        if edit_mode == "insert":
            new_cell = nbformat.v4.new_code_cell(source=new_source)

            if cell_id is None:
                nb.cells.append(new_cell)
                position = "end of notebook"
            else:
                index = _find_cell_index(nb.cells, cell_id)
                nb.cells.insert(index + 1, new_cell)
                position = f"after cell {cell_id!r}"

            nbformat.write(nb, resolved)

            return f"Inserted code cell at {position} in {resolved}"

        # Earlier guard ensures cell_id is non-None for replace / delete paths;
        # narrow explicitly so ty's union-tracking is satisfied.
        assert cell_id is not None
        index = _find_cell_index(nb.cells, cell_id)

        if edit_mode == "delete":
            nb.cells.pop(index)
            nbformat.write(nb, resolved)

            return f"Deleted cell {cell_id!r} from {resolved}"

        nb.cells[index].source = new_source
        nbformat.write(nb, resolved)

        return f"Replaced source of cell {cell_id!r} in {resolved}"

    return [notebook_edit]


def _find_cell_index(cells: list, cell_id: str) -> int:
    """Return the index of the cell whose id matches `cell_id`."""

    for index, cell in enumerate(cells):
        if cell.get("id") == cell_id:
            return index

    raise ValueError(f"notebook_edit: cell id {cell_id!r} not found")
