"""Tests for claudebox.hook — hook decorator and request/response types."""

import json

import pytest

from claudebox.user.hook import HookRequest, HookResponse, hook


# --- Helpers ---


def _make_hook_data(
    hook_event_name: str = "PreToolUse",
    session_id: str = "test-session",
    **extra,
) -> dict:
    """Build a minimal hook payload dict."""

    data = {
        "session_id": session_id,
        "hook_event_name": hook_event_name,
        "transcript_path": "/fake/transcript.jsonl",
        **extra,
    }
    return data


# --- HookRequest ---


class TestHookRequest:
    """Test HookRequest construction from payload dict."""

    def test_parses_hook_event_name(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data(hook_event_name="Stop"))
        assert req.hook_event_name == "Stop"

    def test_parses_transcript_path(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data(transcript_path="/fake/t.jsonl"))
        assert str(req.transcript_path) == "/fake/t.jsonl"

    def test_stores_raw_data(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_hook_data()
        req = HookRequest(data)
        assert req.data is data

    def test_inherits_workspace(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data())
        assert req.workspace.path == tmp_workspace


# --- HookResponse ---


class TestHookResponse:
    """Test HookResponse builder methods and JSON serialization."""

    @pytest.fixture()
    def response(self, tmp_workspace, monkeypatch):
        """Create a HookResponse for PreToolUse hook."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data(hook_event_name="PreToolUse"))
        return HookResponse(req)

    def test_empty_response_has_hook_output(self, response):
        result = json.loads(str(response))
        assert "hookSpecificOutput" in result
        assert result["hookSpecificOutput"]["hookEventName"] == "PreToolUse"

    def test_add_to_context(self, response):
        response.add_to_context("extra info")
        result = json.loads(str(response))
        assert result["hookSpecificOutput"]["additionalContext"] == "extra info"

    def test_multiple_contexts_joined(self, response):
        response.add_to_context("first")
        response.add_to_context("second")
        result = json.loads(str(response))
        assert "first" in result["hookSpecificOutput"]["additionalContext"]
        assert "second" in result["hookSpecificOutput"]["additionalContext"]

    def test_show_message(self, response):
        response.show("hello user")
        result = json.loads(str(response))
        assert result["systemMessage"] == "hello user"

    def test_multiple_show_messages_joined(self, response):
        response.show("msg1")
        response.show("msg2")
        result = json.loads(str(response))
        assert "msg1" in result["systemMessage"]
        assert "msg2" in result["systemMessage"]

    def test_stop(self, response):
        response.stop("done")
        result = json.loads(str(response))
        assert result["continue"] is False
        assert result["stopReason"] == "done"

    def test_block(self, response):
        response.block("not allowed")
        result = json.loads(str(response))
        assert result["decision"] == "block"
        assert result["reason"] == "not allowed"

    def test_stop_event_omits_hook_specific_output(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data(hook_event_name="Stop"))
        resp = HookResponse(req)
        result = json.loads(str(resp))
        assert "hookSpecificOutput" not in result

    def test_session_end_omits_hook_specific_output(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        req = HookRequest(_make_hook_data(hook_event_name="SessionEnd"))
        resp = HookResponse(req)
        result = json.loads(str(resp))
        assert "hookSpecificOutput" not in result


# --- HookResponse.add_to_env ---


class TestAddToEnv:
    """Test environment variable export via CLAUDE_ENV_FILE."""

    def test_writes_export_line(self, tmp_path, monkeypatch):
        env_file = tmp_path / "env"
        env_file.touch()
        monkeypatch.setenv("CLAUDE_ENV_FILE", str(env_file))
        HookResponse.add_to_env("MY_VAR", "my_value")
        content = env_file.read_text()
        assert "export MY_VAR=my_value\n" in content

    def test_appends_multiple(self, tmp_path, monkeypatch):
        env_file = tmp_path / "env"
        env_file.touch()
        monkeypatch.setenv("CLAUDE_ENV_FILE", str(env_file))
        HookResponse.add_to_env("A", "1")
        HookResponse.add_to_env("B", "2")
        lines = env_file.read_text().strip().split("\n")
        assert len(lines) == 2


# --- @hook decorator ---


class TestHookDecorator:
    """Test @hook decorator dispatch and output."""

    def test_calls_with_request_and_response(self, tmp_workspace, monkeypatch, capsys):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        received = {}

        @hook
        def my_hook(request, response):
            received["request"] = request
            received["response"] = response

        my_hook(data=_make_hook_data())
        assert isinstance(received["request"], HookRequest)
        assert isinstance(received["response"], HookResponse)

    def test_calls_with_request_only(self, tmp_workspace, monkeypatch, capsys):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        received = {}

        @hook
        def my_hook(request):
            received["request"] = request

        my_hook(data=_make_hook_data())
        assert "request" in received

    def test_prints_response_json(self, tmp_workspace, monkeypatch, capsys):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        @hook
        def my_hook(response):
            response.show("visible")

        my_hook(data=_make_hook_data())
        output = capsys.readouterr().out
        result = json.loads(output)
        assert result["systemMessage"] == "visible"

    def test_exception_reraises(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        @hook
        def failing_hook(request, response):
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            failing_hook(data=_make_hook_data())


class TestHookRequestMalformed:
    """Test HookRequest with malformed or incomplete payloads."""

    def test_missing_hook_event_name(self, tmp_workspace, monkeypatch):
        """Payload missing hook_event_name should raise KeyError."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = {
            "session_id": "test-session",
            "transcript_path": "/fake/transcript.jsonl",
        }
        with pytest.raises(KeyError):
            HookRequest(data)

    def test_empty_payload(self, tmp_workspace, monkeypatch):
        """Completely empty payload should raise KeyError."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        with pytest.raises(KeyError):
            HookRequest({})


class TestAddToEnvMissing:
    """Test add_to_env when CLAUDE_ENV_FILE is not set."""

    def test_missing_env_file_raises(self, monkeypatch):
        monkeypatch.delenv("CLAUDE_ENV_FILE", raising=False)
        with pytest.raises(KeyError):
            HookResponse.add_to_env("VAR", "val")
