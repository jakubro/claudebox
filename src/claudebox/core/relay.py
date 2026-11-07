"""Relay bytes both ways between two stream pairs until either side ends."""

from __future__ import annotations

import asyncio
import contextlib


_CHUNK = 64 * 1024


async def relay_streams(
    a: tuple[asyncio.StreamReader, asyncio.StreamWriter],
    b: tuple[asyncio.StreamReader, asyncio.StreamWriter],
) -> None:
    """Copy each side's bytes to the other; closes both writers once the copying ends."""

    try:
        await asyncio.gather(_copy(a[0], b[1]), _copy(b[0], a[1]))
    finally:
        for _, writer in (a, b):
            writer.close()

            with contextlib.suppress(OSError):
                await writer.wait_closed()


async def _copy(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(_CHUNK):
            writer.write(data)
            await writer.drain()

        if writer.can_write_eof():
            writer.write_eof()
    except (ConnectionError, OSError):
        writer.close()
