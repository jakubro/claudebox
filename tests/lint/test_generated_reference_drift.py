"""Both generated reference pages against the sources that produce them - neither can be
hand-edited or left behind, and shortcuts is checked against hand-maintained SPEC.md as well."""

import importlib.util
import re
import subprocess
from pathlib import Path


LIB_ROOT = Path(__file__).resolve().parents[2]
SPEC = LIB_ROOT / "docs" / "SPEC.md"
PANEL_CONFIG = LIB_ROOT / "src" / "claudebox_frontend" / "src" / "config" / "panel.js"
CLI_PAGE = LIB_ROOT / "docs" / "reference" / "cli.md"
SHORTCUTS_PAGE = LIB_ROOT / "docs" / "reference" / "shortcuts.md"
SHORTCUTS_GENERATOR = LIB_ROOT / "scripts" / "gen-shortcuts-docs.js"

# Section 2's three keyboard tables. Section 2.4 is mouse gestures and has no place in this check.
_KEYBOARD_SECTIONS = ("2.1", "2.2", "2.3")

_SECTION_RE = re.compile(r"^### (\d+\.\d+)", re.MULTILINE)
_PANEL_SHORTCUT_RE = re.compile(r"shortcut: '([^']+)'")
_SYMBOLS = {"↑": "up", "↓": "down", "←": "left", "→": "right"}


def _load_cli_generator():
    """Load the hyphenated CLI generator as an importable module."""

    spec = importlib.util.spec_from_file_location(
        "gen_cli_docs",
        LIB_ROOT / "scripts" / "gen-cli-docs.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def _canonical(binding: str) -> set[str]:
    """Expand one displayed binding into the atomic combos it stands for.
    `Alt+PageUp / PageDown` is two sharing a prefix; `Alt+? (or Alt+/)` is one with an aside."""

    text = binding.split(" (or ")[0].strip()

    for symbol, word in _SYMBOLS.items():
        text = text.replace(symbol, word)

    text = text.lower().replace(" arrow", "")
    head, _, tail = text.partition(" / ")
    prefix = head[: head.rfind("+") + 1]

    combos = [head] if not tail else [head, tail if "+" in tail else prefix + tail]

    return {combo.strip() for combo in combos}


def _spec_keyboard_bindings() -> set[str]:
    """Every binding named in the first column of SPEC section 2's keyboard tables."""

    text = SPEC.read_text()
    bounds = [(m.group(1), m.start()) for m in _SECTION_RE.finditer(text)]
    found: set[str] = set()

    for index, (number, start) in enumerate(bounds):
        if number not in _KEYBOARD_SECTIONS:
            continue

        end = bounds[index + 1][1] if index + 1 < len(bounds) else len(text)

        for line in text[start:end].splitlines():
            cells = [cell.strip() for cell in line.split("|")]

            if (
                len(cells) > 2
                and cells[1]
                and not set(cells[1]) <= {"-"}
                and cells[1] != "Shortcut"
            ):
                found |= _canonical(cells[1])

    return found


def _page_bindings() -> set[str]:
    """Every binding the generated shortcuts page lists, in the same canonical form."""

    found: set[str] = set()

    for line in SHORTCUTS_PAGE.read_text().splitlines():
        match = re.match(r"^\| `{1,2} ?(.+?) ?`{1,2} \|", line)

        if match:
            found |= _canonical(match.group(1))

    return found


class TestGeneratedReferenceDrift:
    """Both pages track their generator, and the shortcuts page tracks the specification."""

    def test_cli_page_matches_a_fresh_render(self):
        assert CLI_PAGE.read_text() == _load_cli_generator().build_document(), (
            "docs/reference/cli.md is stale - run `just docs`"
        )

    def test_cli_page_carries_every_registered_verb(self):
        page = CLI_PAGE.read_text()
        missing = [
            name
            for name, _ in _load_cli_generator().verbs()
            if f"## `claudebox {name}`" not in page
        ]

        assert not missing, f"verbs registered but absent from the CLI reference: {missing}"

    def test_shortcuts_page_matches_a_fresh_render(self):
        rendered = subprocess.run(
            ["node", str(SHORTCUTS_GENERATOR), "--stdout"],
            capture_output=True,
            text=True,
            check=True,
            cwd=LIB_ROOT,
        )

        assert SHORTCUTS_PAGE.read_text() == rendered.stdout, (
            "docs/reference/shortcuts.md is stale - run `just docs`"
        )

    def test_shortcuts_page_carries_every_specified_binding(self):
        missing = sorted(_spec_keyboard_bindings() - _page_bindings())

        assert not missing, (
            f"specified in SPEC.md section 2 but absent from the shortcuts reference: {missing}"
        )

    def test_shortcuts_page_carries_every_panel_toggle(self):
        declared = set(_PANEL_SHORTCUT_RE.findall(PANEL_CONFIG.read_text()))
        missing = sorted({key for key in declared if _canonical(key) - _page_bindings()})

        assert not missing, (
            f"declared in panel.js but absent from the shortcuts reference: {missing}"
        )
