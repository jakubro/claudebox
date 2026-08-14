"""Tests for prune failure reporting - the runtime's own error must reach the user."""

import argparse
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

from claudebox_cli import cmd_prune


def _collapse(text: str) -> str:
    """Collapse Rich's width-based line wrapping so assertions match whole phrases."""

    return " ".join(text.split())


class TestBackendFailureReporting:
    """A failing runtime prune reports what the runtime said, not just Python's summary."""

    def test_stderr_and_exit_code_reach_the_output(self, capsys):
        """The runtime's reason is what makes the failure diagnosable at all."""

        failures: list[str] = []
        error = subprocess.CalledProcessError(
            returncode=125,
            cmd=["podman", "image", "prune"],
            stderr="Error: image used by 0e5f: image is in use by a container\n",
        )

        with patch("subprocess.run", side_effect=error):
            count = cmd_prune._prune_backend("podman", cmd_prune._PRUNE_OPS[0], False, failures)

        err = _collapse(capsys.readouterr().err)

        assert count == 0
        assert failures == ["dangling images"]
        assert "image is in use by a container" in err
        assert "125" in err

    def test_empty_stderr_still_names_the_exit_code(self, capsys):
        """A silent runtime failure degrades to the exit code rather than an empty line."""

        failures: list[str] = []
        error = subprocess.CalledProcessError(
            returncode=1,
            cmd=["podman", "container", "prune"],
            stderr="",
        )

        with patch("subprocess.run", side_effect=error):
            cmd_prune._prune_backend("podman", cmd_prune._PRUNE_OPS[1], False, failures)

        err = _collapse(capsys.readouterr().err)

        assert "exit status 1" in err
        assert "returned non-zero" not in err
        assert failures == ["stopped containers"]

    def test_missing_runtime_binary_is_named(self, capsys):
        """A missing runtime still names the binary - guards that stderr surfacing doesn't degrade this path."""

        failures: list[str] = []
        error = FileNotFoundError(2, "No such file or directory", "podman")

        with patch("subprocess.run", side_effect=error):
            cmd_prune._prune_backend("podman", cmd_prune._PRUNE_OPS[0], False, failures)

        err = _collapse(capsys.readouterr().err)

        assert "podman" in err
        assert failures == ["dangling images"]

    def test_markup_in_runtime_text_neither_crashes_nor_vanishes(self, capsys):
        """Runtime text is data, not markup - an unescaped bracket becomes a style tag or raises MarkupError."""

        failures: list[str] = []
        error = subprocess.CalledProcessError(
            returncode=125,
            cmd=["podman", "image", "prune"],
            stderr="Error: [/red] layer [bold] still referenced\n",
        )

        with patch("subprocess.run", side_effect=error):
            cmd_prune._prune_backend("podman", cmd_prune._PRUNE_OPS[0], False, failures)

        err = _collapse(capsys.readouterr().err)

        assert "[/red]" in err
        assert "[bold]" in err
        assert "still referenced" in err


class TestCategoryIndependence:
    """One category failing must not stop the others from running."""

    def test_image_failure_still_runs_containers_and_exits_non_zero(self, capsys):
        """Every category is attempted, and the command reports failure overall."""

        calls: list[list[str]] = []

        def fake_run(args, **_kwargs):
            calls.append(args)

            if args[1] == "image":
                raise subprocess.CalledProcessError(
                    returncode=125,
                    cmd=args,
                    stderr="Error: cannot remove image\n",
                )

            return subprocess.CompletedProcess(
                args,
                0,
                stdout="Total reclaimed space: 0B\n",
                stderr="",
            )

        args = argparse.Namespace(verbose=False)

        with (
            patch("subprocess.run", side_effect=fake_run),
            patch.object(cmd_prune, "cleanup_stale_dirs", return_value=[]),
            patch.object(cmd_prune.Config, "load", return_value=SimpleNamespace(backend="podman")),
        ):
            exit_code = cmd_prune.handle(args)

        err = _collapse(capsys.readouterr().err)

        assert exit_code == 1
        assert [a[1] for a in calls] == ["image", "container"]
        assert "cannot remove image" in err
        assert "stopped containers" in err
