"""Whether a Bash command changes nothing - an allowlist walk over its tree-sitter-bash parse."""

from __future__ import annotations

import itertools
import re
from collections.abc import Callable

import tree_sitter_bash
from tree_sitter import Language, Node, Parser


_PARSER = Parser(Language(tree_sitter_bash.language()))

_LOWERCASE_NAME = re.compile(r"[a-z_][a-z0-9_]*")
_UNESCAPED_NEWLINE = re.compile(rb"(?<!\\)\n")
_GLOB = re.compile(r"[*?\[{}]")
_BLANK_OR_GLOB = re.compile(r"[\s*?\[{}]")

_STRUCTURE = (
    frozenset({"program", "list", "pipeline", "negated_command", "subshell"})
    | frozenset({"redirected_statement", "if_statement", "elif_clause", "else_clause"})
    | frozenset({"case_statement", "case_item", "while_statement", "do_group"})
    | frozenset({"comment"})
)
_VALUES = (
    frozenset({"word", "string", "raw_string", "string_content", "concatenation"})
    | frozenset({"simple_expansion", "number", "variable_name", "special_variable_name"})
    | frozenset({"extglob_pattern", "regex", "ansi_c_string", "translated_string", "test_operator"})
    | frozenset({"unary_expression", "binary_expression", "parenthesized_expression"})
)
_TOKENS = (
    frozenset({";", "&&", "||", "|", "|&", "!", "(", ")", "{", "}", "if", "then", "elif", "else"})
    | frozenset({"fi", "case", "in", "esac", ";;", ";&", ";;&", "for", "while", "until", "do"})
    | frozenset({"done", "[", "]", "[[", "]]", "$(", "`", "<(", "$", "${", '"', "="})
)
_TEST_TOKENS = frozenset({"==", "=", "!=", "=~", "<", ">", "&&", "||", "!", "(", ")", "-a", "-o"})
_EXPANSION_OPERATORS = frozenset(
    {":-", "-", "#", "##", "%", "%%", "/", "//", "/#", "/%", ":", "^", "^^", ",", ",,"},
) | frozenset({":+", "+", "!", "?", ":?"})
_TO_DEV_NULL = frozenset({">", ">>", "&>", "&>>", ">|"})
_DUPLICATE = frozenset({">&", "<&"})

_ANYTHING = (
    frozenset({"cd", "pwd", "echo", "true", "false", ":", "exit", "sleep", "type"})
    | frozenset({"continue", "break", "ls", "cat", "head", "tail", "wc", "stat", "du", "df"})
    | frozenset({"realpath", "readlink", "basename", "dirname", "nl", "tac", "rev", "od"})
    | frozenset({"hexdump", "strings", "md5sum", "sha1sum", "sha256sum", "sha512sum", "cksum"})
    | frozenset({"b2sum", "base64", "diff", "cmp", "comm", "which", "grep", "egrep", "fgrep"})
    | frozenset({"cut", "tr", "paste", "join", "fold", "column", "expand", "unexpand", "seq", "jq"})
    | frozenset({"uname", "whoami", "id", "groups", "printenv", "nproc", "uptime", "free", "ps"})
    | frozenset({"pgrep"})
)

_SED_FLAGS = frozenset("nErsuz")
_SED_LONG = frozenset({"--quiet", "--silent", "--regexp-extended", "--separate"}) | frozenset(
    {"--unbuffered", "--null-data"},
)
_SED_COMMANDS = frozenset("pdqQ=nNPDlhHgGxz{}")
_SED_S_FLAGS = frozenset("gpiImM0123456789")
_AWK_FORBIDDEN = ("system", "getline", "close", "fflush", "@", "|&")
_AWK_PRINT = re.compile(r"\bprintf?\b([^;}\n]*)")
_AWK_STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')
_ARITHMETIC_TESTS = frozenset({"-eq", "-ne", "-lt", "-le", "-gt", "-ge"})
_INTEGER = re.compile(r"-?[0-9]+")
# bfs, which Claude Code's shell runs as find, deletes on -rm.
_FIND_ACTIONS = frozenset({"-exec", "-execdir", "-ok", "-okdir", "-delete", "-rm"}) | frozenset(
    {"-fprint", "-fprint0", "-fprintf", "-fls"},
)
_HOSTNAME_FLAGS = (
    frozenset({"-s", "-f", "-i", "-I", "-d", "-a", "-A", "-y", "--short", "--fqdn", "--long"})
    | frozenset({"--ip-address", "--all-ip-addresses", "--domain", "--alias", "--all-fqdns"})
    | frozenset({"--yp", "--nis"})
)


def is_read_only_command(command: object) -> bool:
    """Whether `command` changes nothing: it writes no file, reaches no network and runs no program.

    Every node, redirect and command name must be one the walk knows, and a restricted command's
    arguments must be known when the command is read; anything else counts as changing something.
    """

    if not isinstance(command, str):
        return False

    try:
        source = command.encode()
    except UnicodeEncodeError:
        return False

    tree = _PARSER.parse(source)

    if not command.strip() or tree.root_node.has_error:
        return False

    try:
        _Walk(source, tree.root_node).node(tree.root_node)
    except _Changes:
        return False

    return True


class _Changes(Exception):
    pass


class _Walk:
    def __init__(self, source: bytes, root: Node):
        self._source = source
        self._known = _set_once_to_literal(root, source)

    def node(self, node: Node) -> None:
        kind = node.type

        if not node.is_named:
            _require(kind in _TOKENS)
        elif kind in _STRUCTURE or kind in _VALUES:
            self.children(node)
        elif kind == "compound_statement":
            _require(node.children[0].type == "{")
            self.children(node)
        elif kind == "command":
            self._command(node)
        elif kind == "variable_assignment":
            self._assignment(node)
        elif kind == "test_command":
            self._test(node)
        elif kind == "expansion":
            self._expansion(node)
        elif kind in ("command_substitution", "process_substitution"):
            _require(node.children[0].type in ("$(", "`", "<("))
            self.children(node)
        elif kind == "file_redirect":
            self._redirect(node)
        elif kind == "for_statement":
            self._for(node)
        else:
            raise _Changes

    def children(self, node: Node) -> None:
        for child in node.children:
            self.node(child)

    def _command(self, node: Node) -> None:
        _require(
            not any(
                _UNESCAPED_NEWLINE.search(self._gap(a, b))
                for a, b in itertools.pairwise(node.children)
            ),
        )

        name_node = node.child_by_field_name("name")

        if name_node is None or [c.type for c in name_node.children] != ["word"]:
            raise _Changes

        name = self._text(name_node)
        checker = _RESTRICTED.get(name)
        _require(name in _ANYTHING or checker is not None)

        arguments = node.children_by_field_name("argument")

        for child in node.children:
            if child.type == "variable_assignment":
                self._assignment(child)
            elif child != name_node:
                self.node(child)

        if checker is not None:
            values = [self._value(argument) for argument in arguments]
            known = [value for value in values if value is not None]
            _require(len(known) == len(values) and checker(known))

    def _assignment(self, node: Node) -> None:
        name = node.child_by_field_name("name")

        if name is None or not _LOWERCASE_NAME.fullmatch(self._text(name)):
            raise _Changes

        for child in node.children:
            if child != name:
                _require(child.type != "array")
                self.node(child)

    def _test(self, node: Node) -> None:
        single = node.children[0].type == "["

        def visit(child: Node) -> None:
            if child.is_named:
                if child.type == "test_operator":
                    _require(self._text(child) not in ("-v", "-R"))

                if child.type == "binary_expression" and not single:
                    self._integer_operands(child)

                if child.type in (
                    "unary_expression",
                    "binary_expression",
                    "parenthesized_expression",
                ):
                    for grandchild in child.children:
                        visit(grandchild)
                else:
                    self.node(child)
            else:
                _require(child.type in _TOKENS or child.type in _TEST_TOKENS)
                _require(not (single and child.type == ">"))

        for child in node.children:
            visit(child)

    def _integer_operands(self, node: Node) -> None:
        operator = next((c for c in node.children if c.type == "test_operator"), None)

        if operator is not None and self._text(operator) in _ARITHMETIC_TESTS:
            for operand in node.children:
                if operand != operator:
                    _require(
                        operand.type == "number"
                        or (operand.type == "word" and _INTEGER.fullmatch(self._text(operand))),
                    )

    def _expansion(self, node: Node) -> None:
        for i, child in enumerate(node.children):
            if node.field_name_for_child(i) == "operator":
                _require(child.type in _EXPANSION_OPERATORS)
            elif child.type in ("${", "}"):
                continue
            else:
                self.node(child)

    def _redirect(self, node: Node) -> None:
        operator = next((c.type for c in node.children if not c.is_named), None)
        destinations = node.children_by_field_name("destination")
        _require(len(destinations) <= 1)
        destination = destinations[0] if destinations else None

        if operator == "<" and destination is not None:
            self.node(destination)
            source = self._value(destination)
            _require(source is not None and not source.startswith(("/dev/tcp/", "/dev/udp/")))
        elif operator in _TO_DEV_NULL:
            _require(destination is not None and self._text(destination) == "/dev/null")
        elif operator in _DUPLICATE:
            _require(destination is not None and destination.type == "number")
        else:
            _require(operator in (">&-", "<&-") and destination is None)

    def _for(self, node: Node) -> None:
        variable = node.child_by_field_name("variable")
        _require(variable is not None and _LOWERCASE_NAME.fullmatch(self._text(variable)))

        for child in node.children:
            if child != variable:
                self.node(child)

    def _value(self, node: Node, quoted: bool = False) -> str | None:
        kind = node.type
        text = self._text(node)

        if kind == "word":
            return None if not quoted and _GLOB.search(text) else text.replace("\\", "")
        elif kind == "number":
            return text
        elif kind == "raw_string":
            return text[1:-1]
        elif kind == "string_content":
            return text
        elif kind == "string":
            return _joined([self._value(c, quoted=True) for c in node.children if c.is_named])
        elif kind == "concatenation":
            return _joined([self._value(c, quoted) for c in node.children])
        elif kind in ("simple_expansion", "expansion"):
            return self._variable_value(node, quoted)
        else:
            return None

    def _variable_value(self, node: Node, quoted: bool) -> str | None:
        named = [c for c in node.children if c.is_named]

        if len(named) != 1 or named[0].type != "variable_name" or len(node.children) > 3:
            return None

        entry = self._known.get(self._text(named[0]))

        if entry is None or entry[0] > node.start_byte:
            return None

        value = entry[1]

        return None if not quoted and _BLANK_OR_GLOB.search(value) else value

    def _gap(self, before: Node, after: Node) -> bytes:
        return self._source[before.end_byte : after.start_byte]

    def _text(self, node: Node) -> str:
        return self._source[node.start_byte : node.end_byte].decode()


def _set_once_to_literal(root: Node, source: bytes) -> dict[str, tuple[int, str]]:
    counts: dict[str, int] = {}
    literals: dict[str, tuple[int, str]] = {}
    stack = [(root, True)]

    while stack:
        node, top = stack.pop()

        if node.type == "variable_assignment":
            name_node = node.child_by_field_name("name")
            name = source[name_node.start_byte : name_node.end_byte].decode() if name_node else ""
            counts[name] = counts.get(name, 0) + 1
            literal = _literal(node.child_by_field_name("value"), source)

            if top and literal is not None:
                literals[name] = (node.start_byte, literal)
        elif node.type == "for_statement":
            variable = node.child_by_field_name("variable")

            if variable is not None:
                name = source[variable.start_byte : variable.end_byte].decode()
                counts[name] = counts.get(name, 0) + 2
        elif node.type == "command":
            name_node = node.child_by_field_name("name")

            if (
                name_node is not None
                and source[name_node.start_byte : name_node.end_byte] == b"read"
            ):
                for argument in node.children_by_field_name("argument"):
                    name = source[argument.start_byte : argument.end_byte].decode()
                    counts[name] = counts.get(name, 0) + 2

        child_top = top and node.type in ("program", "list")
        stack.extend((child, child_top) for child in node.children)

    return {name: value for name, value in literals.items() if counts.get(name) == 1}


def _literal(node: Node | None, source: bytes) -> str | None:
    if node is None:
        return ""

    text = source[node.start_byte : node.end_byte].decode()

    plain_string = node.type == "string" and all(
        c.type == "string_content" or not c.is_named for c in node.children
    )

    if node.type in ("word", "number") and "$" not in text and "`" not in text:
        return text.replace("\\", "")
    elif node.type == "raw_string" or plain_string:
        return text[1:-1]
    else:
        return None


def _joined(parts: list[str | None]) -> str | None:
    values = [part for part in parts if part is not None]

    return "".join(values) if len(values) == len(parts) else None


def _require(condition: object) -> None:
    if not condition:
        raise _Changes


def _options(args: list[str], value_options: frozenset[str]) -> tuple[list[str], list[str]]:
    options: list[str] = []
    operands: list[str] = []
    rest = iter(args)

    for arg in rest:
        if arg == "--":
            operands.extend(rest)
        elif arg.startswith("-") and arg != "-":
            options.append(arg)

            if arg in value_options:
                next(rest, None)
        else:
            operands.append(arg)

    return options, operands


def _printf(args: list[str]) -> bool:
    return bool(args) and args[0] != "-v"


def _command_lookup(args: list[str]) -> bool:
    flags = [a for a in args if a.startswith("-")]

    return bool(flags) and all(flag in ("-v", "-V") for flag in flags)


def _set(args: list[str]) -> bool:
    rest = iter(args)

    for arg in rest:
        if not re.fullmatch(r"[-+][a-zA-Z]+", arg):
            return False
        elif "o" in arg[1:]:
            option = next(rest, None)

            if option is None or not option.isalpha():
                return False

    return True


def _read(args: list[str]) -> bool:
    options, names = _options(args, frozenset({"-p", "-d", "-t", "-n", "-N", "-u", "-i"}))

    return (
        bool(names)
        and all(_LOWERCASE_NAME.fullmatch(name) for name in names)
        and not any("a" in option for option in options if not option.startswith("--"))
    )


def _test_args(args: list[str]) -> bool:
    return not any(arg in ("-v", "-R") for arg in args)


def _tree(args: list[str]) -> bool:
    return not any(_short_flag(arg, "oR") for arg in args)


def _xxd(args: list[str]) -> bool:
    values = frozenset({"-c", "-g", "-l", "-s", "-o", "-n", "-cols", "-groupsize", "-len", "-seek"})

    return len(_options(args, values)[1]) <= 1


def _rg(args: list[str]) -> bool:
    return not any(
        arg in ("-z", "--search-zip", "--pre", "--hostname-bin")
        or arg.startswith(("--pre=", "--hostname-bin="))
        or (re.fullmatch(r"-[a-zA-Z]+", arg) and "z" in arg)
        for arg in args
    )


def _find(args: list[str]) -> bool:
    return not any(arg in _FIND_ACTIONS for arg in args)


def _fd(args: list[str]) -> bool:
    return not any(
        arg in ("--exec", "--exec-batch")
        or arg.startswith(("--exec=", "--exec-batch="))
        or (re.fullmatch(r"-[a-zA-Z]+", arg) and ("x" in arg or "X" in arg))
        for arg in args
    )


def _uniq(args: list[str]) -> bool:
    return len(_options(args, frozenset({"-f", "-s", "-w"}))[1]) <= 1


def _sed(args: list[str]) -> bool:
    scripts: list[str] = []
    operands: list[str] = []
    rest = iter(args)

    for arg in rest:
        if arg == "--":
            operands.extend(rest)
        elif arg == "-e":
            script = next(rest, None)

            if script is None:
                return False

            scripts.append(script)
        elif arg.startswith("--expression="):
            scripts.append(arg.split("=", 1)[1])
        elif arg.startswith("--"):
            if arg not in _SED_LONG:
                return False
        elif arg.startswith("-") and arg != "-":
            if not set(arg[1:]) <= _SED_FLAGS:
                return False
        else:
            operands.append(arg)

    if not scripts:
        if not operands:
            return False

        scripts.append(operands.pop(0))

    return all(_sed_script(script) for script in scripts)


def _sed_script(script: str) -> bool:
    i, n = 0, len(script)

    while i < n:
        while i < n and script[i] in " \t\n;":
            i += 1

        if i >= n:
            break

        i = _sed_address(script, i)

        if i < 0:
            return False

        if i < n and script[i] == ",":
            i = _sed_address(script, i + 1, second=True)

            if i < 0:
                return False

        while i < n and script[i] in " \t":
            i += 1

        if i < n and script[i] == "!":
            i += 1

            while i < n and script[i] in " \t":
                i += 1

        if i >= n:
            return False

        i = _sed_command(script, i)

        if i < 0:
            return False

        while i < n and script[i] in " \t":
            i += 1

        if i < n and script[i] not in ";\n}":
            return False

    return True


def _sed_address(script: str, i: int, second: bool = False) -> int:
    n = len(script)

    if i < n and script[i] == "$":
        return i + 1
    elif i < n and script[i] == "/":
        return _sed_delimited(script, i + 1, "/")
    elif i + 1 < n and script[i] == "\\":
        return _sed_delimited(script, i + 2, script[i + 1])
    elif second and i < n and script[i] in "+~":
        i += 1
    elif not (i < n and script[i].isdigit()):
        return -1 if second else i

    start = i

    while i < n and script[i].isdigit():
        i += 1

    if i < n and script[i] == "~":
        i += 1

        while i < n and script[i].isdigit():
            i += 1

    return i if i > start else -1


def _sed_command(script: str, i: int) -> int:
    command = script[i]

    if command in _SED_COMMANDS:
        i += 1

        while command in "qQl" and i < len(script) and script[i].isdigit():
            i += 1

        return i
    elif command in "sy" and i + 1 < len(script) and script[i + 1] not in "\\\n":
        delimiter = script[i + 1]
        i = _sed_delimited(script, i + 2, delimiter)

        if i < 0:
            return -1

        i = _sed_delimited(script, i, delimiter)

        while command == "s" and 0 <= i < len(script) and script[i] in _SED_S_FLAGS:
            i += 1

        return i
    else:
        return -1


def _sed_delimited(script: str, i: int, delimiter: str) -> int:
    while i < len(script):
        if script[i] == "\\":
            i += 2
        elif script[i] == delimiter:
            return i + 1
        else:
            i += 1

    return -1


def _awk(args: list[str]) -> bool:
    rest = iter(args)
    program = None

    for arg in rest:
        if arg in ("-F", "-v"):
            if next(rest, None) is None:
                return False
        elif arg.startswith(("-F", "-v")) and len(arg) > 2:
            continue
        elif arg == "--":
            program = next(rest, None)
            break
        elif arg.startswith("-"):
            return False
        else:
            program = arg
            break

    if program is None or any(word in program for word in _AWK_FORBIDDEN):
        return False

    code = _AWK_STRING.sub('""', program)

    return not any(re.search(r"[>|/]", m.group(1)) for m in _AWK_PRINT.finditer(code))


def _date(args: list[str]) -> bool:
    options, operands = _options(args, frozenset({"-d", "--date", "-r", "--reference"}))

    return all(o in ("-u", "--utc", "-d", "--date", "-r", "--reference") for o in options) and all(
        operand.startswith("+") for operand in operands
    )


def _short_flag(arg: str, letters: str) -> bool:
    return bool(re.fullmatch(r"-[a-zA-Z0-9]+", arg)) and any(c in arg[1:] for c in letters)


def _hostname(args: list[str]) -> bool:
    return all(arg in _HOSTNAME_FLAGS for arg in args)


def _env(args: list[str]) -> bool:
    return not args


_RESTRICTED: dict[str, Callable[[list[str]], bool]] = {
    "test": _test_args,
    "[": _test_args,
    "printf": _printf,
    "command": _command_lookup,
    "set": _set,
    "read": _read,
    "tree": _tree,
    "xxd": _xxd,
    "rg": _rg,
    "find": _find,
    "fd": _fd,
    "uniq": _uniq,
    "sed": _sed,
    "awk": _awk,
    "gawk": _awk,
    "mawk": _awk,
    "date": _date,
    "hostname": _hostname,
    "env": _env,
}
