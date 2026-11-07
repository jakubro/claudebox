"""The pin manifests against the scripts that download - every download pinned, every pin well formed."""

from __future__ import annotations

import importlib.util
import re
import shutil
import sys
from pathlib import Path

import pytest


LIB_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def pins():
    spec = importlib.util.spec_from_file_location("pins_script", LIB_ROOT / "scripts" / "pins.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


@pytest.fixture
def tree(tmp_path):
    """A copy of the files the check reads, to mutate one at a time."""

    for relative in ("etc/host-pins.txt", "container/build", "bin/install.sh", ".nvmrc"):
        source, target = LIB_ROOT / relative, tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)

    return tmp_path


def test_the_shipped_manifests_and_scripts_agree(pins):
    assert pins.check() == []


def test_a_bare_download_is_flagged_naming_file_and_line(pins, tree):
    script = tree / "container" / "build" / "fs" / "install_extra.sh"
    script.write_text(
        "#!/bin/bash\nset -euo pipefail\n\ncurl -sSfL https://example.invalid/x.sh | bash\n",
        encoding="utf-8",
    )

    assert pins.check(tree) == [
        f"{script}:4: downloads without a pin or a float declaration: curl -sSfL https://example.invalid/x.sh | bash",
    ]


@pytest.mark.parametrize(
    "line",
    [
        "pip install requests",
        "npm install -g left-pad",
        "uv tool install ruff",
        "go install example.com/tool@latest",
        "git fetch origin",
    ],
)
def test_every_download_form_is_flagged(pins, tree, line):
    script = tree / "container" / "build" / "fs" / "install_extra.sh"
    script.write_text(f"#!/bin/bash\n{line}\n", encoding="utf-8")

    assert any("install_extra.sh:2: downloads without" in problem for problem in pins.check(tree))


def test_a_containerfile_add_from_a_url_is_flagged(pins, tree):
    containerfile = tree / "container" / "build" / "Containerfile"
    text = (
        containerfile.read_text(encoding="utf-8")
        + "ADD https://example.invalid/tool.tar.gz /opt/\n"
    )
    containerfile.write_text(text, encoding="utf-8")
    line = len(text.splitlines())

    assert any(
        f"Containerfile:{line}: downloads without" in problem for problem in pins.check(tree)
    )


@pytest.mark.parametrize(
    ("manifest", "name", "covered"),
    [
        ("container/build/image-pins.txt", "apt-packages", "install_base.sh:11:"),
        ("etc/host-pins.txt", "claudebox-library-update", "install.sh:84:"),
    ],
)
def test_a_floating_download_needs_its_float(pins, tree, manifest, name, covered):
    path = tree / manifest
    path.write_text(
        re.sub(rf"^float {name} .*\n", "", path.read_text(encoding="utf-8"), flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert any(
        covered in problem and "downloads without" in problem for problem in pins.check(tree)
    )


@pytest.mark.parametrize("version", ["latest", "24", "v24", "3.13", "24.x", "stable", "lts"])
def test_a_floating_version_is_refused(pins, tree, version):
    manifest = tree / "container" / "build" / "image-pins.txt"
    text = manifest.read_text(encoding="utf-8")
    manifest.write_text(
        re.sub(r"^(python\s+)\S+", rf"\g<1>{version}", text, flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert any(f"python: version {version} is not exact" in problem for problem in pins.check(tree))


@pytest.mark.parametrize("version", ["3.13.18", "3.14.0-rc.1", "2026.11.2", "2026-11-03"])
def test_an_exact_version_passes(pins, tree, version):
    manifest = tree / "container" / "build" / "image-pins.txt"
    text = manifest.read_text(encoding="utf-8")
    manifest.write_text(
        re.sub(r"^(python\s+)\S+", rf"\g<1>{version}", text, flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert pins.check(tree) == []


def test_a_bump_to_a_loose_version_writes_nothing(pins, tree, monkeypatch):
    image = tree / "container" / "build" / "image-pins.txt"
    monkeypatch.setattr(pins, "HOST_MANIFEST", tree / "etc" / "host-pins.txt")
    monkeypatch.setattr(pins, "IMAGE_MANIFEST", image)
    before = image.read_text(encoding="utf-8")

    assert pins.bump("python", "3.14") == 1
    assert image.read_text(encoding="utf-8") == before


def test_a_row_no_script_reads_is_refused(pins, tree):
    manifest = tree / "container" / "build" / "image-pins.txt"
    manifest.write_text(
        manifest.read_text(encoding="utf-8") + "stray        1.2.3       -             -  -\n",
        encoding="utf-8",
    )

    assert any("stray: no script reads this row" in problem for problem in pins.check(tree))


def test_a_download_without_its_digest_is_refused(pins, tree):
    manifest = tree / "etc" / "host-pins.txt"
    text = manifest.read_text(encoding="utf-8")
    manifest.write_text(
        re.sub(r"^(nvm\s+\S+\s+\S+\s+)[0-9a-f]{64}", r"\g<1>-", text, flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert any("nvm: a download needs its sha256" in problem for problem in pins.check(tree))


def test_a_base_image_without_a_digest_is_refused(pins, tree):
    containerfile = tree / "container" / "build" / "Containerfile"
    text = containerfile.read_text(encoding="utf-8")
    containerfile.write_text(
        re.sub(r"^FROM .*$", "FROM ubuntu:26.04", text, count=1, flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert any("not pinned by digest" in problem for problem in pins.check(tree))


def test_the_node_pin_follows_the_nvmrc_major(pins, tree):
    (tree / ".nvmrc").write_text("v26\n", encoding="utf-8")

    assert any("node 24." in problem and "v26" in problem for problem in pins.check(tree))


def test_the_image_node_pin_follows_the_nvmrc_major(pins, tree):
    manifest = tree / "container" / "build" / "image-pins.txt"
    text = manifest.read_text(encoding="utf-8")
    manifest.write_text(
        re.sub(r"^(node\s+)\S+", r"\g<1>26.1.0", text, flags=re.MULTILINE),
        encoding="utf-8",
    )

    assert any(
        "image-pins.txt" in problem and "node 26.1.0 is not on the .nvmrc major" in problem
        for problem in pins.check(tree)
    )


def test_an_unused_float_is_refused(pins, tree):
    manifest = tree / "container" / "build" / "image-pins.txt"
    manifest.write_text(
        manifest.read_text(encoding="utf-8") + "float stray npm:nothing-uses-this a reason\n",
        encoding="utf-8",
    )

    assert any(
        "float stray - no script uses npm:nothing-uses-this" in problem
        for problem in pins.check(tree)
    )


def test_a_call_naming_no_row_is_refused(pins, tree):
    script = tree / "container" / "build" / "fs" / "install_base.sh"
    script.write_text(
        script.read_text(encoding="utf-8")
        + 'fetch_pinned "$PINS" missing-tool "$PLATFORM" /tmp/x\n',
        encoding="utf-8",
    )

    assert any("no manifest row named missing-tool" in problem for problem in pins.check(tree))


def test_the_image_floats_are_apt_and_the_agent_layers_two_fresh_resolves(pins):
    _, floats, _ = pins.read_manifest(LIB_ROOT / "container" / "build" / "image-pins.txt")
    agent = (LIB_ROOT / "container" / "build" / "fs" / "install_agent.sh").read_text(
        encoding="utf-8",
    )

    assert {f.name for f in floats} == {"claude-code", "agent-python-deps", "apt-packages"}
    assert all(f.source in agent for f in floats if f.name != "apt-packages")
