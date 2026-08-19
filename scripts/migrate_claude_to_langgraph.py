#!/usr/bin/env python3
"""One-way (the Claude SDK's session store is opaque): a Claude session becomes LangGraph-native.

events.jsonl -> messages -> checkpoints.sqlite, then a session.json runtime/provider flip (.bak).
Skips an already-migrated session: the reducer appends, so a rerun would double its history.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime, events_to_messages
from claudebox.config import Config
from claudebox.constants import SESSION_ATTACHMENTS_DIR
from claudebox.core.io import read_jsonl
from claudebox.paths import find_session_dir
from claudebox.session.repository import SessionRepository
from claudebox.workspace import Workspace


async def migrate(workspace_path: Path, session_id: str) -> None:
    """Migrate one session in workspace_path from Claude to LangGraph, in place."""

    workspace = Workspace(workspace_path)
    config = Config.load(workspace_path)

    if config.agent != "langgraph":
        print(
            f"error: workspace agent is {config.agent!r}, not 'langgraph' - set "
            f"[langgraph] in .claudebox/settings.toml before migrating a session into it.",
            file=sys.stderr,
        )
        sys.exit(1)

    session_dir = find_session_dir(workspace_path, session_id)

    if session_dir is None:
        print(f"error: no session directory found for {session_id!r}", file=sys.stderr)
        sys.exit(1)

    events_path = session_dir / "events.jsonl"
    session_json_path = session_dir / "session.json"

    repository = SessionRepository(workspace)
    metadata = repository.get(session_id)

    if metadata.runtime == "LangGraph":
        print(f"'{session_id}' is already runtime=LangGraph - nothing to do.")

        return

    events = list(read_jsonl(events_path))
    messages = events_to_messages(events, attachments_dir=session_dir / SESSION_ATTACHMENTS_DIR)
    print(f"parsed {len(events)} events into {len(messages)} LangChain messages")

    # Nested events drop earlier on parent_tool_use_id, so exclude them - this counts only what
    # the top-level seeded history lost for being thinking content.
    thinking_dropped = sum(
        1
        for e in events
        if e.get("type") == "assistant"
        and e.get("subtype") == "thinking"
        and not e.get("parent_tool_use_id")
    )

    if thinking_dropped:
        print(f"dropped {thinking_dropped} thinking block(s) - not carried into the checkpoint")

    raw_model = config.langgraph_model or ""
    provider = raw_model.partition(":")[0] or None

    runtime = LangGraphRuntime(
        LangGraphAgentSessionConfig(
            runtime="langgraph",
            model=raw_model,
            permission_mode=None,
            effort_level=None,
            cwd=str(workspace_path),
            env={},
            session_id=session_id,
            resume_session_id=None,
            session_dir=session_dir,
            hooks=HookCallbacks(),
            max_tokens_override=config.langgraph_max_tokens_override,
            web_search_provider=config.langgraph_web_search_provider,
            web_search_api_key_env=config.langgraph_web_search_api_key_env,
            mcp_servers=config.langgraph_mcp_servers or {},
            provider_kwargs=dict(config.langgraph_provider_kwargs.get(provider or "", {})),
            cost_overrides=config.langgraph_cost_overrides,
            profile_hooks=config.langgraph_hooks,
            system_prompt=None,
        ),
    )

    await runtime.connect()
    assert runtime._graph is not None

    try:
        thread_config = {"configurable": {"thread_id": session_id}}
        # as_node pins the update to the graph's model-calling node - required whenever a graph has
        # more than one node, or aupdate_state can't infer which node's channel version to bump.
        await runtime._graph.aupdate_state(
            thread_config,
            {"messages": messages},
            as_node="model",
        )
    finally:
        await runtime.disconnect()

    backup_path = session_json_path.with_suffix(".json.bak")
    backup_path.write_text(session_json_path.read_text())

    repository.update(session_id, runtime="LangGraph", provider=provider)

    print(f"seeded {session_dir / 'checkpoints.sqlite'}")
    print(f"backed up {session_json_path} -> {backup_path}")
    print(f"'{session_id}' now resumes as runtime=LangGraph, provider={provider!r}")


def main() -> None:
    """Parse CLI arguments and run the migration."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path, help="Workspace root (contains .claudebox/)")
    parser.add_argument("session_id", help="Session id to migrate")
    args = parser.parse_args()

    asyncio.run(migrate(args.workspace.resolve(), args.session_id))


if __name__ == "__main__":
    main()
