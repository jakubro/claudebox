"""Profile session-start hook resolution and execution."""

import asyncio
import stat
import subprocess
from pathlib import Path

import pytest

from claudebox.agent_session._profile_hooks import (
    resolve_session_start_hook,
    run_session_start_hook,
)


def _write_hook(path: Path, body: str) -> Path:
    """Write an executable hook script and return its path."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IRWXU)

    return path


def _any_process_matches(needle: str) -> bool:
    """Whether any live process command line mentions `needle`."""

    listing = subprocess.run(
        ["ps", "-eo", "args"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout

    return any(needle in line for line in listing.splitlines()[1:])


def _echo_context_hook(context: str) -> str:
    """A hook that answers with the Claude Code response envelope."""

    return (
        "#!/bin/bash\n"
        "cat > /dev/null\n"
        f'printf \'{{"hookSpecificOutput":{{"additionalContext":"{context}"}}}}\'\n'
    )


class TestResolution:
    def test_uses_the_convention_path_when_nothing_is_configured(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        expected = _write_hook(
            tmp_path / ".claudebox" / "profile" / "hooks" / "session_start.py",
            "#!/bin/bash\n",
        )

        assert resolve_session_start_hook(None) == expected

    def test_returns_none_when_the_convention_path_is_absent(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        assert resolve_session_start_hook(None) is None

    def test_relative_override_resolves_against_the_profile(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        expected = _write_hook(
            tmp_path / ".claudebox" / "profile" / "hooks" / "custom.py",
            "#!/bin/bash\n",
        )

        assert resolve_session_start_hook("hooks/custom.py") == expected

    def test_absolute_override_is_used_verbatim(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        expected = _write_hook(tmp_path / "elsewhere" / "hook.py", "#!/bin/bash\n")

        assert resolve_session_start_hook(str(expected)) == expected

    def test_configured_but_missing_file_resolves_to_none(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        assert resolve_session_start_hook("hooks/nope.py") is None


class TestExecution:
    @pytest.mark.anyio
    async def test_returns_the_additional_context(self, tmp_path):
        hook = _write_hook(tmp_path / "hook.sh", _echo_context_hook("bootstrap text"))

        context = await run_session_start_hook(
            hook,
            session_id="s1",
            transcript_path=tmp_path / "events.jsonl",
        )

        assert context == "bootstrap text"

    @pytest.mark.anyio
    async def test_hook_receives_the_claude_code_payload(self, tmp_path):
        """A script written against the hook SDK reads these three keys off stdin."""

        captured = tmp_path / "captured.json"
        hook = _write_hook(
            tmp_path / "hook.sh",
            f"#!/bin/bash\ncat > {captured}\nprintf '{{}}'\n",
        )

        await run_session_start_hook(
            hook,
            session_id="s-42",
            transcript_path=tmp_path / "events.jsonl",
        )

        payload = captured.read_text()
        assert '"session_id": "s-42"' in payload
        assert '"hook_event_name": "SessionStart"' in payload
        assert "events.jsonl" in payload

    @pytest.mark.anyio
    async def test_nonzero_exit_degrades_to_no_context(self, tmp_path):
        hook = _write_hook(tmp_path / "hook.sh", "#!/bin/bash\ncat > /dev/null\nexit 3\n")

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )

    @pytest.mark.anyio
    async def test_unparseable_output_degrades_to_no_context(self, tmp_path):
        hook = _write_hook(
            tmp_path / "hook.sh",
            "#!/bin/bash\ncat > /dev/null\nprintf 'not json'\n",
        )

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )

    @pytest.mark.anyio
    async def test_response_without_context_degrades_to_none(self, tmp_path):
        hook = _write_hook(
            tmp_path / "hook.sh",
            '#!/bin/bash\ncat > /dev/null\nprintf \'{"systemMessage":"hi"}\'\n',
        )

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )

    @pytest.mark.anyio
    async def test_blank_context_is_treated_as_none(self, tmp_path):
        hook = _write_hook(tmp_path / "hook.sh", _echo_context_hook("   "))

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )

    @pytest.mark.anyio
    async def test_a_hook_that_hangs_is_abandoned(self, tmp_path, monkeypatch):
        """Session start must not be held hostage by a wedged profile script."""

        monkeypatch.setattr("claudebox.agent_session._profile_hooks.HOOK_TIMEOUT_SECONDS", 0.25)
        hook = _write_hook(tmp_path / "hook.sh", "#!/bin/bash\nsleep 30\n")

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )

    @pytest.mark.anyio
    async def test_cancellation_kills_the_hook_process(self, tmp_path):
        """Session stop cancels the task this runs on; the child must not outlive it."""

        marker = tmp_path / "still-running"
        hook = _write_hook(
            tmp_path / "hook.sh",
            f"#!/bin/bash\ntouch {marker}\nsleep 30\n",
        )

        task = asyncio.create_task(
            run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            ),
        )

        while not marker.exists():
            await asyncio.sleep(0.05)

        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        # The sleep would still be running if the child had been orphaned.
        assert not _any_process_matches(str(hook))

    @pytest.mark.anyio
    async def test_a_non_executable_hook_degrades_to_no_context(self, tmp_path):
        hook = tmp_path / "hook.sh"
        hook.write_text("#!/bin/bash\nprintf '{}'\n")

        assert (
            await run_session_start_hook(
                hook,
                session_id="s1",
                transcript_path=tmp_path / "events.jsonl",
            )
            is None
        )
