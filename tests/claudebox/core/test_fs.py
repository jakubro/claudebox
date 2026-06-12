"""Tests for claudebox.fs - filesystem utilities."""

from pathlib import Path

from claudebox.core.fs import (
    find_files,
    make_temp_dir,
    remove_path,
    resolve_path,
    touch_dir,
    touch_file,
    walk_filtered,
    walk_up,
)


class TestWalkUp:
    """Test directory ancestry traversal."""

    def test_yields_start_dir(self, tmp_path):
        dirs = list(walk_up(tmp_path))
        assert dirs[0] == tmp_path.resolve()

    def test_yields_ancestors(self, tmp_path):
        nested = tmp_path / "a" / "b" / "c"
        nested.mkdir(parents=True)
        dirs = list(walk_up(nested))
        assert tmp_path.resolve() in dirs

    def test_ends_at_root(self, tmp_path):
        dirs = list(walk_up(tmp_path))
        assert dirs[-1] == Path("/")


class TestTouchDir:
    """Test directory creation."""

    def test_creates_nested(self, tmp_path):
        target = tmp_path / "a" / "b"
        result = touch_dir(target)
        assert target.is_dir()
        assert result == target

    def test_idempotent(self, tmp_path):
        target = tmp_path / "x"
        touch_dir(target)
        touch_dir(target)
        assert target.is_dir()


class TestTouchFile:
    """Test file creation with parent directories."""

    def test_creates_file_and_parents(self, tmp_path):
        target = tmp_path / "a" / "b" / "file.txt"
        result = touch_file(target)
        assert target.is_file()
        assert result == target

    def test_idempotent(self, tmp_path):
        target = tmp_path / "file.txt"
        touch_file(target)
        touch_file(target)
        assert target.is_file()


class TestResolvePath:
    """Test path resolution."""

    def test_resolves_absolute(self, tmp_path):
        result = resolve_path(tmp_path / "test")
        assert result.is_absolute()

    def test_accepts_string(self, tmp_path):
        result = resolve_path(str(tmp_path / "test"))
        assert isinstance(result, Path)
        assert result.is_absolute()


class TestRemovePath:
    """Test file and directory removal."""

    def test_removes_file(self, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("content")
        remove_path(f)
        assert not f.exists()

    def test_removes_directory(self, tmp_path):
        d = tmp_path / "dir"
        d.mkdir()
        (d / "child.txt").write_text("content")
        remove_path(d)
        assert not d.exists()

    def test_removes_symlink(self, tmp_path):
        target = tmp_path / "target"
        target.write_text("content")
        link = tmp_path / "link"
        link.symlink_to(target)
        remove_path(link)
        assert not link.exists()
        assert target.exists()  # target preserved


class TestMakeTempDir:
    """Test temporary directory creation with auto-cleanup."""

    def test_creates_and_cleans_up(self, tmp_path):
        with make_temp_dir() as temp:
            assert temp.is_dir()

        assert not temp.exists()

    def test_creates_parent_when_dir_specified(self, tmp_path):
        parent = tmp_path / "build" / "staging"

        with make_temp_dir(dir=parent) as temp:
            assert parent.is_dir()
            assert temp.is_dir()

    def test_temp_created_under_specified_dir(self, tmp_path):
        """Temp directory is created under the specified parent."""

        parent = tmp_path / "my-parent"

        with make_temp_dir(dir=parent) as temp:
            assert temp.parent == parent


# --- walk_filtered / find_files ---


def _setup_tree(tmp_path):
    """Create a sample directory tree for walk_filtered tests."""

    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("code")
    (tmp_path / "src" / "pyproject.toml").write_text("[project]")
    (tmp_path / "src" / ".venv").mkdir()
    (tmp_path / "src" / ".venv" / "pyproject.toml").write_text("venv")
    (tmp_path / "src" / "web").mkdir()
    (tmp_path / "src" / "web" / "package.json").write_text("{}")
    (tmp_path / "src" / "web" / "node_modules").mkdir()
    (tmp_path / "src" / "web" / "node_modules" / "package.json").write_text("{}")

    return tmp_path


class TestWalkFiltered:
    """Test gitignore-aware directory walking."""

    def test_respects_gitignore(self, tmp_path):
        _setup_tree(tmp_path)
        (tmp_path / ".gitignore").write_text(".venv/\nnode_modules/\n")

        paths = list(walk_filtered(tmp_path))
        names = {p.name for p in paths}

        assert "app.py" in names
        assert ".venv" not in names
        assert "node_modules" not in names

    def test_no_gitignore_yields_all(self, tmp_path):
        _setup_tree(tmp_path)

        paths = list(walk_filtered(tmp_path))
        names = {p.name for p in paths}

        assert ".venv" in names
        assert "node_modules" in names

    def test_nested_ignore_files(self, tmp_path):
        _setup_tree(tmp_path)
        (tmp_path / "src" / "web" / ".gitignore").write_text("node_modules/\n")

        paths = list(walk_filtered(tmp_path))
        names = {p.name for p in paths}

        # node_modules under src/web/ is pruned
        assert "node_modules" not in names
        # .venv not in any gitignore, still visible
        assert ".venv" in names

    def test_extra_patterns(self, tmp_path):
        _setup_tree(tmp_path)

        paths = list(walk_filtered(tmp_path, ignore_patterns=["*.py"]))
        names = {p.name for p in paths}

        assert "app.py" not in names
        assert "pyproject.toml" in names

    def test_custom_ignore_filenames(self, tmp_path):
        _setup_tree(tmp_path)
        (tmp_path / ".ignore").write_text(".venv/\n")

        paths = list(walk_filtered(tmp_path, ignore_filenames=[".ignore"]))
        names = {p.name for p in paths}

        assert ".venv" not in names

    def test_prunes_directories_not_descended(self, tmp_path):
        """Ignored directories are never descended into."""

        _setup_tree(tmp_path)
        (tmp_path / ".gitignore").write_text(".venv/\n")

        paths = list(walk_filtered(tmp_path))

        # No path should be under .venv
        for p in paths:
            assert ".venv" not in p.parts

    def test_nested_ignore_scoped_to_directory(self, tmp_path):
        """Nested ignore patterns only apply from their directory down."""

        (tmp_path / "a").mkdir()
        (tmp_path / "a" / "dist").mkdir()
        (tmp_path / "a" / "dist" / "file.txt").write_text("a")
        (tmp_path / "b").mkdir()
        (tmp_path / "b" / "dist").mkdir()
        (tmp_path / "b" / "dist" / "file.txt").write_text("b")
        (tmp_path / "a" / ".gitignore").write_text("dist/\n")

        paths = list(walk_filtered(tmp_path))
        rel_paths = {str(p.relative_to(tmp_path)) for p in paths}

        # a/dist should be pruned
        assert "a/dist" not in rel_paths
        # b/dist should remain
        assert "b/dist" in rel_paths


class TestFindFiles:
    """Test filename search within gitignore-aware walk."""

    def test_finds_matching_files(self, tmp_path):
        _setup_tree(tmp_path)
        (tmp_path / ".gitignore").write_text(".venv/\nnode_modules/\n")

        results = list(find_files(tmp_path, "pyproject.toml"))

        assert len(results) == 1
        assert results[0].name == "pyproject.toml"
        assert "src" in results[0].parts

    def test_finds_multiple_matches(self, tmp_path):
        _setup_tree(tmp_path)
        # No gitignore - finds both pyproject.toml files
        results = list(find_files(tmp_path, "pyproject.toml"))
        assert len(results) == 2

    def test_no_matches(self, tmp_path):
        _setup_tree(tmp_path)
        results = list(find_files(tmp_path, "nonexistent.txt"))
        assert results == []

    def test_forwards_kwargs(self, tmp_path):
        _setup_tree(tmp_path)

        results = list(find_files(tmp_path, "pyproject.toml", ignore_patterns=[".venv/"]))

        assert len(results) == 1
        assert ".venv" not in results[0].parts
