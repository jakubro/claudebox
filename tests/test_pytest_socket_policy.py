"""Sentinel — pytest-socket deny-by-default policy is active."""

import socket

import pytest
from pytest_socket import SocketBlockedError


def test_inet_socket_blocked_by_default():
    """Constructing an AF_INET socket raises SocketBlockedError under default policy."""

    with pytest.raises(SocketBlockedError):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)


def test_unix_socket_allowed_by_default():
    """AF_UNIX sockets remain usable for asyncio self-pipe and same-process IPC."""

    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.close()


@pytest.mark.enable_socket
def test_enable_socket_marker_opts_out():
    """`@pytest.mark.enable_socket` lifts the deny-by-default block for one test."""

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.close()
