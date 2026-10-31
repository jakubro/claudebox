"""ARCHITECTURE.md's image-layer table vs the Containerfile - it must name every install layer in
build order."""

from __future__ import annotations

import re
from pathlib import Path


LIB_ROOT = Path(__file__).resolve().parents[2]
CONTAINERFILE = LIB_ROOT / "container" / "build" / "Containerfile"
ARCHITECTURE = LIB_ROOT / "docs" / "ARCHITECTURE.md"

_INSTALL_STEP_RE = re.compile(r"RUN /_install\.sh /(\S+\.sh)")


def _containerfile_scripts(text: str) -> list[str]:
    """Install scripts named by `RUN /_install.sh /<script>` steps, in file order."""

    return _INSTALL_STEP_RE.findall(text)


def _missing_or_out_of_order(scripts: list[str], doc_text: str) -> list[str]:
    """Scripts the doc omits, or - if all are present - [] only when they appear in order."""

    positions = {script: doc_text.find(f"`{script}`") for script in scripts}
    missing = [script for script, pos in positions.items() if pos == -1]

    if missing:
        return missing

    ordered = sorted(scripts, key=lambda s: positions[s])

    return [] if ordered == scripts else scripts


class TestImageLayerTableDrift:
    """ARCHITECTURE.md's layer table tracks the Containerfile's real install steps."""

    def test_architecture_names_every_containerfile_script_in_order(self):
        scripts = _containerfile_scripts(CONTAINERFILE.read_text(encoding="utf-8"))
        problems = _missing_or_out_of_order(scripts, ARCHITECTURE.read_text(encoding="utf-8"))

        assert not problems, f"ARCHITECTURE.md's layer table is missing or misorders: {problems}"

    def test_mutation_a_fifth_install_step_is_caught(self, tmp_path):
        scratch = tmp_path / "Containerfile"
        scratch.write_text(
            "RUN /_install.sh /install_base.sh && rm /install_base.sh\n"
            "RUN /_install.sh /install_new_layer.sh && rm /install_new_layer.sh\n",
            encoding="utf-8",
        )

        scripts = _containerfile_scripts(scratch.read_text(encoding="utf-8"))
        problems = _missing_or_out_of_order(scripts, ARCHITECTURE.read_text(encoding="utf-8"))

        assert problems == ["install_new_layer.sh"], (
            f"expected only the new script flagged, got {problems}"
        )
