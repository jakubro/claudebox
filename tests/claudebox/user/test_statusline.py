"""Tests for claudebox.statusline - statusline decorator and request type."""

from datetime import timedelta

from claudebox.user.statusline import StatuslineRequest, statusline


# --- Helpers ---


def _make_statusline_data(
    session_id: str = "test-session",
    workspace_path: str = "/fake/workspace",
    **overrides,
) -> dict:
    """Build a minimal statusline payload dict."""

    data = {
        "session_id": session_id,
        "model": {"display_name": "Sonnet 4.6"},
        "output_style": {"name": "concise"},
        "cost": {
            "total_cost_usd": 0.0512,
            "total_duration_ms": 65000,
            "total_api_duration_ms": 42000,
        },
        "workspace": {
            "current_dir": workspace_path,
        },
    }
    data.update(overrides)

    return data


# --- StatuslineRequest ---


class TestStatuslineRequest:
    """Test StatuslineRequest field parsing from payload dict."""

    def test_parses_model(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        req = StatuslineRequest(data)
        assert req.model == "Sonnet 4.6"

    def test_parses_output_style(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        req = StatuslineRequest(data)
        assert req.output_style == "concise"

    def test_parses_total_cost(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        req = StatuslineRequest(data)
        assert req.total_cost == 0.0512

    def test_parses_conversation_duration(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        req = StatuslineRequest(data)
        assert req.conversation_duration == timedelta(seconds=65)

    def test_parses_api_duration(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        req = StatuslineRequest(data)
        assert req.api_duration == timedelta(seconds=42)

    def test_parses_relative_dir(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        subdir = tmp_workspace / "src"
        subdir.mkdir()
        data = _make_statusline_data(workspace_path=str(subdir))
        req = StatuslineRequest(data)
        assert str(req.relative_dir) == "src"


# --- @statusline decorator ---


class TestStatuslineDecorator:
    """Test @statusline decorator dispatch and output."""

    def test_calls_with_request(self, tmp_workspace, monkeypatch, capsys):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        @statusline
        def my_statusline(request):
            return f"{request.model} | ${request.total_cost:.4f}"

        my_statusline(data=_make_statusline_data(workspace_path=str(tmp_workspace)))
        output = capsys.readouterr().out.strip()
        assert "Sonnet 4.6" in output
        assert "$0.0512" in output

    def test_calls_without_request(self, tmp_workspace, monkeypatch, capsys):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        @statusline
        def my_statusline():
            return "static"

        my_statusline(data=_make_statusline_data(workspace_path=str(tmp_workspace)))
        output = capsys.readouterr().out.strip()
        assert output == "static"

    def test_duration_truncates_milliseconds(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        data = _make_statusline_data(workspace_path=str(tmp_workspace))
        data["cost"]["total_duration_ms"] = 65432
        req = StatuslineRequest(data)
        # Truncated to nearest second: 65000ms = 65s
        assert req.conversation_duration == timedelta(seconds=65)
