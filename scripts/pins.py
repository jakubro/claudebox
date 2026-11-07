"""Pin manifests of the host binaries and the image: the offline lint check, and the pin bump."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST_MANIFEST = ROOT / "etc" / "host-pins.txt"
IMAGE_MANIFEST = ROOT / "container" / "build" / "image-pins.txt"
CONTAINERFILE = ROOT / "container" / "build" / "Containerfile"
NVMRC = ROOT / ".nvmrc"
BASE_IMAGE = "base-image"
BASE_REPOSITORY = "docker.io/library/ubuntu"

PLATFORMS = frozenset({"linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64", "*", "-"})
DOWNLOADS = re.compile(
    r"\bcurl\s+(-|https?:|\"|\$)|\bwget\s+(-|https?:|\"|\$)|\bgit\s+(clone|fetch)\b|\bmise\s+use\b"
    r"|\bcargo\s+install\b|npm:|^\s*FROM\s|\bapt(-get)?\s+(-\S+\s+)*install\b|\bpip3?\s+install\b"
    r"|\buv\s+tool\s+install\b|\bnpm\s+(install|i)\b|\bgo\s+install\b|^\s*ADD\s+(--\S+\s+)*https?://",
)
EXACT_VERSION = re.compile(r"\d+(\.\d+){2,}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?|\d{4}-\d{2}-\d{2}")
FLOAT = re.compile(r"float\s+(\S+)\s+('[^']+'|\S+)\s+(\S.*)")
PINNED_CALL = re.compile(r"\b(?:fetch_pinned|pin_field)\s+\S+\s+(\S+)")
PIN_READER = re.compile(r"^(?:fetch_pinned|pin_field)\(\)\s*\{")
BASE_FROM = re.compile(r"^FROM\s+(\S+):(\S+)@sha256:([0-9a-f]{64})\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Row:
    """One pinned input: an exact version, and for a download its platform, digest and URL."""

    manifest: Path
    line: int
    name: str
    version: str
    platform: str
    sha256: str
    url: str

    def resolved_url(self) -> str:
        """The row's URL with its version substituted."""

        return self.url.replace("{version}", self.version)


@dataclass(frozen=True)
class Float:
    """An input declared to resolve fresh at every build, with the reason it may."""

    manifest: Path
    line: int
    name: str
    source: str
    reason: str


def read_manifest(path: Path) -> tuple[list[Row], list[Float], list[str]]:
    """Every row and float declaration of `path`, and a problem for each malformed line."""

    rows: list[Row] = []
    floats: list[Float] = []
    problems: list[str] = []

    for number, text in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        code = text.split("#", 1)[0].strip()
        fields = code.split()

        if not fields:
            continue
        elif fields[0] == "float" and (match := FLOAT.fullmatch(code)):
            floats.append(Float(path, number, match[1], match[2].strip("'"), match[3]))
        elif fields[0] != "float" and len(fields) == 5:
            rows.append(Row(path, number, *fields))
        else:
            problems.append(
                f"{path}:{number}: expected `name version platform sha256 url` or a float: {text}",
            )

    return rows, floats, problems


def check(root: Path = ROOT, extra_scripts: tuple[Path, ...] = ()) -> list[str]:
    """Every way the manifests and the scripts that download disagree, as `file:line: problem` lines."""

    host_rows, host_floats, problems = read_manifest(root / "etc" / "host-pins.txt")
    image_rows, image_floats, image_problems = read_manifest(
        root / "container" / "build" / "image-pins.txt",
    )
    problems += image_problems
    rows = host_rows + image_rows
    floats = host_floats + image_floats
    problems += [problem for row in rows for problem in _row_problems(row)]

    scripts = {
        root / "bin" / "install.sh": (host_rows, host_floats),
        **dict.fromkeys(
            sorted((root / "container" / "build" / "fs").glob("*.sh")),
            (image_rows, image_floats),
        ),
        root / "container" / "build" / "Containerfile": ([], image_floats),
        **dict.fromkeys(extra_scripts, (rows, floats)),
    }
    used: set[tuple[Path, str]] = set()
    read: set[tuple[Path, str]] = set()

    for path, (readable, declared) in scripts.items():
        names = {row.name for row in readable}

        for number, code in _logical_lines(path):
            covering = [(f.manifest, f.name) for f in declared if f.source in code]
            used.update(covering)

            for call in PINNED_CALL.findall(code):
                name = call.strip("'\"")

                if name not in names:
                    problems.append(f"{path}:{number}: no manifest row named {call}")

                read.update((row.manifest, row.name) for row in readable if row.name == name)

            if (
                DOWNLOADS.search(code)
                and not covering
                and not PINNED_CALL.search(code)
                and "@sha256:" not in code
            ):
                problems.append(
                    f"{path}:{number}: downloads without a pin or a float declaration: {code.strip()}",
                )

    problems += [
        f"{f.manifest}:{f.line}: float {f.name} - no script uses {f.source}"
        for f in floats
        if (f.manifest, f.name) not in used
    ]
    unread: dict[tuple[Path, str], Row] = {}

    for row in rows:
        if (row.manifest, row.name) not in read:
            unread.setdefault((row.manifest, row.name), row)

    problems += [
        f"{row.manifest}:{row.line}: {row.name}: no script reads this row"
        for row in unread.values()
    ]
    problems += _base_image_problems(root / "container" / "build" / "Containerfile")
    problems += _node_problems(rows, root / ".nvmrc")

    return problems


def bump(name: str, version: str) -> int:
    """Set `name` to `version` in every manifest row, record each download's digest, and print the diff."""

    if name == BASE_IMAGE:
        return _bump_base_image(version)

    if not EXACT_VERSION.fullmatch(version):
        print(f"error: {name} {version}: not an exact version", file=sys.stderr)

        return 1

    changed: dict[Path, tuple[str, str]] = {}

    for path in (HOST_MANIFEST, IMAGE_MANIFEST):
        rows, _, _ = read_manifest(path)
        before = path.read_text(encoding="utf-8")
        lines = before.splitlines(keepends=True)

        for row in (r for r in rows if r.name == name):
            new = replace(row, version=version)

            if new.url != "-":
                try:
                    new = replace(
                        new,
                        sha256=hashlib.sha256(_download(new.resolved_url())).hexdigest(),
                    )
                except OSError as exc:
                    print(f"error: {name} {version}: {new.resolved_url()}: {exc}", file=sys.stderr)

                    return 1

            lines[row.line - 1] = _render(new)

        if (after := "".join(lines)) != before:
            changed[path] = (before, after)

    if not changed:
        print(f"error: no manifest row named {name}", file=sys.stderr)

        return 1

    for path, (before, after) in changed.items():
        path.write_text(after, encoding="utf-8")
        sys.stdout.writelines(
            difflib.unified_diff(
                before.splitlines(True),
                after.splitlines(True),
                str(path),
                str(path),
            ),
        )

    return 0


def main() -> int:
    """`check` or `bump NAME VERSION`."""

    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "check",
        help="offline: every manifest row well formed, every download pinned",
    )
    bumping = commands.add_parser(
        "bump",
        help="network: set a pin's version and record its digests",
    )
    bumping.add_argument("name")
    bumping.add_argument("version")
    args = parser.parse_args()

    if args.command == "bump":
        return bump(args.name, args.version)

    problems = check()

    for problem in problems:
        print(problem)

    print(f"pins: {len(problems)} problem(s)")

    return 1 if problems else 0


def _logical_lines(path: Path) -> list[tuple[int, str]]:
    # Continuations join into the line they start on; comments and the pin readers' own bodies are skipped.
    lines: list[tuple[int, str]] = []
    pending: tuple[int, str] | None = None
    in_reader = False

    for number, text in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if PIN_READER.match(text):
            in_reader = True
        elif in_reader:
            in_reader = text != "}"
            continue

        code = "" if text.lstrip().startswith("#") else text
        start, joined = pending or (number, "")
        joined += code.rstrip("\\") + " "

        if code.rstrip().endswith("\\"):
            pending = (start, joined)
        else:
            lines.append((start, joined))
            pending = None

    return lines


def _row_problems(row: Row) -> list[str]:
    where = f"{row.manifest}:{row.line}: {row.name}"
    problems = []

    if not EXACT_VERSION.fullmatch(row.version):
        problems.append(f"{where}: version {row.version} is not exact")

    if row.platform not in PLATFORMS:
        problems.append(f"{where}: unknown platform {row.platform}")

    if row.platform == "-":
        if (row.sha256, row.url) != ("-", "-"):
            problems.append(f"{where}: a version-only pin carries no digest and no URL")
    elif not re.fullmatch(r"[0-9a-f]{64}", row.sha256):
        problems.append(f"{where}: a download needs its sha256")
    elif not row.url.startswith("https://"):
        problems.append(f"{where}: a download needs an https URL")

    return problems


def _base_image_problems(containerfile: Path) -> list[str]:
    froms = [
        line
        for line in containerfile.read_text(encoding="utf-8").splitlines()
        if line.startswith("FROM")
    ]

    return [
        f"{containerfile}: base image {line} is not pinned by digest"
        for line in froms
        if not BASE_FROM.match(line)
    ]


def _node_problems(rows: list[Row], nvmrc: Path) -> list[str]:
    major = nvmrc.read_text(encoding="utf-8").strip().lstrip("v").split(".")[0]

    return [
        f"{row.manifest}:{row.line}: node {row.version} is not on the .nvmrc major v{major}"
        for row in rows
        if row.name == "node" and row.version.split(".")[0] != major
    ]


def _render(row: Row) -> str:
    return f"{row.name:<12} {row.version:<11} {row.platform:<13} {row.sha256}  {row.url}\n"


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def _bump_base_image(tag: str) -> int:
    token_url = "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/ubuntu:pull"
    token = json.loads(_download(token_url))["token"]
    request = urllib.request.Request(
        f"https://registry-1.docker.io/v2/library/ubuntu/manifests/{tag}",
        method="HEAD",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            digest = response.headers["Docker-Content-Digest"]
    except OSError as exc:
        print(f"error: {BASE_IMAGE} {tag}: {exc}", file=sys.stderr)

        return 1

    before = CONTAINERFILE.read_text(encoding="utf-8")
    after = re.sub(
        r"^FROM\s+\S+$",
        f"FROM {BASE_REPOSITORY}:{tag}@{digest}",
        before,
        count=1,
        flags=re.MULTILINE,
    )
    CONTAINERFILE.write_text(after, encoding="utf-8")
    sys.stdout.writelines(
        difflib.unified_diff(
            before.splitlines(True),
            after.splitlines(True),
            str(CONTAINERFILE),
            str(CONTAINERFILE),
        ),
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
