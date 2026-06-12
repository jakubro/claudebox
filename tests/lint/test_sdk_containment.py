"""SDK containment - SdkContainmentAudit (python-guidelines-audit.py) prefix enforcement.

The audit script has a hyphenated filename (not importable by name), so it is loaded
via importlib from its path. Banned module names are passed as strings / written into
tmp files - this test module imports no banned SDK package.
"""

import importlib.util
from pathlib import Path


LIB_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = LIB_ROOT / "scripts" / "python-guidelines-audit.py"


def _load_audit_module():
    """Load the hyphenated audit script as an importable module."""

    spec = importlib.util.spec_from_file_location("guidelines_audit", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


_AUDIT = _load_audit_module()
SdkContainmentAudit = _AUDIT.SdkContainmentAudit
glob_to_regex = _AUDIT._glob_to_regex


def _rule_name(module: str, rel: str) -> str | None:
    """Return the name of the containment rule `module` violates from file `rel`, else None."""

    rule = SdkContainmentAudit(Path("/unused"))._violated_rule(module, rel)

    return rule.name if rule is not None else None


# A representative non-allowlisted source file (anything outside the adapter allowlists).
_OUTSIDE = "src/claudebox/foo.py"


# --- glob -> regex: ** matches any number of path segments ---


class TestGlobToRegex:
    def test_double_star_matches_zero_segments(self):
        assert glob_to_regex("a/**/*.py").match("a/b.py")

    def test_double_star_matches_many_segments(self):
        assert glob_to_regex("a/**/*.py").match("a/b/c/d.py")

    def test_single_star_does_not_cross_slash(self):
        rx = glob_to_regex("a/*.py")
        assert rx.match("a/b.py")
        assert not rx.match("a/b/c.py")

    def test_anchored_exact(self):
        rx = glob_to_regex("a.py")
        assert rx.match("a.py")
        assert not rx.match("xa.py")
        assert not rx.match("a.pyx")


# --- langchain / langgraph prefix rule ---


class TestLangchainLanggraphRule:
    def test_langchain_anthropic_blocked(self):
        assert _rule_name("langchain_anthropic", _OUTSIDE) == "langchain/langgraph"

    def test_langchain_core_from_import_blocked(self):
        assert _rule_name("langchain_core.messages", _OUTSIDE) == "langchain/langgraph"

    def test_langgraph_blocked(self):
        assert _rule_name("langgraph", _OUTSIDE) == "langchain/langgraph"

    def test_langgraph_checkpoint_family_blocked(self):
        # Prefix pattern covers the langgraph_* family, not just bare langgraph.
        assert _rule_name("langgraph_checkpoint_sqlite", _OUTSIDE) == "langchain/langgraph"

    def test_future_langchain_provider_auto_blocked(self):
        # The whole point - a new langchain_* package needs no rule change.
        assert _rule_name("langchain_xyz_future_provider", _OUTSIDE) == "langchain/langgraph"

    def test_unrelated_import_passes(self):
        assert _rule_name("json", _OUTSIDE) is None

    def test_lookalike_prefix_does_not_trigger(self):
        # `langfuse` shares a substring but not the bounded langchain/langgraph token.
        assert _rule_name("langfuse", _OUTSIDE) is None

    def test_adapter_file_allowed(self):
        rel = "src/claudebox/agent_session/runtime_langgraph.py"
        assert _rule_name("langgraph", rel) is None

    def test_langgraph_tools_flat_allowed(self):
        rel = "src/claudebox/agent_session/langgraph_tools/web.py"
        assert _rule_name("langchain_core", rel) is None

    def test_langgraph_tools_nested_allowed(self):
        rel = "src/claudebox/agent_session/langgraph_tools/sub/deep.py"
        assert _rule_name("langgraph.graph", rel) is None


# --- claude_agent_sdk rule ---


class TestClaudeSdkRule:
    def test_import_blocked(self):
        assert _rule_name("claude_agent_sdk", _OUTSIDE) == "claude_agent_sdk"

    def test_submodule_from_import_blocked(self):
        assert _rule_name("claude_agent_sdk.types", _OUTSIDE) == "claude_agent_sdk"

    def test_unrelated_import_passes(self):
        assert _rule_name("json", _OUTSIDE) is None

    def test_lookalike_prefix_does_not_trigger(self):
        # `claude_agent_sdk_helper` is NOT the SDK; the bounded regex must not over-fire.
        assert _rule_name("claude_agent_sdk_helper", _OUTSIDE) is None

    def test_adapter_file_allowed(self):
        rel = "src/claudebox/agent_session/runtime_claude.py"
        assert _rule_name("claude_agent_sdk", rel) is None


# --- bundled scan over the real tree + a seeded tmp tree ---


class TestBundledScan:
    def test_scan_src_and_tests_is_clean_on_head(self):
        # Parity guard: the audit reports zero violations across the real src/ + tests/.
        assert SdkContainmentAudit(LIB_ROOT).run(verbose=False) == 0

    def test_seeded_violation_flagged_and_allowlist_respected(self, tmp_path, capsys):
        agent = tmp_path / "src" / "claudebox" / "agent_session"
        agent.mkdir(parents=True)
        (tmp_path / "src" / "claudebox" / "bad.py").write_text("import claude_agent_sdk\n")
        (agent / "runtime_claude.py").write_text("import claude_agent_sdk\n")

        total = SdkContainmentAudit(tmp_path).run(verbose=False)
        out = capsys.readouterr().out
        flagged = [
            ln.split(":", 1)[0] for ln in out.splitlines() if ln and not ln.startswith("---")
        ]

        assert total == 1
        assert flagged == ["src/claudebox/bad.py"]
