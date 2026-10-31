"""Bash command layout for display - one command per line, bodies indented, long chains broken."""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass

import tree_sitter_bash
from tree_sitter import Language, Node, Parser


_PARSER = Parser(Language(tree_sitter_bash.language()))

_CHAIN_WIDTH = 120
_INDENT = b"  "

_OPAQUE = frozenset(
    {
        "ansi_c_string",
        "arithmetic_expansion",
        "command_substitution",
        "expansion",
        "heredoc_body",
        "process_substitution",
        "raw_string",
        "string",
        "test_command",
        "translated_string",
    },
)
_CHAIN_OPERATORS = frozenset({"&&", "||", "|", "|&"})
_CHAIN_PARENTS = frozenset({"list", "pipeline", "heredoc_redirect"})
_CASE_TERMINATORS = frozenset({";;", ";&", ";;&"})
_GROUP_OPENERS = frozenset({"{", "("})
_IF_CLOSERS = frozenset({"elif_clause", "else_clause", "fi"})
_CLAUSE_OPENERS = {"elif_clause": "then", "else_clause": "else"}
_LOOPS = frozenset(
    {"for_statement", "c_style_for_statement", "while_statement", "select_statement"},
)
_RESERVED = frozenset({"do", "done", "then", "elif", "else", "fi", "esac", "{", "}"})
_TERMINATORS = b";&\n"

_GAP = re.compile(rb"[ \t]*;?[ \t]*")
_LEADING_OPERATOR = re.compile(rb"[ \t]*(?:&&|\|\||\|)")


def layout_bash_command(command: object) -> str | None:
    r"""Return `command` laid out for reading, or None when nothing changes or it is not shell.

    Only the gaps between tokens change: a `;` between commands becomes a line break, loop, `if`,
    `case` and group bodies move beneath their opening line, and a line over 120 characters breaks
    before each `&&`, `||` and `|` with a ` \` continuation. A gap holding a line break is kept.
    """

    if not isinstance(command, str):
        return None

    try:
        source = command.encode()
    except UnicodeEncodeError:
        return None

    tree = _PARSER.parse(source)

    if tree.root_node.has_error:
        return None

    try:
        breaks, operators = _collect(tree.root_node, source)
    except _Misread:
        return None

    rendered, positions = _render(source, breaks, [start for _, start in operators])
    laid_out = _break_long_chains(rendered, operators, positions).decode()

    return laid_out if laid_out != command else None


@dataclass(frozen=True)
class _Run:
    units: list[Node]
    opener: Node | None
    closer: Node | None
    anchor: Node
    closer_anchor: Node
    closer_at_body_indent: bool = False


@dataclass(frozen=True)
class _Break:
    start: int
    end: int
    anchor: int
    extra: bytes


class _Misread(Exception):
    pass


def _collect(root: Node, source: bytes) -> tuple[list[_Break], list[tuple[int, int]]]:
    breaks: list[_Break] = []
    operators: list[tuple[int, int]] = []
    heredocs: list[tuple[int, int]] = []
    stack: list[tuple[Node, Node | None]] = [(root, None)]

    while stack:
        node, parent = stack.pop()

        if node.type in _OPAQUE:
            continue

        if node.type == "heredoc_redirect":
            heredocs.extend(_pending_heredoc(node))

        if node.type in _CHAIN_PARENTS:
            operators.extend(
                (_end_before(operator), operator.start_byte)
                for operator in node.children
                if operator.type in _CHAIN_OPERATORS
            )
        elif node.type == "command_name" and _text(node, source) in _RESERVED:
            raise _Misread

        for run in _runs(node, parent, source):
            breaks.extend(_run_breaks(run, source))

        stack.extend((child, node) for child in node.children)

    # A line break between `<<` and its body would move the rest of that line into the body.
    safe = [
        b for b in breaks if not any(b.start < end and b.end > start for start, end in heredocs)
    ]

    return sorted(safe, key=lambda b: b.start), sorted(operators, key=lambda o: o[1])


def _pending_heredoc(redirect: Node) -> list[tuple[int, int]]:
    starts = [c for c in redirect.children if c.type == "heredoc_start"]
    bodies = [c for c in redirect.children if c.type == "heredoc_body"]

    return [(starts[0].end_byte, bodies[0].start_byte)] if starts and bodies else []


def _runs(node: Node, parent: Node | None, source: bytes) -> list[_Run]:
    kids = node.children
    types = [c.type for c in kids]

    if (
        node.type == "subshell"
        and b"((" in source[max(node.start_byte - 1, 0) : node.start_byte + 2]
    ):
        raise _Misread

    if node.type == "program":
        return [_Run(kids, None, None, node, node)]
    elif node.type == "do_group":
        anchor = parent if parent is not None and parent.type in _LOOPS else node

        return [_Run(kids[1:-1], kids[0], kids[-1], anchor, anchor)]
    elif node.type in ("compound_statement", "subshell") and types[0] in _GROUP_OPENERS:
        anchor = parent if parent is not None and parent.type == "function_definition" else node

        return [_Run(kids[1:-1], kids[0], kids[-1], anchor, anchor)]
    elif node.type == "if_statement":
        return _if_runs(node, kids, types)
    elif node.type == "case_statement" and "in" in types and "esac" in types:
        open_at, close = types.index("in"), types.index("esac")
        items = kids[open_at + 1 : close]

        return [_Run(items, kids[open_at], kids[close], node, node)]
    elif node.type == "case_item" and ")" in types:
        open_at = types.index(")")
        close = next(
            (i for i in range(open_at + 1, len(kids)) if types[i] in _CASE_TERMINATORS),
            None,
        )
        units = kids[open_at + 1 : close]
        closer = None if close is None else kids[close]

        return [_Run(units, kids[open_at], closer, node, node, closer_at_body_indent=True)]
    else:
        return []


def _if_runs(node: Node, kids: list[Node], types: list[str]) -> list[_Run]:
    closers = [i for i, kind in enumerate(types) if kind in _IF_CLOSERS]
    then = types.index("then")
    runs = [_Run(kids[then + 1 : closers[0]], kids[then], kids[closers[0]], node, node)]

    for at, close in itertools.pairwise(closers):
        clause = kids[at].children
        opens = [i for i, c in enumerate(clause) if c.type == _CLAUSE_OPENERS[types[at]]]

        if opens:
            body = clause[opens[0] + 1 :]
            runs.append(_Run(body, clause[opens[0]], kids[close], kids[at], node))

    return runs


def _run_breaks(run: _Run, source: bytes) -> list[_Break]:
    units = run.units
    statements = [u for u in units if _is_statement(u)]

    if not statements:
        return []

    breaks: list[_Break] = []

    def add(start: int, end: int, anchor: Node, extra: bytes) -> None:
        if (
            start <= end
            and source[start - 1 : start] != b"\n"
            and _GAP.fullmatch(source, start, end)
        ):
            breaks.append(_Break(start, end, anchor.start_byte, extra))

    if _glued(run.opener, source) or _unterminated(run.closer, source):
        raise _Misread

    if run.opener is not None and units[0].type != "comment":
        add(run.opener.end_byte, units[0].start_byte, run.anchor, _INDENT)

    for before, after in itertools.pairwise(units):
        if before.type == after.type == "case_item":
            add(before.end_byte, after.start_byte, before, b"")

    for before, separator, after in zip(units, units[1:], units[2:], strict=False):
        if separator.type == ";" and _is_statement(before) and _is_statement(after):
            add(before.end_byte, after.start_byte, before, b"")

    last, last_statement = units[-1], statements[-1]

    if run.closer is None or last.type == "comment":
        return breaks

    dropped = last.type == ";" and len(units) > 1 and units[-2] == last_statement
    start = last_statement.end_byte if dropped else last.end_byte
    anchor = last_statement if run.closer_at_body_indent else run.closer_anchor
    add(start, run.closer.start_byte, anchor, b"")

    return breaks


def _is_statement(node: Node) -> bool:
    return node.is_named and node.type != "comment"


def _text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode()


def _end_before(node: Node) -> int:
    current: Node | None = node

    while current is not None:
        before = current.prev_sibling

        if before is not None:
            return before.end_byte

        current = current.parent

    return 0


def _glued(opener: Node | None, source: bytes) -> bool:
    return (
        opener is not None
        and opener.type in _RESERVED
        and source[opener.end_byte : opener.end_byte + 1] not in (b" ", b"\t", b"\n")
    )


def _unterminated(closer: Node | None, source: bytes) -> bool:
    return (
        closer is not None
        and closer.type in _RESERVED | _IF_CLOSERS
        and source[: closer.start_byte].rstrip(b" \t")[-1:] not in _TERMINATORS
    )


def _render(
    source: bytes,
    breaks: list[_Break],
    operators: list[int],
) -> tuple[bytes, dict[int, int]]:
    out = bytearray()
    indents: dict[int, bytes] = {}
    positions: dict[int, int] = {}
    anchors = iter(sorted({b.anchor for b in breaks} | set(operators)))
    anchor = next(anchors, None)
    pos = 0

    for brk in [*breaks, None]:
        end = len(source) if brk is None else brk.start

        while anchor is not None and anchor < end:
            indents[anchor] = _line_indent(out, source, pos, anchor)
            positions[anchor] = len(out) + anchor - pos
            anchor = next(anchors, None)

        out += source[pos:end]

        if brk is None:
            break

        out += b"\n" + indents[brk.anchor] + brk.extra
        pos = brk.end

    return bytes(out), positions


def _line_indent(out: bytearray, source: bytes, pos: int, anchor: int) -> bytes:
    newline = source.rfind(b"\n", pos, anchor)
    line = (
        source[newline + 1 : anchor]
        if newline >= 0
        else out[out.rfind(b"\n") + 1 :] + source[pos:anchor]
    )

    return _leading_space(line)


def _break_long_chains(
    rendered: bytes,
    operators: list[tuple[int, int]],
    positions: dict[int, int],
) -> bytes:
    edits = []

    for gap_start, operator in operators:
        at = positions[operator]
        gap = rendered[at - (operator - gap_start) : at]

        if gap.strip(b" \t"):
            continue

        line_start = rendered.rfind(b"\n", 0, at) + 1
        line_end = rendered.find(b"\n", at)
        line = rendered[line_start : line_end if line_end >= 0 else len(rendered)]

        if len(line.decode()) <= _CHAIN_WIDTH:
            continue

        lead = _leading_space(line)
        indent = lead if _LEADING_OPERATOR.match(line) else lead + _INDENT
        # Safe before a pending heredoc body: bash reads the body after the logical line.
        edits.append((at - (operator - gap_start), at, b" \\\n" + indent))

    for start, end, text in sorted(edits, reverse=True):
        rendered = rendered[:start] + text + rendered[end:]

    return rendered


def _leading_space(line: bytes | bytearray) -> bytes:
    return bytes(line[: len(line) - len(line.lstrip(b" \t"))])
