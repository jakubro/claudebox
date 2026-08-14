"""End-to-end behavioral tests for [containers] nested opt-in.

Fake podman records every arg it receives, proving the opt-in flag reaches the container
launch command through real config parsing and CLI dispatch - not that nested podman-in-podman
works, which needs a real kernel and is covered by a separate host-level reproduction script.
"""

from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


def _write_nested_setting(workspace: Path, *, nested: bool) -> None:
    # Marks workspace as its own root, or walk_up climbs past tmp_path (bwrap is skipped
    # in-container, see tests/conftest.py).
    (workspace / ".workspace").touch()

    settings_dir = workspace / ".claudebox"
    settings_dir.mkdir(parents=True, exist_ok=True)
    (settings_dir / "settings.toml").write_text(f"[containers]\nnested = {str(nested).lower()}\n")


def _last_podman_invocation(record_dir: Path) -> str:
    log = (record_dir / "podman.log").read_text()

    return log.strip().splitlines()[-1]


# SPEC: container:nested-opt-in
class TestNestedOptIn:
    """A workspace opts in via ``[containers] nested = true``; off by default."""

    def test_nested_true_grants_fuse_device(self, tmp_path, record_dir, run_claudebox) -> None:
        _write_nested_setting(tmp_path, nested=True)

        run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)

        invocation = _last_podman_invocation(record_dir)
        assert "--device /dev/fuse" in invocation
        assert "--tmpfs /var/lib/containers-storage:size=" in invocation

    def test_no_settings_file_omits_fuse_device(self, tmp_path, record_dir, run_claudebox) -> None:
        (tmp_path / ".workspace").touch()  # see _write_nested_setting's comment

        run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)

        invocation = _last_podman_invocation(record_dir)
        assert "--device" not in invocation


# SPEC: container:nested-isolation
class TestNestedIsolationDefault:
    """Nesting off means no capability is ever granted - inner containers cannot even start.

    The deeper guarantee (a running inner container stays invisible to the host and disappears
    with the session) needs real kernel namespaces fake podman can't exercise here; verified
    separately by a host-level reproduction script.
    """

    def test_nested_false_omits_fuse_device(self, tmp_path, record_dir, run_claudebox) -> None:
        _write_nested_setting(tmp_path, nested=False)

        run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)

        invocation = _last_podman_invocation(record_dir)
        assert "--device" not in invocation
