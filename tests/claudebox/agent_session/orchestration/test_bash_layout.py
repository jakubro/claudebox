"""Tests for claudebox.agent_session.orchestration.bash_layout - laying out a Bash command."""

from __future__ import annotations

import pytest

from claudebox.agent_session.orchestration.bash_layout import layout_bash_command


LONG_CHAIN = (
    "cd /tmp && printf '%s\\n' alpha-first-entry-of-the-list beta-second-entry-of-the-list "
    "gamma-third-entry-of-the-list | sort -r | head -n 2"
)
LOOP_WITH_LONG_PIPELINE = (
    "for d in logs archive; do cd \"$d\"; find . -name '*.log' -newer last-run.stamp -print0 "
    "| xargs -0 grep -l 'timeout exceeded' | sort | head -n 20 | tee found.txt; done"
)


@pytest.mark.parametrize(
    ("command", "laid_out"),
    [
        pytest.param(
            "cd /srv/app; cat VERSION; echo ---; git log --oneline -5 | cat",
            "cd /srv/app\ncat VERSION\necho ---\ngit log --oneline -5 | cat",
            id="semicolons",
        ),
        pytest.param(
            LONG_CHAIN,
            "cd /tmp \\\n"
            "  && printf '%s\\n' alpha-first-entry-of-the-list beta-second-entry-of-the-list "
            "gamma-third-entry-of-the-list \\\n"
            "  | sort -r \\\n"
            "  | head -n 2",
            id="long-chain",
        ),
        pytest.param(
            "for f in a b; do echo $f; done",
            "for f in a b; do\n  echo $f\ndone",
            id="loop",
        ),
        pytest.param(
            "if [ -f x ]; then cat x; else echo none; fi",
            "if [ -f x ]; then\n  cat x\nelse\n  echo none\nfi",
            id="if-else",
        ),
        pytest.param(
            "if [ -d a ]; then ls a; elif [ -d b ]; then ls b; fi",
            "if [ -d a ]; then\n  ls a\nelif [ -d b ]; then\n  ls b\nfi",
            id="elif",
        ),
        pytest.param(
            "case $mode in fast) make -j8;; slow|safe) make clean; make;; esac",
            "case $mode in\n  fast)\n    make -j8\n    ;;\n  slow|safe)\n    make clean\n    make\n"
            "    ;;\nesac",
            id="case",
        ),
        pytest.param(
            "for a in x y; do for b in 1 2; do echo $a$b; done; done",
            "for a in x y; do\n  for b in 1 2; do\n    echo $a$b\n  done\ndone",
            id="nested-loops",
        ),
        pytest.param(
            'ls | while read f; do echo "$f"; done',
            'ls | while read f; do\n  echo "$f"\ndone',
            id="loop-in-pipeline",
        ),
        pytest.param(
            "{ sleep 1 & }",
            "{\n  sleep 1 &\n}",
            id="group-ending-in-background",
        ),
        pytest.param(
            "greet() { echo hi; echo there; }",
            "greet() {\n  echo hi\n  echo there\n}",
            id="function",
        ),
        pytest.param(
            "(cd build; make)",
            "(\n  cd build\n  make\n)",
            id="subshell",
        ),
        pytest.param(
            "(( count++ )); echo $count",
            "(( count++ ))\necho $count",
            id="arithmetic-is-not-a-group",
        ),
        pytest.param(
            "make; # builds everything\nmake test; make lint",
            "make; # builds everything\nmake test\nmake lint",
            id="no-break-before-a-comment",
        ),
        pytest.param(
            'out=$(date; uptime); echo "$out; done"',
            'out=$(date; uptime)\necho "$out; done"',
            id="substitution-and-string-kept",
        ),
        pytest.param(
            'for f in *.txt; do\n    wc -l "$f"; head -1 "$f"\ndone',
            'for f in *.txt; do\n    wc -l "$f"\n    head -1 "$f"\ndone',
            id="aligns-with-the-agents-own-indent",
        ),
        pytest.param(
            "echo 'left | right' && count=$(ls -1 /var/log | wc -l) && printf 'there are %s files "
            'in the directory listing right now\\n\' "$count"',
            "echo 'left | right' \\\n  && count=$(ls -1 /var/log | wc -l) \\\n  && printf 'there are "
            '%s files in the directory listing right now\\n\' "$count"',
            id="quoted-and-substituted-operators-kept",
        ),
        pytest.param(
            "cd /srv/app \\\n  && grep -rn --include='*.py' 'DEFAULT_TIMEOUT' src/ tests/ scripts/ "
            "tools/ docs/ examples/ fixtures/ benchmarks/ | sort | uniq -c",
            "cd /srv/app \\\n  && grep -rn --include='*.py' 'DEFAULT_TIMEOUT' src/ tests/ scripts/ "
            "tools/ docs/ examples/ fixtures/ benchmarks/ \\\n  | sort \\\n  | uniq -c",
            id="continues-an-agent-written-chain",
        ),
        pytest.param(
            LOOP_WITH_LONG_PIPELINE,
            "for d in logs archive; do\n  cd \"$d\"\n  find . -name '*.log' -newer last-run.stamp "
            "-print0 \\\n    | xargs -0 grep -l 'timeout exceeded' \\\n    | sort \\\n    | head -n 20 "
            "\\\n    | tee found.txt\ndone",
            id="long-chain-in-a-body",
        ),
        pytest.param(
            "cat <<'EOF' | grep -v '^#' | sed -e 's/alpha/omega/g' -e 's/beta/delta/g' | sort --unique "
            "--reverse | head -n 40 | tee out.txt\nalpha; beta\nEOF",
            "cat <<'EOF' \\\n  | grep -v '^#' \\\n  | sed -e 's/alpha/omega/g' -e 's/beta/delta/g' \\\n"
            "  | sort --unique --reverse \\\n  | head -n 40 \\\n  | tee out.txt\nalpha; beta\nEOF",
            id="long-chain-before-a-heredoc-body",
        ),
        pytest.param(
            "while read l; do echo $l; done <<EOF\nbody line\nEOF",
            "while read l; do\n  echo $l\ndone <<EOF\nbody line\nEOF",
            id="loop-reading-a-heredoc",
        ),
        pytest.param("( (a; b) )", "(\n  (\n    a\n    b\n  )\n)", id="spaced-nested-subshells"),
        pytest.param("echo é; echo ü", "echo é\necho ü", id="non-ascii"),
    ],
)
def test_lays_out(command, laid_out):
    assert layout_bash_command(command) == laid_out


@pytest.mark.parametrize(
    "command",
    [
        pytest.param("cd src && make check 2>&1 | tail -20", id="short-chain"),
        pytest.param("rg --hidden " + "--glob '!vendor/' " * 20 + "TODO", id="one-long-command"),
        pytest.param("cat > notes.txt <<'EOF'\nfirst; second\n  indented\nEOF", id="heredoc-body"),
        pytest.param(
            "cat <<EOF | while read l; do echo $l; done\nbody line\nEOF",
            id="heredoc-pending",
        ),
        pytest.param("cd /tmp/project \\\n  && grep -rn 'MODEL' lib/", id="agent-line-breaks"),
        pytest.param("sleep 5 & tail -f log.txt", id="background-separator"),
        pytest.param("echo " + "é" * 55 + " && echo " + "ü" * 50, id="width-counts-characters"),
        pytest.param('echo "unterminated', id="unreadable"),
        pytest.param("if ! ((x > 3)); then echo y; fi", id="arithmetic-read-as-subshells"),
        pytest.param(
            "! for ((i=0;i<3;i++)); do echo $i; done",
            id="arithmetic-for-read-as-subshells",
        ),
        pytest.param("case x in a) echo esac;; esac", id="reserved-word-as-an-argument"),
        pytest.param("case x in a) b esac", id="closer-without-a-terminator"),
        pytest.param("{echo;}", id="brace-glued-to-a-word"),
        pytest.param("for x in a; do{ echo; }; done", id="keyword-glued-to-a-brace"),
        pytest.param("time { a; b; }", id="group-read-as-words"),
        pytest.param("case $v in\n  a)\n    x\nesac", id="already-laid-out-case"),
        pytest.param("printf %s a\\\t && echo " + "y" * 110, id="escaped-blank-before-an-operator"),
        pytest.param("if true; then echo", id="unfinished"),
        pytest.param("\ud800; ls", id="not-utf8"),
        pytest.param("", id="empty"),
        pytest.param(None, id="none"),
        pytest.param(42, id="not-a-string"),
    ],
)
def test_shown_as_sent(command):
    assert layout_bash_command(command) is None
