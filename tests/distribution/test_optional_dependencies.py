"""pyproject.toml provider extras drift-guard against _providers.PROVIDER_EXTRAS.

Every entry in PROVIDER_EXTRAS must have a matching `[project.optional-dependencies]`
entry in pyproject.toml whose single requirement is `langchain-<x>`, and must be
bundled into `langgraph-all` (the extra the container agent layer preinstalls via
`uv sync --extra langgraph-all`). Catches drift: a provider added to `_providers.py`
without an extra, an extra missing from `langgraph-all` (so it would NOT ship in the
image), or a core dependency silently relocated to an optional extra.
"""

import re
import tomllib
from pathlib import Path

import pytest

from claudebox.agent_session._providers import PROVIDER_EXTRAS


PYPROJECT_PATH = Path(__file__).resolve().parents[2] / "pyproject.toml"


@pytest.fixture(scope="module")
def pyproject() -> dict:
    """Load pyproject.toml once per module."""

    return tomllib.loads(PYPROJECT_PATH.read_text())


@pytest.fixture(scope="module")
def optional_deps(pyproject: dict) -> dict[str, list[str]]:
    return pyproject["project"]["optional-dependencies"]


class TestProviderExtrasAreDefined:
    """Every PROVIDER_EXTRAS extra is a defined single-`langchain-*` pyproject extra."""

    def test_every_extra_is_defined(self, optional_deps):
        missing = [
            f"provider={provider!r} maps to extra [{extra}] not in pyproject"
            for provider, extra in PROVIDER_EXTRAS.items()
            if extra not in optional_deps
        ]
        assert not missing, "\n".join(missing)

    def test_every_extra_resolves_to_langchain_provider_package(self, optional_deps):
        """Each provider extra installs exactly one langchain-<provider> package."""

        violations = []

        for extra in PROVIDER_EXTRAS.values():
            reqs = optional_deps.get(extra, [])

            if len(reqs) != 1:
                violations.append(f"extra [{extra}] must list exactly one requirement, got {reqs}")
                continue

            if not reqs[0].startswith("langchain-"):
                violations.append(
                    f"extra [{extra}] must install a langchain-* package; got {reqs[0]!r}"
                )

        assert not violations, "\n".join(violations)


class TestCombinedBundlesReferenceDefinedExtras:
    """`langgraph-cloud` and `langgraph-all` must reference extras that exist."""

    BUNDLE_RE = re.compile(r"claudebox\[([^]]+)\]")

    def _bundle_extras(self, optional_deps, name) -> set[str]:
        bundle = optional_deps[name]
        assert len(bundle) == 1, f"{name} must be single-entry; got {bundle}"
        match = self.BUNDLE_RE.match(bundle[0])
        assert match is not None, f"{name} must use `claudebox[a,b,c]` form; got {bundle[0]}"

        return {e.strip() for e in match.group(1).split(",")}

    def test_langgraph_cloud_extras_defined(self, optional_deps):
        for extra in self._bundle_extras(optional_deps, "langgraph-cloud"):
            assert extra in optional_deps, f"langgraph-cloud references undefined extra `[{extra}]`"

    def test_langgraph_all_extras_defined(self, optional_deps):
        for extra in self._bundle_extras(optional_deps, "langgraph-all"):
            assert extra in optional_deps, f"langgraph-all references undefined extra `[{extra}]`"

    def test_langgraph_all_covers_every_provider_extra(self, optional_deps):
        """`langgraph-all` (the preinstalled bundle) must contain every PROVIDER_EXTRAS extra."""

        bundle_extras = self._bundle_extras(optional_deps, "langgraph-all")

        for provider, extra in PROVIDER_EXTRAS.items():
            assert extra in bundle_extras, (
                f"langgraph-all missing extra `[{extra}]` (provider {provider!r}) - "
                "it would not be preinstalled in the agent image"
            )


class TestCorePackageDependenciesUnchanged:
    """Core dependencies must NOT silently move into optional extras."""

    REQUIRED_CORE_DEPS = {
        "langchain",
        "langchain-core",
        "langchain-mcp-adapters",
        "langchain-ollama",
        "langgraph",
        "langgraph-checkpoint-sqlite",
    }

    def test_required_core_deps_present(self, pyproject):
        """Every member of REQUIRED_CORE_DEPS appears in [project.dependencies]."""

        dep_names = {self._package_name(req) for req in pyproject["project"]["dependencies"]}
        missing = self.REQUIRED_CORE_DEPS - dep_names
        assert not missing, f"core deps missing from [project.dependencies]: {missing}"

    @staticmethod
    def _package_name(requirement: str) -> str:
        """Strip version pin to recover the bare package name."""

        # PEP 508-ish: `pkg>=1,<2` or `pkg[extra]>=1` or `pkg`.
        return re.split(r"[><=!~\[ ]", requirement, maxsplit=1)[0].strip()
