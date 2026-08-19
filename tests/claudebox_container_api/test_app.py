"""Tests for the container API app factory - host binding forwarded to http_serve."""

from unittest.mock import patch

from claudebox_container_api.app import run_container_api


class TestRunContainerApiHostBinding:
    """cli_args' host reaches http_serve unchanged - the caller decides the default."""

    def test_forwards_host_from_cli_args(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))

        with patch("claudebox_container_api.app.http_serve") as mock_http_serve:
            run_container_api(port=8000, host="127.0.0.1")

        assert mock_http_serve.call_args.kwargs["host"] == "127.0.0.1"

    def test_forwards_all_interfaces_default(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))

        with patch("claudebox_container_api.app.http_serve") as mock_http_serve:
            run_container_api(port=8000, host="0.0.0.0")

        assert mock_http_serve.call_args.kwargs["host"] == "0.0.0.0"
