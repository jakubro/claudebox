"""Structured logging configuration using structlog with memory buffer pattern."""

import logging
import logging.handlers
import sys
import threading
from pathlib import Path

import structlog

from . import serialization
from ..core.fs import touch_dir


LOG_BUFFER_CAPACITY = 10_000  # in-memory MemoryHandler capacity


# Module state
_lock = threading.Lock()
_root: logging.Logger | None = None
_configured = False
_buffer_enabled = False
_handlers: dict[str, logging.Handler] = {}


# Shared processors for both structlog and stdlib
_shared_processors = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.stdlib.PositionalArgumentsFormatter(),
    structlog.processors.TimeStamper(),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
    lambda _logger, _name, event: serialization.serialize(event),
    structlog.processors.UnicodeDecoder(),
]

# Configure structlog
structlog.configure(
    processors=_shared_processors + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)


def configure_logging(console: bool = False, buffer: bool = False, debug: bool = False) -> None:
    """Configure structlog with optional console output and memory buffering."""

    global _configured

    with _lock:
        if _configured:
            return

        _configure_logging(console, buffer, debug)
        _configured = True


def _configure_logging(console: bool, buffer: bool, debug: bool) -> None:
    """Set up root logger, optional console handler, and optional memory buffer."""

    global _root, _buffer_enabled

    level = logging.DEBUG if debug else logging.INFO

    # Configure root logger
    _root = logging.getLogger()
    _root.handlers.clear()
    _root.setLevel(level)

    # Console handler
    if console:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            structlog.stdlib.ProcessorFormatter(
                foreign_pre_chain=_shared_processors,
                processors=[
                    structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                    structlog.dev.ConsoleRenderer(
                        exception_formatter=structlog.dev.RichTracebackFormatter(
                            show_locals=False,
                        )
                    ),
                ],
            ),
        )
        _root.addHandler(handler)

    # Memory buffer for pre-attach logs
    _buffer_enabled = buffer
    _use_memory_buffer()

    # Quiet noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("filelock").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sse_starlette").setLevel(logging.WARNING)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structlog logger, auto-configuring on first call if needed."""

    if not _configured:
        configure_logging()

    return structlog.get_logger(name)


def use_log_file(path: str | Path) -> None:
    """Attach file handler and flush any buffered logs.

    Creates parent directories if needed. If a file handler already exists,
    it is closed before attaching the new one.
    """

    if not _configured:
        configure_logging()

    if handler := _handlers.pop("file", None):
        handler.close()
        _root.removeHandler(handler)  # ty: ignore[unresolved-attribute]

    path = Path(path)
    touch_dir(path.parent)

    _handlers["file"] = handler = logging.FileHandler(
        path,
        mode="a",
        encoding="utf-8",
    )

    _use_log_file(handler)


def use_rotating_log_file(
    path: str | Path,
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 5,
) -> None:
    """Attach a rotating file handler for persistent daemon-level logging.

    Separate from use_log_file() (per-session) so both can coexist:
    daemon-level rotating log + per-session append-only log.
    """

    if not _configured:
        configure_logging()

    if handler := _handlers.pop("rotating_file", None):
        handler.close()
        _root.removeHandler(handler)  # ty: ignore[unresolved-attribute]

    path = Path(path)
    touch_dir(path.parent)

    _handlers["rotating_file"] = handler = logging.handlers.RotatingFileHandler(
        path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )

    _use_log_file(handler)


def close_log_file() -> None:
    """Close file handler and re-enable memory buffering if configured.

    Safe to call even if no file handler is attached.
    """

    if handler := _handlers.pop("file", None):
        handler.close()
        _root.removeHandler(handler)  # ty: ignore[unresolved-attribute]

    _use_memory_buffer()


def _use_log_file(handler: logging.FileHandler) -> None:
    """Configure formatter, attach handler to root, and flush memory buffer."""

    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=_shared_processors,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.JSONRenderer(serializer=serialization.dumps),
            ],
        ),
    )
    _root.addHandler(handler)  # ty: ignore[unresolved-attribute]

    memory: logging.handlers.MemoryHandler = _handlers.get("memory")  # type: ignore
    if memory:
        memory.setTarget(handler)
        _close_memory_buffer()


def _use_memory_buffer() -> None:
    """Buffer log records in memory until a file handler is attached."""

    if not _buffer_enabled or _handlers.get("memory"):
        return

    _handlers["memory"] = handler = logging.handlers.MemoryHandler(
        capacity=LOG_BUFFER_CAPACITY,
        flushLevel=logging.CRITICAL + 1,  # Never auto-flush
        target=None,
    )
    _root.addHandler(handler)


def _close_memory_buffer() -> None:
    """Flush and close the memory buffer handler."""

    if not _buffer_enabled:
        return

    if handler := _handlers.pop("memory", None):
        handler.close()
        _root.removeHandler(handler)
