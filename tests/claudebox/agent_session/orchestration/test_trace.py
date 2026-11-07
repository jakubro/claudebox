"""Tests for the container's syscall supervisor and the pipeline's client of it."""

from __future__ import annotations

import asyncio
import ctypes
import importlib.machinery
import importlib.util
import json
import os
import queue
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from claudebox.agent_session.orchestration import trace as trace_client
from claudebox.agent_session.orchestration.trace import TraceClient


SUPERVISOR = Path(__file__).parents[4] / "container/run/fs/root/.local/bin/claudebox-trace"


def _load_supervisor():
    loader = importlib.machinery.SourceFileLoader("claudebox_trace", str(SUPERVISOR))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[loader.name] = module
    loader.exec_module(module)

    return module


trace = _load_supervisor()

X86_64 = 0xC000003E
I386 = 0x40000003
ALLOW = "allow"
NOTIFY = "notify"

# x86-64 syscall numbers, from the kernel's own table rather than the supervisor's.
READ, WRITE, OPEN, GETPID, CONNECT, EXECVE, KILL = 0, 1, 2, 39, 42, 59, 62
UNLINK, CHMOD, PTRACE, UNLINKAT, OPENAT, LCHOWN = 87, 90, 101, 263, 257, 94
SOCKET, SETSID = 41, 112

AGENT = trace.Proc(pid=500, start=1000, ppid=100, pgrp=1, sid=1, state="S")
CLAUDE_SHELL = trace.Proc(pid=600, start=4600, ppid=500, pgrp=600, sid=600, state="S")
CHILD = trace.Proc(pid=601, start=4601, ppid=600, pgrp=600, sid=600, state="S")


class TestFilterProgram:
    """The BPF program, run on a small interpreter: which syscalls stop for the supervisor."""

    @pytest.mark.parametrize(
        ("nr", "args"),
        [
            (OPENAT, (0, 0, os.O_RDONLY)),
            (OPENAT, (0, 0, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)),
            (OPEN, (0, os.O_RDONLY | os.O_NOFOLLOW)),
            (READ, ()),
            (WRITE, ()),
            (GETPID, ()),
            (SOCKET, (socket.AF_UNIX, socket.SOCK_STREAM)),
        ],
    )
    def test_reads_and_everything_unwatched_run_at_full_speed(self, nr, args):
        assert _run_filter(X86_64, nr, args) == ALLOW

    @pytest.mark.parametrize(
        ("nr", "args"),
        [
            (OPENAT, (0, 0, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)),
            (OPENAT, (0, 0, os.O_RDWR)),
            (OPENAT, (0, 0, os.O_TMPFILE | os.O_WRONLY)),
            (OPEN, (0, os.O_RDONLY | os.O_APPEND)),
            (UNLINK, ()),
            (UNLINKAT, ()),
            (CHMOD, ()),
            (LCHOWN, ()),
            (EXECVE, ()),
            (CONNECT, ()),
            (KILL, ()),
            (PTRACE, ()),
            (SOCKET, (socket.AF_INET, socket.SOCK_DGRAM)),
            (SOCKET, (socket.AF_INET6, socket.SOCK_RAW)),
            (SETSID, ()),
        ],
    )
    def test_writes_execs_sockets_and_signals_stop_for_the_supervisor(self, nr, args):
        assert _run_filter(X86_64, nr, args) == NOTIFY

    def test_a_32_bit_syscall_stops_whatever_it_is(self):
        assert _run_filter(I386, GETPID, ()) == NOTIFY

    def test_an_x32_syscall_stops_whatever_it_is(self):
        assert _run_filter(X86_64, GETPID | 0x40000000, ()) == NOTIFY


class TestDecode:
    """What a notified syscall does, read from its arguments and the caller's memory."""

    def test_a_write_intent_open_carries_its_path(self, caller):
        path = _c_string(b"/srv/app/notes.txt")

        effect = trace.decode(OPENAT, X86_64, (0, path, os.O_WRONLY, 0, 0, 0), caller)

        assert effect == trace.Effect("write", path="/srv/app/notes.txt")

    def test_an_unreadable_path_is_a_write_to_an_unknown_file(self, caller):
        effect = trace.decode(OPEN, X86_64, (8, os.O_WRONLY, 0, 0, 0, 0), caller)

        assert effect == trace.Effect("write", path=None)

    def test_a_shell_run_with_a_script_carries_the_script(self, caller):
        argv = _c_argv([b"/bin/bash", b"-o", b"pipefail", b"-c", b"ls -a; echo done", b"name"])

        effect = trace.decode(EXECVE, X86_64, (_c_string(b"/bin/bash"), argv, 0, 0, 0, 0), caller)

        assert effect == trace.Effect("exec", script="ls -a; echo done")

    @pytest.mark.parametrize(
        ("path", "argv"),
        [
            (b"/usr/bin/python3", [b"python3", b"-c", b"print(1)"]),
            (b"/bin/bash", [b"bash", b"script.sh"]),
        ],
    )
    def test_any_other_exec_carries_no_script(self, caller, path, argv):
        effect = trace.decode(EXECVE, X86_64, (_c_string(path), _c_argv(argv), 0, 0, 0, 0), caller)

        assert effect == trace.Effect("exec", script=None)

    @pytest.mark.parametrize(
        ("address", "expected"),
        [
            (b"/var/run/nscd/socket", "none"),
            (b"/run/systemd/userdb/io.systemd.Multiplexer", "none"),
            (b"/run/podman/podman.sock", "change"),
            (b"\0abstract-bus", "change"),
        ],
    )
    def test_a_local_socket_counts_unless_it_answers_user_lookups(self, caller, address, expected):
        sockaddr = _c_bytes(struct.pack("<H", socket.AF_UNIX) + address + b"\0")

        effect = trace.decode(CONNECT, X86_64, (3, sockaddr, 2 + len(address) + 1, 0, 0, 0), caller)

        assert effect.kind == expected

    def test_a_network_address_counts(self, caller):
        sockaddr = _c_bytes(struct.pack("<HH4s8x", socket.AF_INET, 53, bytes([10, 0, 2, 3])))

        effect = trace.decode(CONNECT, X86_64, (3, sockaddr, 16, 0, 0, 0), caller)

        assert effect == trace.CHANGE

    @pytest.mark.parametrize(
        ("domain", "expected"),
        [(socket.AF_INET, "change"), (socket.AF_UNIX, "none")],
    )
    def test_a_network_socket_counts_and_a_local_one_does_not(self, caller, domain, expected):
        args = (domain, socket.SOCK_DGRAM, 0, 0, 0, 0)

        assert trace.decode(SOCKET, X86_64, args, caller).kind == expected

    def test_starting_a_session_is_reported(self, caller):
        assert trace.decode(SETSID, X86_64, (0,) * 6, caller) == trace.Effect("setsid")

    def test_a_descriptor_path_holding_a_file_is_a_write_to_that_file(self, caller, tmp_path):
        notes = tmp_path / "notes.txt"
        notes.write_text("kept")

        with notes.open() as held:
            path = _c_string(f"/dev/fd/{held.fileno()}".encode())
            effect = trace.decode(OPENAT, X86_64, (0, path, os.O_WRONLY, 0, 0, 0), caller)

        assert effect == trace.Effect("write", path=str(notes), reopened=True)

    def test_a_descriptor_path_holding_a_pipe_stays_a_descriptor_path(self, caller):
        reader, writer = os.pipe()

        try:
            path = _c_string(f"/dev/fd/{writer}".encode())
            effect = trace.decode(OPENAT, X86_64, (0, path, os.O_WRONLY, 0, 0, 0), caller)
        finally:
            os.close(reader)
            os.close(writer)

        assert effect == trace.Effect("write", path=f"/dev/fd/{writer}")

    def test_a_signal_probe_sends_nothing(self, caller):
        assert trace.decode(KILL, X86_64, (4242, 0, 0, 0, 0, 0), caller) == trace.NONE

    def test_a_signal_names_its_target(self, caller):
        assert trace.decode(KILL, X86_64, (4242, 15, 0, 0, 0, 0), caller).target == 4242

    def test_a_signal_to_every_process_counts(self, caller):
        assert trace.decode(KILL, X86_64, (0xFFFFFFFF, 15, 0, 0, 0, 0), caller) == trace.CHANGE

    def test_a_32_bit_syscall_counts(self, caller):
        assert trace.decode(GETPID, I386, (0,) * 6, caller) == trace.CHANGE


class TestChangeTable:
    """Each row of what counts as a change, done by a process under a registered call's shell."""

    @pytest.mark.parametrize(
        "path",
        ["/dev/null", "/dev/tty", "/dev/pts/3", "/dev/stdout", "/dev/stderr", "/dev/fd/1"],
    )
    def test_output_thrown_away_or_sent_to_the_terminal_is_no_change(self, path):
        assert _verdict_after(trace.Effect("write", path=path)) == trace.UNCHANGED

    @pytest.mark.parametrize("path", ["/srv/app/notes.txt", "/tmp", "/dev/fd/1/../../etc/x", None])
    def test_any_other_write_counts_including_an_unreadable_path(self, path):
        assert _verdict_after(trace.Effect("write", path=path)) == trace.CHANGED

    def test_every_file_changing_syscall_counts(self):
        assert _verdict_after(trace.CHANGE) == trace.CHANGED

    @pytest.mark.parametrize("effect", [trace.NONE, trace.Effect("exec", script=None)])
    def test_a_user_lookup_and_running_a_program_are_no_change(self, effect):
        assert _verdict_after(effect) == trace.UNCHANGED

    def test_a_signal_to_a_process_of_the_same_call_is_no_change(self):
        assert _verdict_after(trace.Effect("signal", target=CHILD.pid)) == trace.UNCHANGED

    def test_a_signal_to_the_calls_own_process_group_is_no_change(self):
        assert _verdict_after(trace.Effect("signal", target=0)) == trace.UNCHANGED

    def test_a_signal_to_any_other_process_counts(self):
        assert _verdict_after(trace.Effect("signal", target=AGENT.pid)) == trace.CHANGED

    def test_the_agent_wrappers_own_working_directory_file_is_no_change(self):
        procs = FakeProcs(AGENT, CLAUDE_SHELL)
        tracker = trace.Tracker(procs)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(CLAUDE_SHELL, trace.Effect("write", path="/tmp/claude-ab12-cwd"))

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNCHANGED

    @pytest.mark.parametrize(
        "command",
        ["make; pwd -P >| out.txt", "eval true && pwd -P >| out.txt"],
    )
    def test_a_command_that_itself_writes_where_pwd_points_counts(self, command):
        shell = _proc(700, ppid=AGENT.pid, sid=700)
        tracker, procs = _tracker_with(shell)
        tracker.register("tu_1", command)
        tracker.apply(shell, trace.Effect("exec", script=command))

        tracker.apply(shell, trace.Effect("write", path="out.txt"))

        procs.end(shell)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_file_the_shell_was_given_as_output_is_no_change_reopened(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL, CHILD)
        procs.given[CLAUDE_SHELL.pid] = frozenset({"/srv/out/task.output"})
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(CHILD, trace.Effect("write", path="/srv/out/task.output", reopened=True))

        procs.end(CLAUDE_SHELL, CHILD)
        assert tracker.verdict("tu_1") == trace.UNCHANGED

    def test_a_file_the_command_opened_itself_counts_reopened(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL, CHILD)
        procs.given[CLAUDE_SHELL.pid] = frozenset({"/srv/out/task.output"})
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(CHILD, trace.Effect("write", path="/srv/app/notes.txt", reopened=True))

        procs.end(CLAUDE_SHELL, CHILD)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_that_file_written_by_another_process_counts(self):
        child = _proc(901, ppid=CLAUDE_SHELL.pid, sid=CLAUDE_SHELL.pid)
        procs = FakeProcs(AGENT, CLAUDE_SHELL, child)
        tracker = trace.Tracker(procs)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(child, trace.Effect("write", path="/tmp/claude-ab12-cwd"))

        procs.end(CLAUDE_SHELL, child)
        assert tracker.verdict("tu_1") == trace.CHANGED


class TestAttribution:
    """Which call a syscall is credited to."""

    def test_the_agent_clis_shell_is_found_by_its_quoted_command(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", COMMAND)

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_command_with_quotes_is_found_in_the_wrapper_that_escapes_them(self):
        command = "python3 -c 'print(1)'"
        script = "eval 'python3 -c '\"'\"'print(1)'\"'\"'' < /dev/null && pwd -P >| /tmp/c-cwd"
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", command)

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=script))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.CHANGED

    @pytest.mark.parametrize("registered", ["ls", "pwd", "true", "ls -a", "ls -a; echo"])
    def test_a_command_that_is_only_part_of_the_wrappers_text_claims_nothing(self, registered):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", registered)

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_command_that_ends_where_a_quote_was_escaped_claims_nothing(self):
        script = "eval 'grep -c a'\"'\"'b notes.txt' && pwd -P >| /tmp/c-cwd"
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", "grep -c a")

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=script))

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_command_the_cli_passes_unquoted_is_found(self):
        script = "eval make < /dev/null && pwd -P >| /tmp/claude-ab12-cwd"
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", "make")

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=script))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_an_unquoted_command_does_not_match_a_longer_one(self):
        script = "eval make-all < /dev/null && pwd -P >| /tmp/claude-ab12-cwd"
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", "make")

        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=script))

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_shell_a_command_started_never_takes_a_later_calls_place(self):
        earlier = _proc(800, ppid=AGENT.pid, sid=800)
        nested = _proc(801, ppid=800, sid=800)
        later = _proc(810, ppid=AGENT.pid, sid=810)
        tracker, procs = _tracker_with(earlier, nested, later)
        tracker.register("tu_1", "bash -c make")
        tracker.apply(earlier, trace.Effect("exec", script="eval 'bash -c make' && pwd -P >| /c"))
        tracker.apply(nested, trace.Effect("exec", script="make"))
        procs.end(earlier, nested)
        tracker.verdict("tu_1")

        tracker.apply(later, trace.Effect("exec", script="eval make && pwd -P >| /c"))
        tracker.apply(later, trace.CHANGE)
        tracker.register("tu_2", "make")

        procs.end(later)
        assert tracker.verdict("tu_2") == trace.CHANGED

    def test_a_shell_leading_a_session_inside_a_call_never_takes_a_later_calls_place(self):
        earlier = _proc(800, ppid=AGENT.pid, sid=800)
        nested = _proc(801, ppid=800, sid=801)
        later = _proc(810, ppid=AGENT.pid, sid=810)
        tracker, procs = _tracker_with(earlier, nested, later)
        tracker.register("tu_1", "setsid -w bash -c 'touch flag'")
        tracker.apply(earlier, trace.Effect("exec", script="eval 'setsid' && pwd -P >| /c"))
        tracker.apply(nested, trace.Effect("exec", script="touch flag"))
        tracker.apply(nested, trace.CHANGE)
        procs.end(earlier, nested)
        tracker.verdict("tu_1")

        tracker.apply(later, trace.Effect("exec", script="touch flag"))
        tracker.register("tu_2", "touch flag")

        procs.end(later)
        assert tracker.verdict("tu_2") == trace.UNCHANGED

    def test_a_bare_command_inside_another_calls_script_claims_nothing(self):
        script = "eval 'eval ls && touch y.txt' < /dev/null && pwd -P >| /tmp/claude-ab12-cwd"
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=script))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        tracker.register("tu_1", "ls")
        tracker.register("tu_2", "eval ls && touch y.txt")

        procs.end(CLAUDE_SHELL)
        assert (tracker.verdict("tu_1"), tracker.verdict("tu_2")) == (
            trace.UNKNOWN,
            trace.CHANGED,
        )

    def test_the_langgraph_shell_is_found_by_its_exact_script(self):
        shell = _proc(700, ppid=AGENT.pid, sid=700)
        tracker, procs = _tracker_with(shell)
        tracker.register("tu_1", COMMAND)

        tracker.apply(shell, trace.Effect("exec", script=COMMAND))
        tracker.apply(shell, trace.CHANGE)

        procs.end(shell)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_grandchild_is_credited_through_its_parents(self):
        child = _proc(901, ppid=CLAUDE_SHELL.pid, sid=CLAUDE_SHELL.pid)
        grandchild = _proc(902, ppid=901, sid=CLAUDE_SHELL.pid)
        tracker, procs = _tracker_with(CLAUDE_SHELL, child, grandchild)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(grandchild, trace.CHANGE)

        procs.end(CLAUDE_SHELL, child, grandchild)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_process_whose_parent_exited_is_credited_through_its_session(self):
        orphan = _proc(903, ppid=1, sid=CLAUDE_SHELL.pid)
        tracker, procs = _tracker_with(CLAUDE_SHELL, orphan)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(orphan, trace.CHANGE)

        procs.end(CLAUDE_SHELL, orphan)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_process_outside_the_call_is_not_credited_to_it(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        tracker.apply(AGENT, trace.CHANGE)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNCHANGED

    def test_two_identical_commands_claim_their_shells_oldest_first(self):
        first = _proc(801, ppid=AGENT.pid, sid=801, start=5000)
        second = _proc(802, ppid=AGENT.pid, sid=802, start=5001)
        tracker, procs = _tracker_with(first, second)
        tracker.apply(first, trace.Effect("exec", script="make build"))
        tracker.apply(second, trace.Effect("exec", script="make build"))
        tracker.apply(first, trace.CHANGE)

        tracker.register("tu_1", "make build")
        tracker.register("tu_2", "make build")

        procs.end(first, second)
        assert (tracker.verdict("tu_1"), tracker.verdict("tu_2")) == (
            trace.CHANGED,
            trace.UNCHANGED,
        )

    def test_a_registration_after_the_shell_started_still_finds_it(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        tracker.register("tu_1", COMMAND)

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_verdict_is_given_once(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        procs.end(CLAUDE_SHELL)
        tracker.verdict("tu_1")

        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_call_whose_shell_never_started_is_unknown(self):
        tracker = trace.Tracker(FakeProcs(AGENT))
        tracker.register("tu_1", COMMAND)

        assert tracker.verdict("tu_1") == trace.UNKNOWN


class TestStillRunning:
    """A call whose result comes back before it has finished."""

    def test_a_shell_still_running_is_unknown(self):
        tracker, _ = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_process_it_left_in_its_session_makes_it_unknown(self):
        left = _proc(904, ppid=1, sid=CLAUDE_SHELL.pid)
        tracker, procs = _tracker_with(CLAUDE_SHELL, left)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

        procs.end(CLAUDE_SHELL)
        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_a_process_that_started_a_session_of_its_own_stays_with_the_call(self):
        daemon = _proc(905, ppid=1, sid=CHILD.pid)
        tracker, procs = _tracker_with(CLAUDE_SHELL, CHILD, daemon)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CHILD, trace.Effect("setsid"))

        procs.end(CLAUDE_SHELL, CHILD)
        assert tracker.verdict("tu_1") == trace.UNKNOWN

    def test_what_a_process_in_that_session_does_counts(self):
        daemon = _proc(905, ppid=1, sid=CHILD.pid)
        tracker, procs = _tracker_with(CLAUDE_SHELL, CHILD, daemon)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CHILD, trace.Effect("setsid"))

        tracker.apply(daemon, trace.CHANGE)

        procs.end(CLAUDE_SHELL, CHILD, daemon)
        assert tracker.verdict("tu_1") == trace.CHANGED

    def test_a_running_call_that_already_changed_something_counts(self):
        tracker, _ = _tracker_with(CLAUDE_SHELL)
        tracker.register("tu_1", COMMAND)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)

        assert tracker.verdict("tu_1") == trace.CHANGED


class TestProcessTable:
    """Process facts read from the real /proc, checked against what the os module reports."""

    def test_this_process_reads_back_its_parent_and_session(self):
        proc = trace.ProcessTable().stat(os.getpid())

        assert proc is not None
        assert (proc.ppid, proc.sid, proc.pgrp) == (os.getppid(), os.getsid(0), os.getpgrp())

    def test_this_process_is_alive_under_its_own_start_time_only(self):
        procs = trace.ProcessTable()
        proc = procs.stat(os.getpid())

        assert proc is not None
        assert procs.alive(proc.key)
        assert not procs.alive((proc.pid, proc.start + 1))

    def test_this_session_has_a_live_member(self):
        assert trace.ProcessTable().sessions_alive({os.getsid(0)}, 0)


class TestProtocol:
    """Requests the supervisor answers on its socket."""

    def test_a_registered_call_gets_its_verdict(self):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        procs.end(CLAUDE_SHELL)

        registered = trace.answer(
            tracker,
            b'{"op": "register", "id": "tu_1", "command": "ls -a; echo done"}',
        )
        verdict = trace.answer(tracker, b'{"op": "verdict", "id": "tu_1"}')

        assert (registered, verdict) == ({"ok": True}, {"verdict": "unchanged"})

    def test_a_supervisor_without_a_filter_answers_unknown(self):
        assert trace.answer(None, b'{"op": "verdict", "id": "tu_1"}') == {"verdict": "unknown"}

    @pytest.mark.parametrize("line", [b"not json", b'{"op": "verdict"}', b'{"op": "forget"}'])
    def test_an_unreadable_request_gets_an_error(self, line):
        assert "error" in trace.answer(trace.Tracker(FakeProcs()), line)


class TestSlowReads:
    """A notification whose caller's memory is slow to read holds no other notification.

    The kernel's receive and answer calls are replaced by a pipe, so the real loop, its reader
    threads and a read that genuinely blocks run anywhere, a session's supervisor included.
    """

    SLOW_PID, OTHER_PID = 4_000_001, 4_000_002
    MKDIR = 83

    def test_an_unrelated_call_is_answered_while_another_callers_page_is_slow(
        self,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        procs = tmp_path / "proc"
        stat_line = Path("/proc/self/stat").read_text(encoding="utf-8")

        for pid in (self.SLOW_PID, self.OTHER_PID):
            (procs / str(pid)).mkdir(parents=True)
            (procs / str(pid) / "stat").write_text(stat_line, encoding="utf-8")

        mem = procs / str(self.SLOW_PID) / "mem"
        os.mkfifo(mem)
        notifications, answered = self._fake_kernel(monkeypatch)
        child = subprocess.Popen(["sleep", "30"])
        tracker = trace.Tracker(trace.ProcessTable(procs))
        read_end, write_end = os.pipe()
        server = threading.Thread(
            target=trace.serve,
            args=(Path("t.sock"), read_end, child.pid, tracker, procs),
            daemon=True,
        )
        server.start()

        try:
            notifications.put(
                (1, self.SLOW_PID, OPENAT, X86_64, (0xFFFFFF9C, 0x7000, os.O_WRONLY, 0, 0, 0)),
            )
            os.write(write_end, b"x")
            time.sleep(0.2)
            sent = time.monotonic()
            notifications.put((2, self.OTHER_PID, self.MKDIR, X86_64, (0x7000, 0o755, 0, 0, 0, 0)))
            os.write(write_end, b"x")

            try:
                other = answered.get(timeout=3)[0]
            except queue.Empty:
                other = None

            waited = time.monotonic() - sent
        finally:
            # Released in any case: a loop stuck on the read would hang the run, which has no timeout.
            os.close(os.open(mem, os.O_RDWR))
            child.kill()
            server.join(timeout=5)
            child.wait()
            os.close(write_end)

        assert (other, waited < 1) == (2, True), f"answered {other} after {waited:.1f}s"

    def test_an_unreadable_caller_still_counts_as_a_change(self, tmp_path, monkeypatch):
        procs = tmp_path / "proc"
        (procs / str(CLAUDE_SHELL.pid)).mkdir(parents=True)
        (procs / str(CLAUDE_SHELL.pid) / "stat").write_text(
            Path("/proc/self/stat").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        _, answered = self._fake_kernel(monkeypatch)
        tracker, _ = _tracker_with(CLAUDE_SHELL)
        applied = []
        monkeypatch.setattr(tracker, "apply", lambda proc, effect: applied.append(effect))
        settle = trace._Notifications(-1, tracker, procs)

        settle._settle(
            7,
            CLAUDE_SHELL.pid,
            OPENAT,
            X86_64,
            (0, 0x7000, os.O_WRONLY, 0, 0, 0),
            read=False,
        )
        settle._settle(
            8,
            CLAUDE_SHELL.pid,
            EXECVE,
            X86_64,
            (0x7000, 0x8000, 0, 0, 0, 0),
            read=False,
        )

        assert [answered.get_nowait()[0], answered.get_nowait()[0]] == [7, 8]
        assert applied == [trace.CHANGE, trace.Effect("exec")]

    def test_past_the_reader_cap_a_call_is_answered_unread_as_a_change(self, tmp_path, monkeypatch):
        procs = tmp_path / "proc"
        (procs / str(self.SLOW_PID)).mkdir(parents=True)
        (procs / str(self.SLOW_PID) / "stat").write_text(
            Path("/proc/self/stat").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        os.mkfifo(procs / str(self.SLOW_PID) / "mem")
        notifications, answered = self._fake_kernel(monkeypatch)
        monkeypatch.setattr(trace, "_MAX_READERS", 0)
        tracker = trace.Tracker(trace.ProcessTable(procs))
        applied = []
        monkeypatch.setattr(tracker, "apply", lambda proc, effect: applied.append(effect))
        read_end, write_end = os.pipe()
        notifications.put((3, self.SLOW_PID, OPENAT, X86_64, (0, 0x7000, os.O_WRONLY, 0, 0, 0)))
        os.write(write_end, b"x")

        trace._Notifications(read_end, tracker, procs).receive()

        assert (answered.get_nowait()[0], applied) == (3, [trace.CHANGE])
        os.close(read_end)
        os.close(write_end)

    def test_a_reader_that_cannot_start_answers_its_call_unread(self, tmp_path, monkeypatch):
        procs = tmp_path / "proc"
        (procs / str(self.SLOW_PID)).mkdir(parents=True)
        (procs / str(self.SLOW_PID) / "stat").write_text(
            Path("/proc/self/stat").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        notifications, answered = self._fake_kernel(monkeypatch)

        def refuse(thread):
            raise RuntimeError("can't start new thread")

        monkeypatch.setattr(threading.Thread, "start", refuse)
        tracker = trace.Tracker(trace.ProcessTable(procs))
        applied = []
        monkeypatch.setattr(tracker, "apply", lambda proc, effect: applied.append(effect))
        read_end, write_end = os.pipe()
        notifications.put((4, self.SLOW_PID, OPENAT, X86_64, (0, 0x7000, os.O_WRONLY, 0, 0, 0)))
        os.write(write_end, b"x")
        settle = trace._Notifications(read_end, tracker, procs)

        settle.receive()

        assert (answered.get_nowait()[0], applied, settle._reading) == (4, [trace.CHANGE], set())
        os.close(read_end)
        os.close(write_end)

    @staticmethod
    def _fake_kernel(monkeypatch):
        notifications: queue.Queue = queue.Queue()
        answered: queue.Queue = queue.Queue()

        def receive(listener):
            os.read(listener, 1)

            return notifications.get_nowait()

        monkeypatch.setattr(trace, "_receive_notification", receive)
        monkeypatch.setattr(
            trace,
            "_respond",
            lambda listener, notif_id: answered.put((notif_id, time.monotonic())),
        )
        monkeypatch.setattr(trace, "_still_waiting", lambda listener, notif_id: True)

        return notifications, answered


class TestTraceClient:
    """The pipeline's client: the answers it reads, and no answer whenever none can be had."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("reply", "expected"),
        [
            (b'{"verdict": "changed"}', True),
            (b'{"verdict": "unchanged"}', False),
            (b'{"verdict": "unknown"}', None),
            (b'{"error": "unknown op"}', None),
            (b"not json", None),
        ],
    )
    async def test_a_verdict_reads_as_true_false_or_none(self, path, reply, expected):
        requests = []

        async def serve(reader, writer):
            requests.append(json.loads(await reader.readline()))
            writer.write(reply + b"\n")
            await writer.drain()
            writer.close()

        async with await asyncio.start_unix_server(serve, path=path):
            verdict = await TraceClient(path).verdict_for("tu_1")

        assert verdict is expected
        assert requests == [{"op": "verdict", "id": "tu_1"}]

    @pytest.mark.anyio
    async def test_the_client_speaks_the_supervisors_protocol(self, path):
        tracker, procs = _tracker_with(CLAUDE_SHELL)
        tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))
        tracker.apply(CLAUDE_SHELL, trace.CHANGE)
        procs.end(CLAUDE_SHELL)

        async def serve(reader, writer):
            writer.write(
                json.dumps(trace.answer(tracker, await reader.readline())).encode() + b"\n",
            )
            await writer.drain()
            writer.close()

        async with await asyncio.start_unix_server(serve, path=path):
            client = TraceClient(path)
            await client.register_command("tu_1", COMMAND)
            verdict = await client.verdict_for("tu_1")

        assert verdict is True

    @pytest.mark.anyio
    async def test_a_missing_socket_is_no_answer(self, path):
        assert await TraceClient(path).verdict_for("tu_1") is None

    @pytest.mark.anyio
    async def test_a_refused_connection_is_no_answer(self, path):

        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as bound:
            bound.bind(str(path))

            assert await TraceClient(path).verdict_for("tu_1") is None

    @pytest.mark.anyio
    async def test_a_supervisor_that_never_answers_is_no_answer(self, path, monkeypatch):
        monkeypatch.setattr(trace_client, "_TIMEOUT_S", 0.05)

        async def serve(reader, writer):
            await reader.read()

        async with await asyncio.start_unix_server(serve, path=path):
            verdict = await TraceClient(path).verdict_for("tu_1")

        assert verdict is None

    @pytest.mark.anyio
    async def test_a_session_logs_the_missing_supervisor_once(self, path):
        client = TraceClient(path)

        with patch.object(trace_client, "logger") as log:
            await client.register_command("tu_1", COMMAND)
            await client.verdict_for("tu_1")

        log.info.assert_called_once()


COMMAND = "ls -a; echo done"
CLAUDE_SCRIPT = (
    "source /root/.claude/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && "
    "eval 'ls -a; echo done' < /dev/null && pwd -P >| /tmp/claude-ab12-cwd"
)


class FakeProcs:
    """A process table held in memory; `end` marks processes as exited."""

    def __init__(self, *procs):
        self._procs = {p.pid: p for p in procs if p is not None}
        self._ended: set[tuple[int, int]] = set()
        self.given: dict[int, frozenset[str]] = {}

    def descriptors(self, pid):
        return self.given.get(pid, frozenset())

    def stat(self, pid):
        return self._procs.get(pid)

    def alive(self, key):
        proc = self._procs.get(key[0])

        return proc is not None and proc.start == key[1] and key not in self._ended

    def sessions_alive(self, sids, since):
        return any(
            p.sid in sids and p.start >= since and p.key not in self._ended
            for p in self._procs.values()
        )

    def end(self, *procs):
        self._ended.update(p.key for p in procs)


@pytest.fixture
def path(tmp_path, monkeypatch):
    """A socket path short enough to bind: relative to a working directory inside `tmp_path`."""

    monkeypatch.chdir(tmp_path)

    return Path("trace.sock")


@pytest.fixture
def caller():
    with trace.Caller(os.getpid()) as caller:
        yield caller


def _proc(pid, *, ppid, sid, start=None, pgrp=None):
    return trace.Proc(
        pid=pid,
        start=start if start is not None else 4000 + pid,
        ppid=ppid,
        pgrp=pgrp if pgrp is not None else sid,
        sid=sid,
        state="S",
    )


def _tracker_with(*procs):
    fake = FakeProcs(AGENT, *procs)

    return trace.Tracker(fake), fake


def _verdict_after(effect):
    tracker, procs = _tracker_with(CLAUDE_SHELL, CHILD)
    tracker.register("tu_1", COMMAND)
    tracker.apply(CLAUDE_SHELL, trace.Effect("exec", script=CLAUDE_SCRIPT))

    tracker.apply(CHILD, effect)

    procs.end(CLAUDE_SHELL, CHILD)

    return tracker.verdict("tu_1")


_KEEP_ALIVE: list = []


def _c_bytes(data: bytes) -> int:
    buffer = ctypes.create_string_buffer(data, len(data))
    _KEEP_ALIVE.append(buffer)

    return ctypes.addressof(buffer)


def _c_string(data: bytes) -> int:
    return _c_bytes(data + b"\0")


def _c_argv(args: list[bytes]) -> int:
    pointers = [_c_string(arg) for arg in args] + [0]

    return _c_bytes(struct.pack(f"<{len(pointers)}Q", *pointers))


def _run_filter(arch: int, nr: int, args: tuple) -> str:
    data = struct.pack("<iIQ6Q", nr, arch, 0, *(list(args) + [0] * (6 - len(args))))
    program = trace.filter_program()
    pc = 0
    accumulator = 0

    while True:
        code, true_jump, false_jump, k = struct.unpack_from("<HBBI", program, pc * 8)
        pc += 1

        if code == 0x20:
            accumulator = struct.unpack_from("<I", data, k)[0]
        elif code == 0x06:
            return {0x7FFF0000: ALLOW, 0x7FC00000: NOTIFY}[k]
        else:
            taken = {
                0x15: accumulator == k,
                0x35: accumulator >= k,
                0x45: bool(accumulator & k),
            }[code]
            pc += true_jump if taken else false_jump
