"""Tests for claudebox.core.ports - the [ports] table's forms and the --publish value of each."""

from __future__ import annotations

import pytest

from claudebox.core.ports import PortMapping, parse_ports, publish_spec


@pytest.mark.parametrize(
    ("raw", "spec"),
    [
        ({8080: 80}, "127.0.0.1:8080:80"),
        ({"8080": 80}, "127.0.0.1:8080:80"),
        ({8081: "80/udp"}, "127.0.0.1:8081:80/udp"),
        ({0: 3000}, "127.0.0.1::3000"),
        ({9000: {"container": 90, "bind": "0.0.0.0"}}, "0.0.0.0:9000:90"),
        ({9001: {"container": "91/tcp", "bind": "192.168.1.20"}}, "192.168.1.20:9001:91/tcp"),
        ({9002: {"container": 92, "bind": "::"}}, "[::]:9002:92"),
        ({9003: {"container": 93, "bind": "::1"}}, "[::1]:9003:93"),
        ({9004: {"container": "94/sctp"}}, "127.0.0.1:9004:94/sctp"),
    ],
    ids=[
        "int",
        "string-key",
        "protocol",
        "free-host-port",
        "every-interface",
        "one-address",
        "ipv6-any",
        "ipv6-loopback",
        "table-without-bind",
    ],
)
def test_each_accepted_form_publishes_as_written(raw, spec):
    ((host, mapping),) = (parse_ports(raw) or {}).items()

    assert publish_spec(host, mapping) == spec


def test_no_table_is_no_ports():
    assert parse_ports(None) is None


def test_parsing_is_idempotent():
    parsed = parse_ports({"8080": {"container": "80/udp", "bind": "0.0.0.0"}})

    assert (
        parse_ports(parsed)
        == parsed
        == {8080: PortMapping(container=80, protocol="udp", bind="0.0.0.0")}
    )


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ({"web": 80}, "host port"),
        ({8080: 0}, "container port"),
        ({8080: 65536}, "container port"),
        ({65536: 80}, "host port"),
        ({"-1": 80}, "host port"),
        ({8080: "80/icmp"}, "container port"),
        ({8080: "80"}, "container port"),
        ({8080: {"container": 80, "bind": "localhost"}}, "bind"),
        ({8080: {"container": 80, "bind": "127.0.0.1:9"}}, "bind"),
        ({8080: {"container": 80, "bind": ""}}, "bind"),
        ({8080: {"bind": "0.0.0.0"}}, "container"),
        ({8080: {"container": 80, "host": "0.0.0.0"}}, "host"),
        ({8080: 80.5}, "container port"),
        ({8080: True}, "container port"),
        ({8080: [80]}, "container port"),
    ],
    ids=[
        "non-numeric-key",
        "container-port-zero",
        "container-port-too-high",
        "host-port-too-high",
        "negative-key",
        "bad-protocol",
        "bare-string",
        "hostname-bind",
        "bind-with-port",
        "empty-bind",
        "table-without-container",
        "unknown-table-key",
        "float",
        "bool",
        "list",
    ],
)
def test_every_other_entry_is_refused_naming_where_and_which(raw, reason):
    with pytest.raises(ValueError) as excinfo:
        parse_ports(raw, where="[ports] in /w/settings.toml")

    message = str(excinfo.value)
    assert "[ports] in /w/settings.toml" in message
    assert repr(next(iter(raw))) in message
    assert reason in message
