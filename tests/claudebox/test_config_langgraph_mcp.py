"""TOML parsing for `[langgraph.mcp.<name>]` blocks into Config.langgraph_mcp_servers."""

from pathlib import Path

from claudebox.config import Config


def _seed_workspace(path: Path, settings_toml: str) -> None:
    """Write a workspace `.workspace` marker + `.claudebox/settings.toml`."""

    (path / ".workspace").write_text("")
    (path / ".claudebox").mkdir(parents=True, exist_ok=True)
    (path / ".claudebox" / "settings.toml").write_text(settings_toml)


class TestLangGraphMcpParsing:
    def test_no_mcp_section_returns_none(self, tmp_path):
        _seed_workspace(
            tmp_path,
            'agent = "langgraph"\n[langgraph]\nmodel = "llama3.2:3b"\n',
        )

        config = Config.load(tmp_path)

        assert config.langgraph_mcp_servers is None

    def test_single_stdio_server(self, tmp_path):
        _seed_workspace(
            tmp_path,
            """agent = "langgraph"
[langgraph]
model = "llama3.2:3b"

[langgraph.mcp.context7]
transport = "stdio"
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
""",
        )

        config = Config.load(tmp_path)

        assert config.langgraph_mcp_servers is not None
        assert "context7" in config.langgraph_mcp_servers
        ctx7 = config.langgraph_mcp_servers["context7"]
        assert ctx7["transport"] == "stdio"
        assert ctx7["command"] == "npx"
        assert ctx7["args"] == ["-y", "@upstash/context7-mcp"]

    def test_multiple_servers_with_distinct_transports(self, tmp_path):
        _seed_workspace(
            tmp_path,
            """agent = "langgraph"
[langgraph]
model = "llama3.2:3b"

[langgraph.mcp.context7]
transport = "stdio"
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[langgraph.mcp.web]
transport = "sse"
url = "http://127.0.0.1:8765/sse"
""",
        )

        config = Config.load(tmp_path)

        servers = config.langgraph_mcp_servers
        assert servers is not None
        assert set(servers.keys()) == {"context7", "web"}
        assert servers["context7"]["transport"] == "stdio"
        assert servers["web"]["transport"] == "sse"
        assert servers["web"]["url"] == "http://127.0.0.1:8765/sse"

    def test_env_subtable_passes_through(self, tmp_path):
        _seed_workspace(
            tmp_path,
            """agent = "langgraph"
[langgraph]
model = "llama3.2:3b"

[langgraph.mcp.local]
transport = "stdio"
command = "/path/to/local-mcp-server"
args = []
env = { LOG_LEVEL = "info", API_KEY = "secret" }
""",
        )

        config = Config.load(tmp_path)

        assert config.langgraph_mcp_servers is not None
        local = config.langgraph_mcp_servers["local"]
        assert local["env"] == {"LOG_LEVEL": "info", "API_KEY": "secret"}
