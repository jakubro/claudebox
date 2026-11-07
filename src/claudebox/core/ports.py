"""The [ports] settings table - the forms an entry takes and the --publish value each becomes."""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol


LOOPBACK = "127.0.0.1"

_CONTAINER_SPEC = re.compile(r"(\d+)/(tcp|udp|sctp)")
_HOST_PORT = re.compile(r"\d+")
_TABLE_KEYS = frozenset({"container", "bind"})


@dataclass(frozen=True)
class PortMapping:
    """One [ports] entry: the container port, its protocol, and the host address it is published on."""

    container: int
    protocol: str | None = None
    bind: str = LOOPBACK

    @property
    def container_spec(self) -> str:
        """The container side of a publish: `80`, or `80/udp` when the entry names a protocol."""

        return f"{self.container}/{self.protocol}" if self.protocol else str(self.container)


class EntryLocation(Protocol):
    """Name where a [ports] entry is set - the file and table - for `key`, or for the table when None."""

    def __call__(self, key: object | None) -> str: ...


def parse_ports(
    raw: Mapping | None,
    *,
    where: str | EntryLocation = "[ports]",
) -> dict[int, PortMapping] | None:
    """Normalise a [ports] table; raise ValueError naming `where` and the entry for anything malformed."""

    locate = (lambda _key: where) if isinstance(where, str) else where

    if raw is None:
        return None
    elif isinstance(raw, Mapping):
        return {
            _host_port(key, locate(key)): _mapping(key, value, locate(key))
            for key, value in raw.items()
        }
    else:
        raise ValueError(
            f"{locate(None)}: expected a table of host port = container port, got {raw!r}",
        )


def publish_spec(host_port: int, mapping: PortMapping) -> str:
    """The value of one `--publish`: bind, host port (empty for a free one) and the container side."""

    bind = f"[{mapping.bind}]" if ":" in mapping.bind else mapping.bind
    host = "" if host_port == 0 else str(host_port)

    return f"{bind}:{host}:{mapping.container_spec}"


def _host_port(key: object, where: str) -> int:
    if isinstance(key, int) and not isinstance(key, bool):
        port = key
    elif isinstance(key, str) and _HOST_PORT.fullmatch(key):
        port = int(key)
    else:
        raise ValueError(f"{where}: entry {key!r}: the host port must be a number from 0 to 65535")

    if not 0 <= port <= 65535:
        raise ValueError(f"{where}: entry {key!r}: the host port must be a number from 0 to 65535")

    return port


def _mapping(key: object, value: object, where: str) -> PortMapping:
    if isinstance(value, PortMapping):
        return value
    elif isinstance(value, Mapping):
        return _table(key, value, where)
    else:
        container, protocol = _container(key, value, where)

        return PortMapping(container=container, protocol=protocol)


def _table(key: object, table: Mapping, where: str) -> PortMapping:
    if unknown := sorted(set(table) - _TABLE_KEYS):
        raise ValueError(
            f"{where}: entry {key!r}: unknown key {unknown[0]!r}; only container and bind",
        )

    if "container" not in table:
        raise ValueError(f"{where}: entry {key!r}: a table entry needs a container port")

    container, protocol = _container(key, table["container"], where)

    return PortMapping(
        container=container,
        protocol=protocol,
        bind=_bind(key, table.get("bind", LOOPBACK), where),
    )


def _container(key: object, value: object, where: str) -> tuple[int, str | None]:
    if isinstance(value, int) and not isinstance(value, bool):
        port, protocol = value, None
    elif isinstance(value, str) and (match := _CONTAINER_SPEC.fullmatch(value)):
        port, protocol = int(match[1]), match[2]
    else:
        raise ValueError(
            f'{where}: entry {key!r}: the container port must be a number or "<port>/<tcp|udp|sctp>", '
            f"got {value!r}",
        )

    if not 1 <= port <= 65535:
        raise ValueError(
            f"{where}: entry {key!r}: the container port must be from 1 to 65535, got {port}",
        )

    return port, protocol


def _bind(key: object, value: object, where: str) -> str:
    refusal = f"{where}: entry {key!r}: bind must be an IPv4 or IPv6 address such as 0.0.0.0, got {value!r}"

    try:
        address = ipaddress.ip_address(value) if isinstance(value, str) else None
    except ValueError:
        address = None

    if address is None:
        raise ValueError(refusal)

    return str(address)
